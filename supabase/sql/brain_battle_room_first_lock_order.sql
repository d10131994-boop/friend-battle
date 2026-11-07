-- Brain Battle lock ordering hardening.
-- Every game lifecycle mutation locks common_multiplayer_rooms before
-- games_brain_battle_matches, matching Multiplayer leave/reset triggers.

CREATE OR REPLACE FUNCTION public.brain_battle_advance_if_due(
  p_room_id uuid,
  p_match_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_brain_battle_matches%ROWTYPE;
  v_player_count integer;
  v_answered_count integer;
  v_next_index integer;
  v_now timestamptz;
  v_results jsonb;
  v_winner text;
  v_max_score integer;
  v_top_count integer;
  v_room_result jsonb;
BEGIN
  -- Always lock the shared room before the game-owned match row.
  -- This matches leave_room -> game cleanup trigger and prevents lock inversion.
  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_match
  FROM public.games_brain_battle_matches
  WHERE id = p_match_id AND room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002'; END IF;
  -- Preserve idempotent reads for completed/cancelled matches even though the
  -- shared room is no longer in the playing state.
  IF v_match.status <> 'playing' THEN
    RETURN pg_catalog.jsonb_build_object('status', v_match.status, 'matchFinished', v_match.status = 'completed');
  END IF;
  IF v_room.status <> 'playing' OR v_room.started_at IS DISTINCT FROM v_match.started_at THEN
    RAISE EXCEPTION 'Match is no longer active' USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_player_count
  FROM public.common_multiplayer_players WHERE room_id = p_room_id;
  SELECT count(*) INTO v_answered_count
  FROM public.games_brain_battle_answers
  WHERE match_id = p_match_id AND question_index = v_match.current_question_index;

  v_now := pg_catalog.clock_timestamp();
  IF v_answered_count < v_player_count AND v_now < v_match.question_ends_at THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'waiting',
      'currentQuestionIndex', v_match.current_question_index,
      'questionStartedAt', v_match.question_started_at,
      'questionEndsAt', v_match.question_ends_at
    );
  END IF;

  -- Players who did not answer before the deadline receive a zero-score skip.
  INSERT INTO public.games_brain_battle_answers(
    match_id, room_id, user_id, question_index, selected_answer,
    is_correct, response_time_ms, score, answered_at
  )
  SELECT p_match_id, p_room_id, p.user_id, v_match.current_question_index,
         NULL, false, 15000, 0, v_match.question_ends_at
  FROM public.common_multiplayer_players p
  WHERE p.room_id = p_room_id
    AND NOT EXISTS (
      SELECT 1 FROM public.games_brain_battle_answers a
      WHERE a.match_id = p_match_id
        AND a.user_id = p.user_id
        AND a.question_index = v_match.current_question_index
    )
  ON CONFLICT (match_id, user_id, question_index) DO NOTHING;

  v_next_index := v_match.current_question_index + 1;
  IF v_next_index < 10 THEN
    v_now := pg_catalog.clock_timestamp();
    UPDATE public.games_brain_battle_matches
    SET current_question_index = v_next_index,
        question_started_at = v_now,
        question_ends_at = v_now + interval '15 seconds'
    WHERE id = p_match_id;
    RETURN pg_catalog.jsonb_build_object(
      'status', 'advanced',
      'currentQuestionIndex', v_next_index,
      'questionStartedAt', v_now,
      'questionEndsAt', v_now + interval '15 seconds',
      'matchFinished', false
    );
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'userId', p.user_id,
      'displayName', p.display_name,
      'score', COALESCE(s.total_score, 0),
      'correctAnswers', COALESCE(s.correct_answers, 0),
      'incorrectAnswers', COALESCE(s.incorrect_answers, 0),
      'skippedQuestions', COALESCE(s.skipped_questions, 0)
    ) ORDER BY COALESCE(s.total_score, 0) DESC, p.joined_at, p.id
  ), '[]'::jsonb)
  INTO v_results
  FROM public.common_multiplayer_players p
  LEFT JOIN (
    SELECT user_id,
      sum(score)::integer AS total_score,
      count(*) FILTER (WHERE is_correct)::integer AS correct_answers,
      count(*) FILTER (WHERE selected_answer IS NOT NULL AND NOT is_correct)::integer AS incorrect_answers,
      count(*) FILTER (WHERE selected_answer IS NULL)::integer AS skipped_questions
    FROM public.games_brain_battle_answers
    WHERE match_id = p_match_id
    GROUP BY user_id
  ) s ON s.user_id = p.user_id
  WHERE p.room_id = p_room_id;

  SELECT max(total_score), count(*) FILTER (WHERE total_score = max_score)
  INTO v_max_score, v_top_count
  FROM (
    SELECT user_id, sum(score)::integer AS total_score,
      max(sum(score)::integer) OVER () AS max_score
    FROM public.games_brain_battle_answers
    WHERE match_id = p_match_id
    GROUP BY user_id
  ) ranked;

  IF v_top_count = 1 THEN
    SELECT user_id INTO v_winner
    FROM (
      SELECT user_id, sum(score)::integer AS total_score
      FROM public.games_brain_battle_answers
      WHERE match_id = p_match_id
      GROUP BY user_id
    ) scores
    WHERE total_score = v_max_score
    LIMIT 1;
  END IF;

  INSERT INTO public.common_multiplayer_room_stats(room_id, user_id, wins, matches_played)
  SELECT p_room_id, p.user_id, CASE WHEN p.user_id = v_winner THEN 1 ELSE 0 END, 1
  FROM public.common_multiplayer_players p
  WHERE p.room_id = p_room_id
  ON CONFLICT (room_id, user_id) DO UPDATE SET
    wins = public.common_multiplayer_room_stats.wins + EXCLUDED.wins,
    matches_played = public.common_multiplayer_room_stats.matches_played + 1,
    updated_at = now();

  UPDATE public.games_brain_battle_matches
  SET status = 'completed', completed_at = v_now,
      current_question_index = 10, final_results = v_results,
      winner_user_id = v_winner
  WHERE id = p_match_id;

  v_room_result := public.multiplayer_room_snapshot(p_room_id);

  RETURN pg_catalog.jsonb_build_object(
    'status', 'completed',
    'currentQuestionIndex', 10,
    'matchFinished', true,
    'finalResults', v_results,
    'winnerUserId', v_winner,
    'room', v_room_result
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.brain_battle_submit_answer(
  p_room_id uuid,
  p_match_id uuid,
  p_user_id text,
  p_question_index integer,
  p_selected_answer integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_brain_battle_matches%ROWTYPE;
  v_question jsonb;
  v_now timestamptz;
  v_response_time_ms integer;
  v_is_correct boolean;
  v_score integer;
  v_advance jsonb;
BEGIN
  -- Match the room-first lock order used by leave_room and match advancement.
  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'Match is no longer active' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_match
  FROM public.games_brain_battle_matches
  WHERE id = p_match_id AND room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002'; END IF;
  IF v_match.status <> 'playing' THEN RAISE EXCEPTION 'Match is not active' USING ERRCODE = '55000'; END IF;
  IF v_room.started_at IS DISTINCT FROM v_match.started_at THEN
    RAISE EXCEPTION 'Match is no longer active' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501'; END IF;
  IF p_question_index <> v_match.current_question_index THEN RAISE EXCEPTION 'Question index mismatch' USING ERRCODE = '55000'; END IF;
  IF p_question_index < 0 OR p_question_index > 9 THEN RAISE EXCEPTION 'Invalid question index' USING ERRCODE = '22023'; END IF;
  IF p_selected_answer IS NOT NULL AND (p_selected_answer < 0 OR p_selected_answer > 3) THEN
    RAISE EXCEPTION 'Invalid selected answer' USING ERRCODE = '22023';
  END IF;

  v_now := pg_catalog.clock_timestamp();
  IF v_now < v_match.question_started_at THEN RAISE EXCEPTION 'Question has not started yet' USING ERRCODE = '55000'; END IF;
  IF v_now > v_match.question_ends_at THEN RAISE EXCEPTION 'Question time expired' USING ERRCODE = '55000'; END IF;

  v_question := v_match.questions -> p_question_index;
  v_response_time_ms := GREATEST(0, LEAST(15000,
    floor(extract(epoch FROM (v_now - v_match.question_started_at)) * 1000)::integer
  ));
  v_is_correct := p_selected_answer IS NOT NULL
    AND p_selected_answer = (v_question->>'correctAnswer')::integer;
  v_score := CASE WHEN v_is_correct
    THEN 100 + floor(50.0 * (15000 - v_response_time_ms) / 15000)::integer
    ELSE 0 END;

  INSERT INTO public.games_brain_battle_answers(
    match_id, room_id, user_id, question_index, selected_answer,
    is_correct, response_time_ms, score, answered_at
  )
  VALUES (
    p_match_id, p_room_id, p_user_id, p_question_index, p_selected_answer,
    v_is_correct, v_response_time_ms, v_score, v_now
  );

  v_advance := public.brain_battle_advance_if_due(p_room_id, p_match_id);
  RETURN pg_catalog.jsonb_build_object(
    'score', v_score,
    'isCorrect', v_is_correct,
    'advance', v_advance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.brain_battle_advance_if_due(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brain_battle_submit_answer(uuid, uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brain_battle_advance_if_due(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.brain_battle_submit_answer(uuid, uuid, text, integer, integer) TO service_role;

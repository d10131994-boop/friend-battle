-- Brain Battle: all players tied for the highest total score receive a room win.
-- Preserve the 10-question score calculation and unique-winner compatibility.
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
  v_match public.games_brain_battle_matches%ROWTYPE;
  v_player_count integer;
  v_answered_count integer;
  v_next_index integer;
  v_now timestamptz;
  v_results jsonb;
  v_winner text;
  v_max_score integer;
  v_top_count integer;
  v_winner_ids jsonb;
  v_room_result jsonb;
BEGIN
  SELECT * INTO v_match
  FROM public.games_brain_battle_matches
  WHERE id = p_match_id AND room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002'; END IF;
  IF v_match.status <> 'playing' THEN
    RETURN pg_catalog.jsonb_build_object('status', v_match.status, 'matchFinished', v_match.status = 'completed');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_rooms
    WHERE id = p_room_id AND status = 'playing' AND started_at = v_match.started_at
  ) THEN
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

  -- All players tied at the highest total score win, including all-zero matches.
  -- The legacy winnerUserId is populated only for a unique winner.
  SELECT COALESCE(max((item.value->>'score')::integer), 0)
  INTO v_max_score
  FROM pg_catalog.jsonb_array_elements(v_results) AS item(value);

  SELECT COALESCE(pg_catalog.jsonb_agg(item.value->'userId'), '[]'::jsonb)
  INTO v_winner_ids
  FROM pg_catalog.jsonb_array_elements(v_results) AS item(value)
  WHERE (item.value->>'score')::integer = v_max_score;

  v_top_count := pg_catalog.jsonb_array_length(v_winner_ids);
  IF v_top_count = 1 THEN
    v_winner := v_winner_ids->>0;
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    item.value || pg_catalog.jsonb_build_object(
      'isWinner', (item.value->>'score')::integer = v_max_score
    )
  ), '[]'::jsonb)
  INTO v_results
  FROM pg_catalog.jsonb_array_elements(v_results) AS item(value);

  INSERT INTO public.common_multiplayer_room_stats(room_id, user_id, wins, matches_played)
  SELECT p_room_id, p.user_id,
         CASE WHEN v_winner_ids @> pg_catalog.jsonb_build_array(p.user_id) THEN 1 ELSE 0 END, 1
  FROM public.common_multiplayer_players p
  WHERE p.room_id = p_room_id
  ON CONFLICT (room_id, user_id) DO UPDATE SET
    wins = public.common_multiplayer_room_stats.wins + EXCLUDED.wins,
    matches_played = public.common_multiplayer_room_stats.matches_played + 1,
    updated_at = pg_catalog.now();

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
    'winnerUserIds', v_winner_ids,
    'room', v_room_result
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.brain_battle_advance_if_due(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brain_battle_advance_if_due(uuid,uuid) TO service_role;

UPDATE public.common_game_availability
SET min_players = 2, max_players = 4, updated_at = pg_catalog.now()
WHERE game_id = 'brain-battle';

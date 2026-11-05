-- Brain Battle on the universal Multiplayer Core.
-- Legacy Brain Battle tables are empty and are intentionally retired.

INSERT INTO public.common_multiplayer_game_rules(game_id, min_players, max_players, is_enabled)
VALUES ('brain-battle', 2, 4, true)
ON CONFLICT (game_id) DO UPDATE SET
  min_players = EXCLUDED.min_players,
  max_players = EXCLUDED.max_players,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();

CREATE TABLE public.games_brain_battle_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.common_multiplayer_rooms(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  current_question_index smallint NOT NULL DEFAULT 0 CHECK (current_question_index BETWEEN 0 AND 10),
  question_started_at timestamptz NOT NULL,
  question_ends_at timestamptz NOT NULL,
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) = 10),
  status text NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'completed', 'cancelled')),
  final_results jsonb,
  winner_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (room_id, id)
);

CREATE UNIQUE INDEX games_brain_battle_one_active_match_per_room
  ON public.games_brain_battle_matches(room_id)
  WHERE status = 'playing';

CREATE TABLE public.games_brain_battle_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.games_brain_battle_matches(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.common_multiplayer_rooms(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(btrim(user_id)) > 0),
  question_index smallint NOT NULL CHECK (question_index BETWEEN 0 AND 9),
  selected_answer smallint CHECK (selected_answer BETWEEN 0 AND 3),
  is_correct boolean NOT NULL DEFAULT false,
  response_time_ms integer NOT NULL CHECK (response_time_ms BETWEEN 0 AND 15000),
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 150),
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, user_id, question_index)
);

CREATE INDEX games_brain_battle_answers_room_match_idx
  ON public.games_brain_battle_answers(room_id, match_id);

ALTER TABLE public.games_brain_battle_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_brain_battle_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.games_brain_battle_matches, public.games_brain_battle_answers
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.games_brain_battle_matches, public.games_brain_battle_answers
  TO service_role;

CREATE OR REPLACE FUNCTION public.brain_battle_start_match(
  p_room_id uuid,
  p_user_id text,
  p_questions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_started jsonb;
  v_started_at timestamptz;
  v_question_started_at timestamptz;
  v_match_id uuid;
BEGIN
  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id IS DISTINCT FROM 'brain-battle' THEN
    RAISE EXCEPTION 'Brain Battle is not selected' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id AND is_host
  ) THEN
    RAISE EXCEPTION 'Only the room host can start the match' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_questions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Questions must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_questions) <> 10 THEN
    RAISE EXCEPTION 'Exactly 10 questions are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_questions) AS question(value)
    WHERE jsonb_typeof(question.value) <> 'object'
       OR NOT (question.value ? 'question' AND question.value ? 'answers' AND question.value ? 'correctAnswer')
       OR jsonb_typeof(question.value->'answers') <> 'array'
       OR jsonb_array_length(
            CASE WHEN jsonb_typeof(question.value->'answers') = 'array'
              THEN question.value->'answers' ELSE '[]'::jsonb END
          ) <> 4
       OR COALESCE((question.value->>'correctAnswer') ~ '^[0-3]$', false) = false
  ) THEN
    RAISE EXCEPTION 'Invalid Brain Battle question payload' USING ERRCODE = '22023';
  END IF;

  v_started := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    pg_catalog.jsonb_build_object('roomId', p_room_id, 'gameId', 'brain-battle')
  );
  v_started_at := (v_started->>'startedAt')::timestamptz;
  v_question_started_at := v_started_at + interval '3 seconds';

  INSERT INTO public.games_brain_battle_matches(
    room_id, started_at, current_question_index, question_started_at,
    question_ends_at, questions
  )
  VALUES (
    p_room_id, v_started_at, 0, v_question_started_at,
    v_question_started_at + interval '15 seconds', p_questions
  )
  RETURNING id INTO v_match_id;

  RETURN pg_catalog.jsonb_build_object(
    'matchId', v_match_id,
    'currentQuestionIndex', 0,
    'questionStartedAt', v_question_started_at,
    'questionEndsAt', v_question_started_at + interval '15 seconds',
    'room', v_started
  );
END;
$function$;

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

  v_room_result := public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    pg_catalog.jsonb_build_object(
      'roomId', p_room_id, 'gameId', 'brain-battle', 'startedAt', v_match.started_at
    )
  );

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
  v_match public.games_brain_battle_matches%ROWTYPE;
  v_question jsonb;
  v_now timestamptz;
  v_response_time_ms integer;
  v_is_correct boolean;
  v_score integer;
  v_advance jsonb;
BEGIN
  SELECT * INTO v_match
  FROM public.games_brain_battle_matches
  WHERE id = p_match_id AND room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002'; END IF;
  IF v_match.status <> 'playing' THEN RAISE EXCEPTION 'Match is not active' USING ERRCODE = '55000'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_rooms
    WHERE id = p_room_id AND status = 'playing' AND started_at = v_match.started_at
  ) THEN RAISE EXCEPTION 'Match is no longer active' USING ERRCODE = '55000'; END IF;
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

CREATE OR REPLACE FUNCTION public.brain_battle_match_snapshot(
  p_room_id uuid,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room jsonb;
  v_match public.games_brain_battle_matches%ROWTYPE;
  v_players jsonb;
  v_my_answered boolean;
  v_question jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501'; END IF;

  v_room := public.multiplayer_room_snapshot(p_room_id);
  SELECT * INTO v_match
  FROM public.games_brain_battle_matches
  WHERE room_id = p_room_id AND status IN ('playing', 'completed')
  ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('room', v_room, 'match', NULL);
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'userId', p.user_id,
      'displayName', p.display_name,
      'score', COALESCE(s.total_score, 0),
      'correctAnswers', COALESCE(s.correct_answers, 0),
      'incorrectAnswers', COALESCE(s.incorrect_answers, 0),
      'skippedQuestions', COALESCE(s.skipped_questions, 0),
      'answeredCurrentQuestion', EXISTS (
        SELECT 1 FROM public.games_brain_battle_answers current_answer
        WHERE current_answer.match_id = v_match.id
          AND current_answer.user_id = p.user_id
          AND current_answer.question_index = v_match.current_question_index
      )
    ) ORDER BY p.joined_at, p.id
  ), '[]'::jsonb)
  INTO v_players
  FROM public.common_multiplayer_players p
  LEFT JOIN (
    SELECT user_id,
      sum(score)::integer AS total_score,
      count(*) FILTER (WHERE is_correct)::integer AS correct_answers,
      count(*) FILTER (WHERE selected_answer IS NOT NULL AND NOT is_correct)::integer AS incorrect_answers,
      count(*) FILTER (WHERE selected_answer IS NULL)::integer AS skipped_questions
    FROM public.games_brain_battle_answers
    WHERE match_id = v_match.id
    GROUP BY user_id
  ) s ON s.user_id = p.user_id
  WHERE p.room_id = p_room_id;

  SELECT EXISTS (
    SELECT 1 FROM public.games_brain_battle_answers
    WHERE match_id = v_match.id
      AND user_id = p_user_id
      AND question_index = v_match.current_question_index
  ) INTO v_my_answered;

  IF v_match.status = 'playing' THEN
    v_question := v_match.questions -> v_match.current_question_index;
    v_question := v_question - 'correctAnswer' - 'explanation';
  ELSE
    v_question := NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'room', v_room,
    'match', pg_catalog.jsonb_build_object(
      'matchId', v_match.id,
      'startedAt', v_match.started_at,
      'status', v_match.status,
      'currentQuestionIndex', v_match.current_question_index,
      'questionStartedAt', v_match.question_started_at,
      'questionEndsAt', v_match.question_ends_at,
      'currentQuestion', v_question,
      'players', v_players,
      'myAnswerSubmitted', v_my_answered,
      'finalResults', v_match.final_results,
      'winnerUserId', v_match.winner_user_id
    )
  );
END;
$function$;

-- A player leaving during a Brain Battle match returns the remaining room
-- members to the common lobby. Cancel the game-specific active match as well.
CREATE OR REPLACE FUNCTION public.brain_battle_cancel_active_match_on_room_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.status = 'playing' AND NEW.status IN ('waiting', 'cancelled') THEN
    UPDATE public.games_brain_battle_matches
    SET status = 'cancelled'
    WHERE room_id = NEW.id AND status = 'playing';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER brain_battle_cancel_match_on_room_reset
AFTER UPDATE OF status ON public.common_multiplayer_rooms
FOR EACH ROW
WHEN (OLD.status = 'playing' AND NEW.status IN ('waiting', 'cancelled'))
EXECUTE FUNCTION public.brain_battle_cancel_active_match_on_room_reset();

REVOKE ALL ON FUNCTION public.brain_battle_start_match(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brain_battle_advance_if_due(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brain_battle_submit_answer(uuid, uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brain_battle_match_snapshot(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brain_battle_cancel_active_match_on_room_reset() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brain_battle_start_match(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.brain_battle_advance_if_due(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.brain_battle_submit_answer(uuid, uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.brain_battle_match_snapshot(uuid, text) TO service_role;

-- Remove the first-generation, two-player Brain Battle implementation.
DROP FUNCTION IF EXISTS public.advance_brain_battle_if_due(uuid);
DROP FUNCTION IF EXISTS public.start_brain_battle_if_ready(uuid);
DROP FUNCTION IF EXISTS public.submit_brain_battle_answer(uuid, text, integer, integer);
DROP TABLE IF EXISTS public.brain_battle_answers CASCADE;
DROP TABLE IF EXISTS public.brain_battle_players CASCADE;
DROP TABLE IF EXISTS public.brain_battle_rooms CASCADE;
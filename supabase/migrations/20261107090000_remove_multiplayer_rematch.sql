-- Remove shared rematch voting while preserving the existing result-screen flow.
-- Game-specific matches remain in the room's playing state during result display.
-- Any member may return from completed results; after 60 seconds the client does
-- the same. Only then does the trusted game server mark the room finished.

DROP TRIGGER IF EXISTS multiplayer_rematch_unanimous_start_guard
  ON public.common_multiplayer_rooms;
DROP FUNCTION IF EXISTS public.enforce_multiplayer_rematch_unanimous_start();

CREATE OR REPLACE FUNCTION public.multiplayer_room_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'roomId', r.id,
    'gameId', r.game_id,
    'inviteCode', r.invite_code,
    'status', r.status,
    'maxPlayers', r.max_players,
    'createdAt', r.created_at,
    'startedAt', r.started_at,
    'finishedAt', r.finished_at,
    'players', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'userId', p.user_id,
          'displayName', p.display_name,
          'isReady', p.is_ready,
          'isHost', p.is_host,
          'joinedAt', p.joined_at,
          'lastSeenAt', p.last_seen_at,
          'wins', COALESCE(s.wins, 0),
          'matchesPlayed', COALESCE(s.matches_played, 0)
        ) ORDER BY p.joined_at, p.id
      )
      FROM public.common_multiplayer_players p
      LEFT JOIN public.common_multiplayer_room_stats s
        ON s.room_id = p.room_id AND s.user_id = p.user_id
      WHERE p.room_id = r.id
    ), '[]'::jsonb)
  )
  FROM public.common_multiplayer_rooms r
  WHERE r.id = p_room_id;
$function$;

CREATE OR REPLACE FUNCTION public.multiplayer_execute_action(
  p_action text,
  p_user_id text,
  p_display_name text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_room_id uuid;
  v_next_host_id uuid;
  v_invite_code text;
  v_game_id text;
  v_max_players integer;
  v_is_host boolean;
  v_player_count integer;
  v_ready_count integer;
  v_min_players integer;
  v_game_max_players integer;
  v_last_seen timestamptz;
  v_expected_started_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'Authenticated caller is required' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'create_room' THEN
    v_max_players := COALESCE((p_payload->>'maxPlayers')::integer, 4);
    IF v_max_players < 2 OR v_max_players > 4 THEN
      RAISE EXCEPTION 'maxPlayers must be between 2 and 4' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.common_multiplayer_rooms(game_id, max_players)
    VALUES (NULL, v_max_players)
    RETURNING * INTO v_room;
    INSERT INTO public.common_multiplayer_players(room_id, user_id, display_name, is_host, last_seen_at)
    VALUES (v_room.id, p_user_id, COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), 'Игрок'), true, pg_catalog.clock_timestamp());
    RETURN public.multiplayer_room_snapshot(v_room.id);
  END IF;

  IF p_action = 'join_room' THEN
    v_invite_code := pg_catalog.lower(pg_catalog.btrim(p_payload->>'inviteCode'));
    IF v_invite_code IS NULL OR v_invite_code = '' OR pg_catalog.length(v_invite_code) > 100 THEN
      RAISE EXCEPTION 'Invalid inviteCode' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_room FROM public.common_multiplayer_rooms
    WHERE invite_code = v_invite_code FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
    IF v_room.status NOT IN ('waiting', 'finished') THEN
      RAISE EXCEPTION 'Room is not accepting players' USING ERRCODE = '55000';
    END IF;
    UPDATE public.common_multiplayer_players
    SET display_name = COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), display_name),
        last_seen_at = pg_catalog.clock_timestamp()
    WHERE room_id = v_room.id AND user_id = p_user_id;
    IF FOUND THEN RETURN public.multiplayer_room_snapshot(v_room.id); END IF;
    SELECT count(*) INTO v_player_count FROM public.common_multiplayer_players WHERE room_id = v_room.id;
    IF v_player_count >= COALESCE(v_room.max_players, 4) THEN
      RAISE EXCEPTION 'Room is full' USING ERRCODE = '54000';
    END IF;
    INSERT INTO public.common_multiplayer_players(room_id, user_id, display_name, last_seen_at)
    VALUES (v_room.id, p_user_id, COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), 'Игрок'), pg_catalog.clock_timestamp());
    RETURN public.multiplayer_room_snapshot(v_room.id);
  END IF;

  BEGIN
    v_room_id := (p_payload->>'roomId')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid roomId' USING ERRCODE = '22023';
  END;
  IF v_room_id IS NULL THEN RAISE EXCEPTION 'roomId is required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;

  IF p_action IN ('start_game', 'finish_game') THEN
    IF p_user_id <> '__game_server__' THEN
      RAISE EXCEPTION 'Trusted game server is required' USING ERRCODE = '42501';
    END IF;
    IF p_payload->>'gameId' IS DISTINCT FROM v_room.game_id THEN
      RAISE EXCEPTION 'Game server is not authorized for this game' USING ERRCODE = '42501';
    END IF;
    IF p_action = 'start_game' THEN
      IF v_room.status NOT IN ('waiting', 'finished') OR v_room.game_id IS NULL THEN
        RAISE EXCEPTION 'Room cannot start a game in its current state' USING ERRCODE = '55000';
      END IF;
      SELECT min_players, max_players INTO v_min_players, v_game_max_players
      FROM public.common_multiplayer_game_rules
      WHERE game_id = v_room.game_id AND is_enabled = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected game is not enabled for multiplayer' USING ERRCODE = '55000';
      END IF;
      SELECT count(*), count(*) FILTER (
        WHERE is_ready AND last_seen_at >= pg_catalog.clock_timestamp() - interval '90 seconds'
      ) INTO v_player_count, v_ready_count
      FROM public.common_multiplayer_players WHERE room_id = v_room_id;
      IF v_player_count < v_min_players OR v_player_count > v_game_max_players THEN
        RAISE EXCEPTION 'Player count does not meet the selected game rules' USING ERRCODE = '55000';
      END IF;
      IF v_ready_count <> v_player_count THEN
        RAISE EXCEPTION 'All players must be ready to start a new match' USING ERRCODE = '55000';
      END IF;
      UPDATE public.common_multiplayer_rooms
      SET status = 'playing', started_at = pg_catalog.clock_timestamp(), finished_at = NULL
      WHERE id = v_room_id;
      UPDATE public.common_multiplayer_players SET is_ready = false WHERE room_id = v_room_id;
      RETURN public.multiplayer_room_snapshot(v_room_id);
    END IF;
    BEGIN
      v_expected_started_at := (p_payload->>'startedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'A valid startedAt value is required' USING ERRCODE = '22023';
    END;
    IF v_room.status = 'finished' AND v_room.started_at = v_expected_started_at THEN
      RETURN public.multiplayer_room_snapshot(v_room_id);
    END IF;
    IF v_room.status <> 'playing' OR v_room.started_at IS DISTINCT FROM v_expected_started_at THEN
      RAISE EXCEPTION 'Game session is no longer active' USING ERRCODE = '55000';
    END IF;
    UPDATE public.common_multiplayer_rooms
    SET status = 'finished',
        finished_at = pg_catalog.clock_timestamp()
    WHERE id = v_room_id;
    RETURN public.multiplayer_room_snapshot(v_room_id);
  END IF;

  SELECT p.is_host INTO v_is_host
  FROM public.common_multiplayer_players p
  WHERE p.room_id = v_room_id AND p.user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not a member of this room' USING ERRCODE = '42501'; END IF;

  IF p_action = 'get_room' THEN
    RETURN public.multiplayer_room_snapshot(v_room_id);
  ELSIF p_action = 'select_game' THEN
    IF NOT v_is_host THEN RAISE EXCEPTION 'Only the host can select a game' USING ERRCODE = '42501'; END IF;
    IF v_room.status NOT IN ('waiting', 'finished') THEN
      RAISE EXCEPTION 'Game selection is locked during a match' USING ERRCODE = '55000';
    END IF;
    v_game_id := pg_catalog.btrim(p_payload->>'gameId');
    IF v_game_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.common_multiplayer_game_rules
      WHERE game_id = v_game_id AND is_enabled = true
    ) THEN
      RAISE EXCEPTION 'Unsupported game selection' USING ERRCODE = '22023';
    END IF;
    UPDATE public.common_multiplayer_rooms SET game_id = v_game_id WHERE id = v_room_id;
    RETURN public.multiplayer_room_snapshot(v_room_id);
  ELSIF p_action = 'set_ready' THEN
    IF v_room.status NOT IN ('waiting', 'finished') THEN
      RAISE EXCEPTION 'Room is not accepting readiness changes' USING ERRCODE = '55000';
    END IF;
    IF pg_catalog.jsonb_typeof(p_payload->'isReady') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'isReady must be boolean' USING ERRCODE = '22023';
    END IF;
    UPDATE public.common_multiplayer_players
    SET is_ready = (p_payload->>'isReady')::boolean, last_seen_at = pg_catalog.clock_timestamp()
    WHERE room_id = v_room_id AND user_id = p_user_id;
    RETURN public.multiplayer_room_snapshot(v_room_id);
  ELSIF p_action = 'leave_room' THEN
    DELETE FROM public.common_multiplayer_players WHERE room_id = v_room_id AND user_id = p_user_id;
    IF v_room.status = 'playing' THEN
      UPDATE public.common_multiplayer_rooms
      SET status = 'waiting', game_id = NULL, started_at = NULL, finished_at = NULL
      WHERE id = v_room_id;
      UPDATE public.common_multiplayer_players SET is_ready = false WHERE room_id = v_room_id;
    END IF;
    IF v_is_host THEN
      SELECT id INTO v_next_host_id FROM public.common_multiplayer_players
      WHERE room_id = v_room_id ORDER BY joined_at, id LIMIT 1;
      IF FOUND THEN UPDATE public.common_multiplayer_players SET is_host = true WHERE id = v_next_host_id; END IF;
    END IF;
    SELECT count(*) INTO v_player_count FROM public.common_multiplayer_players WHERE room_id = v_room_id;
    IF v_player_count = 0 THEN
      UPDATE public.common_multiplayer_rooms SET status = 'cancelled' WHERE id = v_room_id;
    END IF;
    RETURN public.multiplayer_room_snapshot(v_room_id);
  ELSIF p_action = 'close_room' THEN
    IF NOT v_is_host THEN RAISE EXCEPTION 'Only the host can close the room' USING ERRCODE = '42501'; END IF;
    UPDATE public.common_multiplayer_rooms SET status = 'cancelled' WHERE id = v_room_id;
    RETURN public.multiplayer_room_snapshot(v_room_id);
  ELSIF p_action = 'heartbeat' THEN
    IF v_room.status NOT IN ('waiting', 'starting', 'playing', 'finished') THEN
      RAISE EXCEPTION 'Room is not active' USING ERRCODE = '55000';
    END IF;
    UPDATE public.common_multiplayer_players SET last_seen_at = pg_catalog.clock_timestamp()
    WHERE room_id = v_room_id AND user_id = p_user_id RETURNING last_seen_at INTO v_last_seen;
    RETURN pg_catalog.jsonb_build_object('roomId', v_room_id, 'lastSeenAt', v_last_seen);
  ELSIF p_action = 'get_room_token' THEN
    IF v_room.status NOT IN ('waiting', 'starting', 'playing', 'finished') THEN
      RAISE EXCEPTION 'Room is not active' USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object('roomId', v_room_id, 'telegramId', p_user_id, 'status', v_room.status);
  END IF;
  RAISE EXCEPTION 'Unknown multiplayer action' USING ERRCODE = '22023';
END;
$function$;

CREATE OR REPLACE FUNCTION public.reaction_rush_start_match(p_room_id uuid, p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_started jsonb;
  v_started_at timestamptz;
  v_match_id uuid;
BEGIN
  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id <> 'reaction-rush' THEN RAISE EXCEPTION 'Reaction Rush is not selected' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players p
    WHERE p.room_id = p_room_id AND p.user_id = p_user_id
      AND p.is_host
  ) THEN
    RAISE EXCEPTION 'Only the room host can start a new match' USING ERRCODE = '42501';
  END IF;
  v_started := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    pg_catalog.jsonb_build_object('roomId', p_room_id, 'gameId', 'reaction-rush')
  );
  v_started_at := (v_started->>'startedAt')::timestamptz;
  DELETE FROM public.games_reaction_rush_matches
  WHERE room_id = p_room_id AND status = 'completed';
  INSERT INTO public.games_reaction_rush_matches(room_id, started_at, round_started_at)
  VALUES (p_room_id, v_started_at, v_started_at) RETURNING id INTO v_match_id;
  RETURN pg_catalog.jsonb_build_object(
    'matchId', v_match_id, 'roundNumber', 1,
    'roundStartedAt', v_started_at, 'room', v_started
  );
END;
$function$;

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
    SELECT 1 FROM public.common_multiplayer_players p
    WHERE p.room_id = p_room_id AND p.user_id = p_user_id
      AND p.is_host
  ) THEN
    RAISE EXCEPTION 'Only the room host can start a new match' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.reaction_rush_finish_round(
  p_room_id uuid,
  p_match_id uuid,
  p_round_number integer,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_reaction_rush_matches%ROWTYPE;
  v_results jsonb;
  v_totals jsonb;
  v_winner text;
  v_round_started_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'Authenticated player is required' USING ERRCODE = '22023';
  END IF;

  -- Match Multiplayer mutation lock order: room first, then match.
  -- This serializes round completion with leave_room and membership changes.
  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id IS DISTINCT FROM 'reaction-rush'
     OR v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'Reaction Rush match is not active in this room' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match
  FROM public.games_reaction_rush_matches
  WHERE id = p_match_id AND room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002'; END IF;
  IF v_match.started_at IS DISTINCT FROM v_room.started_at THEN
    RAISE EXCEPTION 'Match does not belong to the active room session' USING ERRCODE = '55000';
  END IF;
  IF v_match.status <> 'playing' THEN RAISE EXCEPTION 'Match is not active' USING ERRCODE = '55000'; END IF;
  IF p_round_number <> v_match.current_round THEN
    RAISE EXCEPTION 'Round has already advanced' USING ERRCODE = '55000';
  END IF;
  IF pg_catalog.clock_timestamp() < v_match.round_started_at + interval '10 seconds' THEN
    RAISE EXCEPTION 'Round has not ended yet' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'userId', p.user_id, 'displayName', p.display_name, 'score', COALESCE(s.score, 0)
  ) ORDER BY p.joined_at, p.id), '[]'::jsonb)
  INTO v_results
  FROM public.common_multiplayer_players p
  LEFT JOIN public.games_reaction_rush_scores s
    ON s.match_id = p_match_id AND s.user_id = p.user_id AND s.round_number = p_round_number
  WHERE p.room_id = p_room_id;

  IF p_round_number < 3 THEN
    v_round_started_at := pg_catalog.clock_timestamp();
    UPDATE public.games_reaction_rush_matches
    SET current_round = current_round + 1, round_started_at = v_round_started_at
    WHERE id = p_match_id;
    RETURN pg_catalog.jsonb_build_object(
      'completedRound', p_round_number, 'roundResults', v_results,
      'roundNumber', p_round_number + 1, 'roundStartedAt', v_round_started_at,
      'matchFinished', false
    );
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'userId', p.user_id, 'displayName', p.display_name,
    'score', COALESCE(s.total_score, 0)
  ) ORDER BY COALESCE(s.total_score, 0) DESC, p.joined_at, p.id), '[]'::jsonb)
  INTO v_totals
  FROM public.common_multiplayer_players p
  LEFT JOIN (
    SELECT user_id, sum(score)::integer AS total_score
    FROM public.games_reaction_rush_scores WHERE match_id = p_match_id GROUP BY user_id
  ) s ON s.user_id = p.user_id
  WHERE p.room_id = p_room_id;

  SELECT CASE WHEN count(*) FILTER (WHERE total_score = max_score) = 1
    THEN max(user_id) FILTER (WHERE total_score = max_score) ELSE NULL END
  INTO v_winner
  FROM (
    SELECT user_id, sum(score)::integer AS total_score,
      max(sum(score)::integer) OVER () AS max_score
    FROM public.games_reaction_rush_scores
    WHERE match_id = p_match_id
    GROUP BY user_id
  ) ranked;

  INSERT INTO public.common_multiplayer_room_stats(room_id, user_id, wins, matches_played)
  SELECT p_room_id, p.user_id, CASE WHEN p.user_id = v_winner THEN 1 ELSE 0 END, 1
  FROM public.common_multiplayer_players p WHERE p.room_id = p_room_id
  ON CONFLICT (room_id, user_id) DO UPDATE SET
    wins = public.common_multiplayer_room_stats.wins + EXCLUDED.wins,
    matches_played = public.common_multiplayer_room_stats.matches_played + 1,
    updated_at = now();

  INSERT INTO public.games_reaction_rush_leaderboard(user_id, display_name, wins, matches_played, total_taps, best_match_score)
  SELECT p.user_id, p.display_name, CASE WHEN p.user_id = v_winner THEN 1 ELSE 0 END, 1,
    COALESCE(s.total_score, 0), COALESCE(s.total_score, 0)
  FROM public.common_multiplayer_players p
  LEFT JOIN (
    SELECT user_id, sum(score)::integer AS total_score
    FROM public.games_reaction_rush_scores WHERE match_id = p_match_id GROUP BY user_id
  ) s ON s.user_id = p.user_id
  WHERE p.room_id = p_room_id
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    wins = public.games_reaction_rush_leaderboard.wins + EXCLUDED.wins,
    matches_played = public.games_reaction_rush_leaderboard.matches_played + 1,
    total_taps = public.games_reaction_rush_leaderboard.total_taps + EXCLUDED.total_taps,
    best_match_score = GREATEST(public.games_reaction_rush_leaderboard.best_match_score, EXCLUDED.best_match_score),
    updated_at = now();

  UPDATE public.games_reaction_rush_matches
  SET status = 'completed', completed_at = now(),
      final_results = v_totals, winner_user_id = v_winner
  WHERE id = p_match_id;
  DELETE FROM public.games_reaction_rush_scores WHERE match_id = p_match_id;
  RETURN pg_catalog.jsonb_build_object(
    'completedRound', 3, 'roundResults', v_results, 'finalResults', v_totals,
    'winnerUserId', v_winner, 'matchFinished', true,
    'room', public.multiplayer_room_snapshot(p_room_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reaction_rush_match_snapshot(p_room_id uuid, p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_reaction_rush_matches%ROWTYPE;
  v_score integer;
BEGIN
  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.common_multiplayer_players WHERE room_id = p_room_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_match FROM public.games_reaction_rush_matches
  WHERE room_id = p_room_id AND status IN ('playing', 'completed')
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('room', public.multiplayer_room_snapshot(p_room_id), 'match', NULL);
  END IF;
  IF v_match.status = 'playing' THEN
    SELECT score INTO v_score FROM public.games_reaction_rush_scores
    WHERE match_id = v_match.id AND user_id = p_user_id AND round_number = v_match.current_round;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'room', public.multiplayer_room_snapshot(p_room_id),
    'match', pg_catalog.jsonb_build_object(
      'matchId', v_match.id,
      'roundNumber', v_match.current_round,
      'roundStartedAt', v_match.round_started_at,
      'startedAt', v_match.started_at,
      'completedAt', v_match.completed_at,
      'status', v_match.status,
      'finalResults', v_match.final_results,
      'winnerUserId', v_match.winner_user_id,
      'myScore', COALESCE(v_score, 0)
    )
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
      'completedAt', v_match.completed_at,
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

CREATE OR REPLACE FUNCTION public.no_count_it_match_snapshot(p_room_id uuid,p_user_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
 v_room jsonb; v_match public.games_no_count_it_matches%ROWTYPE; v_round public.games_no_count_it_rounds%ROWTYPE;
 v_players jsonb; v_round_players jsonb; v_all_answered boolean; v_active_count integer; v_answered_count integer;
 v_average bigint; v_now timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.common_multiplayer_players WHERE room_id=p_room_id AND user_id=p_user_id) THEN
  RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.common_multiplayer_rooms WHERE id=p_room_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE='P0002'; END IF;
 SELECT public.multiplayer_room_snapshot(p_room_id) INTO v_room;
 SELECT * INTO v_match FROM public.games_no_count_it_matches
 WHERE room_id=p_room_id AND status IN ('preparing','playing','completed','technical_aborted','cancelled')
 ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('room',v_room,'match',NULL); END IF;
 SELECT * INTO v_round FROM public.games_no_count_it_rounds
 WHERE match_id=v_match.id AND round_number=v_match.current_round FOR UPDATE;
 IF FOUND AND v_match.status='playing' AND v_round.status='showing' AND v_now>=v_round.show_started_at+interval '5 seconds' THEN
  UPDATE public.games_no_count_it_rounds SET status='answering' WHERE id=v_round.id;
  v_round.status:='answering';
 END IF;
 IF FOUND AND v_match.status='playing' AND v_round.status IN ('showing','answering') THEN
  SELECT count(*) FILTER(WHERE status IN ('active','completed')),count(*) FILTER(WHERE status='completed')
  INTO v_active_count,v_answered_count FROM public.games_no_count_it_round_players
  WHERE match_id=v_match.id AND round_number=v_match.current_round;
  v_all_answered:=v_active_count>0 AND v_answered_count=v_active_count;
  IF v_all_answered OR v_now>=v_round.answer_deadline THEN
   UPDATE public.games_no_count_it_round_players SET error=v_round.correct_count,status='completed'
   WHERE match_id=v_match.id AND round_number=v_match.current_round AND status='active';
   SELECT COALESCE(ceil(avg(error) FILTER(WHERE status='completed')),0)::bigint INTO v_average
   FROM public.games_no_count_it_round_players WHERE match_id=v_match.id AND round_number=v_match.current_round AND status='completed';
   UPDATE public.games_no_count_it_round_players SET error=v_average,status='completed'
   WHERE match_id=v_match.id AND round_number=v_match.current_round AND status='excluded_not_ready';
   UPDATE public.games_no_count_it_match_players mp SET total_error=mp.total_error+rp.error
   FROM public.games_no_count_it_round_players rp
   WHERE rp.match_id=v_match.id AND rp.round_number=v_match.current_round AND rp.user_id=mp.user_id AND mp.match_id=v_match.id;
   UPDATE public.games_no_count_it_rounds SET status='revealing',reveal_started_at=v_now
   WHERE id=v_round.id AND status IN ('showing','answering');
   v_round.status:='revealing';
  END IF;
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',mp.user_id,'displayName',mp.display_name,'totalError',mp.total_error,
  'roundErrors',(SELECT jsonb_agg(rp.error ORDER BY rp.round_number) FROM public.games_no_count_it_round_players rp WHERE rp.match_id=mp.match_id AND rp.user_id=mp.user_id)
 ) ORDER BY mp.joined_at,mp.user_id),'[]'::jsonb)
 INTO v_players FROM public.games_no_count_it_match_players mp WHERE mp.match_id=v_match.id;
 IF v_round.id IS NOT NULL THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',mp.user_id,'displayName',mp.display_name,'status',rp.status,
   'answer',CASE WHEN v_round.status IN ('revealing','completed') THEN rp.answer ELSE NULL END,
   'error',CASE WHEN v_round.status IN ('revealing','completed') THEN rp.error ELSE NULL END,
   'answeredAt',CASE WHEN v_round.status IN ('revealing','completed') THEN rp.answered_at ELSE NULL END
  ) ORDER BY mp.joined_at,mp.user_id),'[]'::jsonb)
  INTO v_round_players FROM public.games_no_count_it_round_players rp
  JOIN public.games_no_count_it_match_players mp ON mp.match_id=rp.match_id AND mp.user_id=rp.user_id
  WHERE rp.match_id=v_match.id AND rp.round_number=v_match.current_round;
 END IF;
 RETURN jsonb_build_object('room',v_room,'match',jsonb_build_object(
  'matchId',v_match.id,'startedAt',v_match.started_at,'completedAt',v_match.completed_at,'status',v_match.status,'currentRound',v_match.current_round,
  'players',v_players,'winnerUserId',v_match.winner_user_id,'finalResults',v_match.final_results,
  'round',CASE WHEN v_round.id IS NULL THEN NULL ELSE jsonb_build_object(
   'roundNumber',v_round.round_number,'status',v_round.status,'targetColor',v_round.target_color,
   'preparationDeadline',v_round.preparation_deadline,'showStartedAt',v_round.show_started_at,'answerDeadline',v_round.answer_deadline,
   'correctCount',CASE WHEN v_round.status IN ('revealing','completed') THEN v_round.correct_count ELSE NULL END,
   'imagePath',v_round.image_path,'players',COALESCE(v_round_players,'[]'::jsonb)
  ) END
 ));
END;$function$;

DROP TABLE IF EXISTS public.common_multiplayer_rematch_votes;

ALTER TABLE public.common_multiplayer_rooms
  DROP COLUMN IF EXISTS rematch_status,
  DROP COLUMN IF EXISTS rematch_deadline_at;

ALTER TABLE public.common_multiplayer_game_rules
  DROP COLUMN IF EXISTS lifecycle_mode;

-- Remove the shared rematch-voting lifecycle while preserving normal room reuse.
-- Match results remain visible for up to 60 seconds in the client; the room is
-- marked finished immediately and remains available for the ordinary ready/start flow.

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

DROP TABLE IF EXISTS public.common_multiplayer_rematch_votes;

ALTER TABLE public.common_multiplayer_rooms
  DROP COLUMN IF EXISTS rematch_status,
  DROP COLUMN IF EXISTS rematch_deadline_at;

ALTER TABLE public.common_multiplayer_game_rules
  DROP COLUMN IF EXISTS lifecycle_mode;

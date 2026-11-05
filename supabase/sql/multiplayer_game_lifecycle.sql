-- Multiplayer game lifecycle actions.
-- Apply this patch to the existing Multiplayer schema before deploying the
-- matching Edge Function code. This repository currently has no migration
-- history, so this is kept as an explicit SQL patch rather than pretending
-- it is part of a reproducible migration chain.

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
  v_last_seen timestamptz;
  v_expected_started_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'Authenticated caller is required' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'create_room' THEN
    v_game_id := pg_catalog.btrim(p_payload->>'gameId');
    IF v_game_id IS NULL OR v_game_id = '' OR pg_catalog.length(v_game_id) > 80 THEN
      RAISE EXCEPTION 'Invalid gameId' USING ERRCODE = '22023';
    END IF;

    IF p_payload ? 'maxPlayers' THEN
      BEGIN
        v_max_players := (p_payload->>'maxPlayers')::integer;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid maxPlayers' USING ERRCODE = '22023';
      END;
      IF v_max_players < 1 OR v_max_players > 100 THEN
        RAISE EXCEPTION 'maxPlayers must be between 1 and 100' USING ERRCODE = '22023';
      END IF;
    END IF;

    INSERT INTO public.common_multiplayer_rooms(game_id, max_players)
    VALUES (v_game_id, v_max_players)
    RETURNING * INTO v_room;

    INSERT INTO public.common_multiplayer_players(
      room_id, user_id, display_name, is_host, last_seen_at
    ) VALUES (
      v_room.id, p_user_id,
      COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), 'Игрок'),
      true, pg_catalog.clock_timestamp()
    );

    RETURN public.multiplayer_room_snapshot(v_room.id);
  END IF;

  IF p_action = 'join_room' THEN
    v_invite_code := pg_catalog.lower(pg_catalog.btrim(p_payload->>'inviteCode'));
    IF v_invite_code IS NULL OR v_invite_code = '' OR pg_catalog.length(v_invite_code) > 100 THEN
      RAISE EXCEPTION 'Invalid inviteCode' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_room
    FROM public.common_multiplayer_rooms
    WHERE invite_code = v_invite_code
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_room.status NOT IN ('waiting', 'finished') THEN
      RAISE EXCEPTION 'Room is not accepting players' USING ERRCODE = '55000';
    END IF;

    -- Existing members may reconnect even when the room is at capacity.
    UPDATE public.common_multiplayer_players
    SET display_name = COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), display_name),
        last_seen_at = pg_catalog.clock_timestamp()
    WHERE room_id = v_room.id AND user_id = p_user_id;

    IF FOUND THEN
      RETURN public.multiplayer_room_snapshot(v_room.id);
    END IF;

    SELECT count(*) INTO v_player_count
    FROM public.common_multiplayer_players
    WHERE room_id = v_room.id;

    IF v_room.max_players IS NOT NULL AND v_player_count >= v_room.max_players THEN
      RAISE EXCEPTION 'Room is full' USING ERRCODE = '54000';
    END IF;

    INSERT INTO public.common_multiplayer_players(
      room_id, user_id, display_name, last_seen_at
    ) VALUES (
      v_room.id, p_user_id,
      COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), 'Игрок'),
      pg_catalog.clock_timestamp()
    );

    RETURN public.multiplayer_room_snapshot(v_room.id);
  END IF;

  BEGIN
    v_room_id := (p_payload->>'roomId')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid roomId' USING ERRCODE = '22023';
  END;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'roomId is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = v_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002';
  END IF;

  -- These actions are reachable only through the Edge Function's separate
  -- game-server secret check. The database function is executable only by
  -- service_role, never by browser roles.
  IF p_action IN ('start_game', 'finish_game') THEN
    IF p_user_id <> '__game_server__' THEN
      RAISE EXCEPTION 'Trusted game server is required' USING ERRCODE = '42501';
    END IF;
    IF p_payload->>'gameId' IS DISTINCT FROM v_room.game_id THEN
      RAISE EXCEPTION 'Game server is not authorized for this game' USING ERRCODE = '42501';
    END IF;

    IF p_action = 'start_game' THEN
      IF v_room.status NOT IN ('waiting', 'finished') THEN
        RAISE EXCEPTION 'Room cannot start a game in its current state' USING ERRCODE = '55000';
      END IF;

      SELECT
        count(*),
        count(*) FILTER (
          WHERE is_ready = true
            AND last_seen_at >= pg_catalog.clock_timestamp() - interval '90 seconds'
        )
      INTO v_player_count, v_ready_count
      FROM public.common_multiplayer_players
      WHERE room_id = v_room_id;

      IF v_player_count = 0 OR v_ready_count <> v_player_count THEN
        RAISE EXCEPTION 'All room players must be connected and ready' USING ERRCODE = '55000';
      END IF;

      UPDATE public.common_multiplayer_rooms
      SET status = 'playing',
          started_at = pg_catalog.clock_timestamp(),
          finished_at = NULL
      WHERE id = v_room_id;

      -- Readiness is consumed by this round; players confirm again for the next one.
      UPDATE public.common_multiplayer_players
      SET is_ready = false
      WHERE room_id = v_room_id;

      RETURN public.multiplayer_room_snapshot(v_room_id);
    END IF;

    BEGIN
      v_expected_started_at := (p_payload->>'startedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'A valid startedAt value is required' USING ERRCODE = '22023';
    END;

    IF v_expected_started_at IS NULL THEN
      RAISE EXCEPTION 'A valid startedAt value is required' USING ERRCODE = '22023';
    END IF;

    -- Idempotent retry for the same game session. A stale finish request from
    -- a previous game cannot finish a newer game in the same room.
    IF v_room.status = 'finished'
       AND v_room.started_at = v_expected_started_at THEN
      RETURN public.multiplayer_room_snapshot(v_room_id);
    END IF;

    IF v_room.status <> 'playing'
       OR v_room.started_at IS DISTINCT FROM v_expected_started_at THEN
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a member of this room' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'get_room' THEN
    RETURN public.multiplayer_room_snapshot(v_room_id);

  ELSIF p_action = 'set_ready' THEN
    IF v_room.status NOT IN ('waiting', 'finished') THEN
      RAISE EXCEPTION 'Room is not accepting readiness changes' USING ERRCODE = '55000';
    END IF;
    IF pg_catalog.jsonb_typeof(p_payload->'isReady') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'isReady must be boolean' USING ERRCODE = '22023';
    END IF;
    UPDATE public.common_multiplayer_players
    SET is_ready = (p_payload->>'isReady')::boolean,
        last_seen_at = pg_catalog.clock_timestamp()
    WHERE room_id = v_room_id AND user_id = p_user_id;
    RETURN public.multiplayer_room_snapshot(v_room_id);

  ELSIF p_action = 'leave_room' THEN
    DELETE FROM public.common_multiplayer_players
    WHERE room_id = v_room_id AND user_id = p_user_id;

    IF v_is_host THEN
      SELECT id INTO v_next_host_id
      FROM public.common_multiplayer_players
      WHERE room_id = v_room_id
      ORDER BY joined_at, id
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.common_multiplayer_players
        SET is_host = true
        WHERE id = v_next_host_id;
      END IF;
    END IF;

    SELECT count(*) INTO v_player_count
    FROM public.common_multiplayer_players
    WHERE room_id = v_room_id;

    IF v_player_count = 0 AND v_room.status <> 'cancelled' THEN
      UPDATE public.common_multiplayer_rooms
      SET status = 'cancelled'
      WHERE id = v_room_id
        AND status IN ('waiting', 'starting', 'playing', 'finished');
    END IF;

    RETURN public.multiplayer_room_snapshot(v_room_id);

  ELSIF p_action = 'close_room' THEN
    IF NOT v_is_host THEN
      RAISE EXCEPTION 'Only the host can close the room' USING ERRCODE = '42501';
    END IF;
    UPDATE public.common_multiplayer_rooms
    SET status = 'cancelled'
    WHERE id = v_room_id
      AND status IN ('waiting', 'starting', 'playing', 'finished');
    RETURN public.multiplayer_room_snapshot(v_room_id);

  ELSIF p_action = 'heartbeat' THEN
    IF v_room.status NOT IN ('waiting', 'starting', 'playing', 'finished') THEN
      RAISE EXCEPTION 'Room is not active' USING ERRCODE = '55000';
    END IF;
    UPDATE public.common_multiplayer_players
    SET last_seen_at = pg_catalog.clock_timestamp()
    WHERE room_id = v_room_id AND user_id = p_user_id
    RETURNING last_seen_at INTO v_last_seen;
    RETURN pg_catalog.jsonb_build_object(
      'roomId', v_room_id,
      'lastSeenAt', v_last_seen
    );

  ELSIF p_action = 'get_room_token' THEN
    IF v_room.status NOT IN ('waiting', 'starting', 'playing', 'finished') THEN
      RAISE EXCEPTION 'Room is not active' USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'roomId', v_room_id,
      'telegramId', p_user_id,
      'status', v_room.status
    );
  END IF;

  RAISE EXCEPTION 'Unknown multiplayer action' USING ERRCODE = '22023';
END;
$function$;

CREATE OR REPLACE FUNCTION public.multiplayer_record_heartbeat(
  p_room_id uuid,
  p_user_id text
)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_status text;
  v_last_seen_at timestamptz;
BEGIN
  SELECT r.status
    INTO v_status
  FROM public.common_multiplayer_rooms AS r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status NOT IN ('waiting', 'starting', 'playing', 'finished') THEN
    RAISE EXCEPTION 'Room is not active' USING ERRCODE = '55000';
  END IF;

  UPDATE public.common_multiplayer_players AS p
  SET last_seen_at = pg_catalog.clock_timestamp()
  WHERE p.room_id = p_room_id
    AND p.user_id = p_user_id
  RETURNING p.last_seen_at INTO v_last_seen_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player is not a member of this room'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_last_seen_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.multiplayer_cancel_idle_rooms()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_room record;
  v_last_seen timestamptz;
  v_cancelled_count integer := 0;
BEGIN
  FOR v_room IN
    SELECT r.id, r.created_at
    FROM public.common_multiplayer_rooms AS r
    WHERE r.status IN ('waiting', 'starting', 'playing', 'finished')
    ORDER BY r.created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT pg_catalog.max(p.last_seen_at)
      INTO v_last_seen
    FROM public.common_multiplayer_players AS p
    WHERE p.room_id = v_room.id;

    IF COALESCE(v_last_seen, v_room.created_at)
       <= pg_catalog.clock_timestamp() - interval '10 minutes'
    THEN
      UPDATE public.common_multiplayer_rooms AS r
      SET status = 'cancelled'
      WHERE r.id = v_room.id
        AND r.status IN ('waiting', 'starting', 'playing', 'finished');

      IF FOUND THEN
        v_cancelled_count := v_cancelled_count + 1;
        BEGIN
          PERFORM realtime.send(
            payload => pg_catalog.jsonb_build_object(
              'roomId', v_room.id,
              'status', 'cancelled',
              'reason', 'idle_timeout'
            ),
            event => 'room_updated',
            topic => 'room:' || v_room.id::text,
            private => true
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING
            'Failed to broadcast idle room cancellation for %: %',
            v_room.id,
            SQLERRM;
        END;
      END IF;
    END IF;
  END LOOP;
  RETURN v_cancelled_count;
END;
$function$;

-- Keep the privileged action RPC unavailable to browser roles.
REVOKE ALL ON FUNCTION public.multiplayer_execute_action(text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.multiplayer_execute_action(text, text, text, jsonb)
  TO service_role;

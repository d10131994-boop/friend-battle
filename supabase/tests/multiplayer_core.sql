-- Multiplayer Core integration checks.
-- Run only against a disposable/local Supabase database.
-- The enclosing transaction rolls back all synthetic rooms and players.

BEGIN;

DO $test$
DECLARE
  v_host text := '__fb_test_host_' || replace(gen_random_uuid()::text, '-', '');
  v_guest text := '__fb_test_guest_' || replace(gen_random_uuid()::text, '-', '');
  v_intruder text := '__fb_test_intruder_' || replace(gen_random_uuid()::text, '-', '');
  v_room jsonb;
  v_room_id uuid;
  v_started_at text;
  v_rejected boolean;
  v_host_player jsonb;
BEGIN
  -- A room may be created without selecting a game.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host, 'Test host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  IF v_room->>'gameId' IS NOT NULL OR v_room->>'status' <> 'waiting' THEN
    RAISE EXCEPTION 'New room must be waiting with no selected game';
  END IF;

  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest, 'Test guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );

  -- A non-member cannot read the room.
  v_rejected := false;
  BEGIN
    PERFORM public.multiplayer_execute_action(
      'get_room', v_intruder, 'Intruder', jsonb_build_object('roomId', v_room_id)
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Non-member unexpectedly read the room'; END IF;

  -- Only the host can select a game.
  v_rejected := false;
  BEGIN
    PERFORM public.multiplayer_execute_action(
      'select_game', v_guest, 'Test guest',
      jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Non-host unexpectedly selected the game'; END IF;

  PERFORM public.multiplayer_execute_action(
    'select_game', v_host, 'Test host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host, 'Test host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest, 'Test guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );

  -- Server-authoritative start and finish; stale session IDs must be rejected.
  v_room := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  IF v_room->>'status' <> 'playing' THEN RAISE EXCEPTION 'Room did not enter playing state'; END IF;
  v_started_at := v_room->>'startedAt';

  v_rejected := false;
  BEGIN
    PERFORM public.multiplayer_execute_action(
      'finish_game', '__game_server__', 'Game server',
      jsonb_build_object(
        'roomId', v_room_id,
        'gameId', 'reaction-rush',
        'startedAt', '2000-01-01T00:00:00Z'
      )
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Stale session unexpectedly finished the room'; END IF;

  v_room := public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    jsonb_build_object(
      'roomId', v_room_id,
      'gameId', 'reaction-rush',
      'startedAt', v_started_at
    )
  );
  IF v_room->>'status' <> 'finished' THEN RAISE EXCEPTION 'Room did not finish'; END IF;

  -- Repeating finish for the same completed session is idempotent.
  v_room := public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    jsonb_build_object(
      'roomId', v_room_id,
      'gameId', 'reaction-rush',
      'startedAt', v_started_at
    )
  );
  IF v_room->>'status' <> 'finished' THEN RAISE EXCEPTION 'Repeated finish was not idempotent'; END IF;

  -- Leaving during an active match resets the shared room and readiness.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_leave', 'Test host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_leave', 'Test guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_leave', 'Test host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_leave', 'Test host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_leave', 'Test guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  v_room := public.multiplayer_execute_action(
    'leave_room', v_guest || '_leave', 'Test guest',
    jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'status' <> 'waiting' OR v_room->>'gameId' IS NOT NULL THEN
    RAISE EXCEPTION 'Leaving during a match did not reset the room';
  END IF;
  SELECT pg_catalog.to_jsonb(p) INTO v_host_player
  FROM public.common_multiplayer_players p
  WHERE p.room_id = v_room_id AND p.user_id = v_host || '_leave';
  IF v_host_player IS NULL OR (v_host_player->>'is_ready')::boolean THEN
    RAISE EXCEPTION 'Remaining player must stay in room and become not-ready';
  END IF;
END;
$test$;

ROLLBACK;

-- Open default rematch votes cannot be bypassed by the legacy all-ready start path.
-- Run only against an isolated/local Supabase database.
BEGIN;

DO $test$
DECLARE
  v_host text := '__fb_guard_host_' || replace(gen_random_uuid()::text, '-', '');
  v_guest text := '__fb_guard_guest_' || replace(gen_random_uuid()::text, '-', '');
  v_room jsonb;
  v_room_id uuid;
  v_started_at timestamptz;
  v_blocked boolean := false;
BEGIN
  v_room := public.multiplayer_execute_action(
    'create_room', v_host, 'Host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;

  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest, 'Guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host, 'Host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host, 'Host', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest, 'Guest', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );

  v_room := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  v_started_at := v_room->>'startedAt';

  PERFORM public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    jsonb_build_object(
      'roomId', v_room_id,
      'gameId', 'reaction-rush',
      'startedAt', v_started_at
    )
  );

  -- Recreate the legacy all-ready condition. It must not override an open vote.
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host, 'Host', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest, 'Guest', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );

  BEGIN
    PERFORM public.multiplayer_execute_action(
      'start_game', '__game_server__', 'Game server',
      jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'An open default rematch vote must not be bypassed by readiness';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_rooms
    WHERE id = v_room_id AND status = 'finished' AND rematch_status = 'open'
  ) THEN
    RAISE EXCEPTION 'Blocked rematch attempt must leave the room and vote unchanged';
  END IF;
END;
$test$;

ROLLBACK;

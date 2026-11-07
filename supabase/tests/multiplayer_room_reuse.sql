-- Shared room lifecycle: completed results stay visible until an explicit
-- return action (or the client-side 60-second timeout) finishes the room.
-- Run only against a disposable/local Supabase database.
-- All synthetic data is rolled back.

BEGIN;

DO $test$
DECLARE
  v_host text := '__fb_room_reuse_host_' || replace(gen_random_uuid()::text, '-', '');
  v_guest text := '__fb_room_reuse_guest_' || replace(gen_random_uuid()::text, '-', '');
  v_room jsonb;
  v_room_id uuid;
  v_first_started_at text;
  v_blocked boolean := false;
BEGIN
  v_room := public.multiplayer_execute_action(
    'create_room', v_host, 'Host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest, 'Guest', jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host, 'Host', jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
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
  v_first_started_at := v_room->>'startedAt';

  -- A finished game-specific result does not itself finish the shared room.
  v_room := public.multiplayer_execute_action(
    'get_room', v_host, 'Host', jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'status' <> 'playing' THEN
    RAISE EXCEPTION 'The room must remain playing while results are displayed';
  END IF;

  -- A room member returning from results triggers the trusted finish action.
  v_room := public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush', 'startedAt', v_first_started_at)
  );
  IF v_room->>'status' <> 'finished' OR v_room->>'finishedAt' IS NULL THEN
    RAISE EXCEPTION 'The return action must finish the current room session';
  END IF;
  IF v_room ? 'rematchStatus' OR v_room ? 'rematchDeadlineAt' OR v_room ? 'rematchVotes' THEN
    RAISE EXCEPTION 'Room snapshots must not expose rematch state';
  END IF;

  -- The next match is a normal ready/start flow, not a rematch bypass.
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host, 'Host', jsonb_build_object('roomId', v_room_id, 'isReady', true)
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
    RAISE EXCEPTION 'A new match must wait until every current player is ready';
  END IF;

  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest, 'Guest', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_room := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  IF v_room->>'status' <> 'playing' OR v_room->>'startedAt' = v_first_started_at THEN
    RAISE EXCEPTION 'The same room must support a fresh normal match';
  END IF;

  -- A stale finish request cannot finish the newer match.
  BEGIN
    PERFORM public.multiplayer_execute_action(
      'finish_game', '__game_server__', 'Game server',
      jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush', 'startedAt', v_first_started_at)
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'A stale session must not finish a newer match';
  END IF;

  -- Existing leave semantics are preserved: leaving during play resets the
  -- room; only the last explicit departure cancels it.
  v_room := public.multiplayer_execute_action(
    'leave_room', v_guest, 'Guest', jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'status' <> 'waiting' OR v_room->>'gameId' IS NOT NULL THEN
    RAISE EXCEPTION 'Leaving during play must keep the room reusable and reset its selected game';
  END IF;
  v_room := public.multiplayer_execute_action(
    'leave_room', v_host, 'Host', jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'status' <> 'cancelled' THEN
    RAISE EXCEPTION 'The room must be cancelled after its last member explicitly leaves';
  END IF;
END;
$test$;

ROLLBACK;

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
  v_match_id uuid;
  v_questions jsonb;
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
  v_room := public.reaction_rush_start_match(v_room_id, v_host || '_leave');
  v_match_id := (v_room->>'matchId')::uuid;
  v_room := public.multiplayer_execute_action(
    'leave_room', v_guest || '_leave', 'Test guest',
    jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'status' <> 'waiting' OR v_room->>'gameId' IS NOT NULL THEN
    RAISE EXCEPTION 'Leaving during a match did not reset the room';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.games_reaction_rush_matches WHERE id = v_match_id
  ) THEN
    RAISE EXCEPTION 'Reaction Rush game module did not clean up its interrupted match';
  END IF;
  SELECT pg_catalog.to_jsonb(p) INTO v_host_player
  FROM public.common_multiplayer_players p
  WHERE p.room_id = v_room_id AND p.user_id = v_host || '_leave';
  IF v_host_player IS NULL OR (v_host_player->>'is_ready')::boolean THEN
    RAISE EXCEPTION 'Remaining player must stay in room and become not-ready';
  END IF;

  -- Brain Battle owns its cleanup hook too: room reset cancels its active match.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_brain', 'Test host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_brain', 'Test guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_brain', 'Test host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'brain-battle')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_brain', 'Test host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_brain', 'Test guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  SELECT jsonb_agg(jsonb_build_object(
    'id', question_number,
    'question', 'Test question',
    'answers', jsonb_build_array('A', 'B', 'C', 'D'),
    'correctAnswer', 0
  ))
  INTO v_questions
  FROM generate_series(1, 10) AS series(question_number);
  v_room := public.brain_battle_start_match(
    v_room_id, v_host || '_brain', v_questions
  );
  v_match_id := (v_room->>'matchId')::uuid;
  v_room := public.multiplayer_execute_action(
    'leave_room', v_guest || '_brain', 'Test guest',
    jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'status' <> 'waiting' OR v_room->>'gameId' IS NOT NULL THEN
    RAISE EXCEPTION 'Leaving Brain Battle during a match did not reset the room';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.games_brain_battle_matches
    WHERE id = v_match_id AND status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Brain Battle game module did not cancel its interrupted match';
  END IF;

  -- Closing a room during an active Reaction Rush match also cleans game state.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_close', 'Test host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_close', 'Test guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_close', 'Test host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_close', 'Test host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_close', 'Test guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_room := public.reaction_rush_start_match(v_room_id, v_host || '_close');
  v_match_id := (v_room->>'matchId')::uuid;
  v_room := public.multiplayer_execute_action(
    'close_room', v_host || '_close', 'Test host',
    jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'status' <> 'cancelled' THEN
    RAISE EXCEPTION 'Closing an active room did not cancel it';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.games_reaction_rush_matches WHERE id = v_match_id
  ) THEN
    RAISE EXCEPTION 'Closing the room did not clean its interrupted Reaction Rush match';
  END IF;

  -- Democracy Merge can remove a player without resetting the shared match.
  INSERT INTO public.common_multiplayer_game_rules(game_id, min_players, max_players, is_enabled)
  VALUES ('democracy-merge', 2, 4, true)
  ON CONFLICT (game_id) DO UPDATE SET min_players=2, max_players=4, is_enabled=true;

  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_dm_leave', 'DM host', jsonb_build_object('maxPlayers', 3)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_dm_leave', 'DM guest 1',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'join_room', v_host || '_dm_leave_2', 'DM guest 2',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_dm_leave', 'DM host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_dm_leave', 'DM host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_dm_leave', 'DM guest 1',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_dm_leave_2', 'DM guest 2',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_room := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge')
  );
  v_started_at := v_room->>'startedAt';

  -- A normal client cannot invoke the trusted departure action.
  v_rejected := false;
  BEGIN
    PERFORM public.multiplayer_execute_action(
      'leave_active_match', v_guest || '_dm_leave', 'DM guest 1',
      jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge',
        'playerUserId', v_guest || '_dm_leave')
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Only the trusted game server may request active-match departure';
  END IF;

  -- The host leaves, the match continues, and the earliest remaining member becomes host.
  v_room := public.multiplayer_execute_action(
    'leave_active_match', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge',
      'playerUserId', v_host || '_dm_leave')
  );
  IF v_room->>'status' <> 'playing'
     OR v_room->>'gameId' <> 'democracy-merge'
     OR v_room->>'startedAt' <> v_started_at
     OR jsonb_array_length(v_room->'players') <> 2 THEN
    RAISE EXCEPTION 'Active-match departure must preserve the room and ongoing session';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id=v_room_id AND user_id=v_guest || '_dm_leave' AND is_host
  ) THEN
    RAISE EXCEPTION 'Host must transfer to the earliest remaining member';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id=v_room_id AND user_id=v_host || '_dm_leave'
  ) THEN
    RAISE EXCEPTION 'Departed player must be removed from room membership';
  END IF;

  -- A final departure cancels the room; existing leave_room remains separate.
  PERFORM public.multiplayer_execute_action(
    'leave_active_match', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge',
      'playerUserId', v_guest || '_dm_leave')
  );
  v_room := public.multiplayer_execute_action(
    'leave_active_match', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge',
      'playerUserId', v_host || '_dm_leave_2')
  );
  IF v_room->>'status' <> 'cancelled' THEN
    RAISE EXCEPTION 'The room must close after the final member departs';
  END IF;

END;
$test$;

ROLLBACK;

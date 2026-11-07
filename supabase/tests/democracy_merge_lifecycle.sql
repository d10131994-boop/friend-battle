-- Democracy Merge player departure, final result preservation and five-minute expiry.
-- Run only against a disposable/local Supabase database. All changes roll back.

BEGIN;

DO $test$
DECLARE
  v_host text := '__fb_dm_host_' || replace(gen_random_uuid()::text, '-', '');
  v_guest text := '__fb_dm_guest_' || replace(gen_random_uuid()::text, '-', '');
  v_room jsonb;
  v_room_id uuid;
  v_started_at timestamptz;
  v_match_id uuid;
  v_expired integer;
  v_board jsonb;
BEGIN
  INSERT INTO public.common_multiplayer_game_rules(game_id, min_players, max_players, is_enabled)
  VALUES ('democracy-merge', 2, 4, true)
  ON CONFLICT (game_id) DO UPDATE
  SET min_players=2, max_players=4, is_enabled=true;

  SELECT jsonb_agg(NULL::jsonb) INTO v_board FROM generate_series(1, 36);

  -- Explicit departure preserves an active match until the final active player leaves.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host, 'DM host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest, 'DM guest', jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host, 'DM host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host, 'DM host', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest, 'DM guest', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_room := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge')
  );
  v_started_at := (v_room->>'startedAt')::timestamptz;
  INSERT INTO public.games_democracy_merge_matches(
    room_id, started_at, game_started_at, deadline_at, character_sequence, obstacle_sequence
  ) VALUES (
    v_room_id, v_started_at, v_started_at + interval '5 seconds',
    v_started_at + interval '30 minutes', '[]'::jsonb, '[]'::jsonb
  ) RETURNING id INTO v_match_id;

  INSERT INTO public.games_democracy_merge_match_players(
    match_id, room_id, user_id, display_name, board
  ) VALUES
    (v_match_id, v_room_id, v_host, 'DM host', v_board),
    (v_match_id, v_room_id, v_guest, 'DM guest', v_board);

  v_room := public.multiplayer_execute_action(
    'leave_active_match', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge', 'playerUserId', v_host)
  );
  IF v_room->>'status' <> 'playing' OR v_room->>'gameId' <> 'democracy-merge' THEN
    RAISE EXCEPTION 'The first final departure must preserve the active room';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.games_democracy_merge_match_players
    WHERE match_id=v_match_id AND user_id=v_host AND status='left'
  ) THEN
    RAISE EXCEPTION 'Departing participant must be recorded as left';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id=v_room_id AND user_id=v_guest AND is_host
  ) THEN
    RAISE EXCEPTION 'The remaining member must receive host status';
  END IF;

  v_room := public.multiplayer_execute_action(
    'leave_active_match', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge', 'playerUserId', v_guest)
  );
  IF v_room->>'status' <> 'cancelled' THEN
    RAISE EXCEPTION 'The room must close when the last active participant leaves';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.games_democracy_merge_matches
    WHERE id=v_match_id AND status='completed' AND completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The game match must complete when no active participants remain';
  END IF;

  -- Server-side expiry uses the shared room lock and the last accepted heartbeat.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_expiry', 'Expiry host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_expiry', 'Expiry guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_expiry', 'Expiry host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_expiry', 'Expiry host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_expiry', 'Expiry guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_room := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge')
  );
  v_started_at := (v_room->>'startedAt')::timestamptz;
  INSERT INTO public.games_democracy_merge_matches(
    room_id, started_at, game_started_at, deadline_at, character_sequence, obstacle_sequence
  ) VALUES (
    v_room_id, v_started_at, v_started_at + interval '5 seconds',
    v_started_at + interval '30 minutes', '[]'::jsonb, '[]'::jsonb
  ) RETURNING id INTO v_match_id;
  INSERT INTO public.games_democracy_merge_match_players(
    match_id, room_id, user_id, display_name, board
  ) VALUES
    (v_match_id, v_room_id, v_host || '_expiry', 'Expiry host', v_board),
    (v_match_id, v_room_id, v_guest || '_expiry', 'Expiry guest', v_board);
  UPDATE public.common_multiplayer_players
  SET last_seen_at = now() - interval '6 minutes'
  WHERE room_id=v_room_id AND user_id=v_host || '_expiry';

  v_expired := public.democracy_merge_expire_disconnected_players();
  IF v_expired <> 1 THEN
    RAISE EXCEPTION 'Exactly one disconnected player should expire; got %', v_expired;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.games_democracy_merge_match_players
    WHERE match_id=v_match_id AND user_id=v_host || '_expiry' AND status='left'
  ) THEN
    RAISE EXCEPTION 'Expired participant must be recorded as left';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id=v_room_id AND user_id=v_guest || '_expiry'
  ) THEN
    RAISE EXCEPTION 'Other participants must remain in the active room';
  END IF;
END;
$test$;

ROLLBACK;

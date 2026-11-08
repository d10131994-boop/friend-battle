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
  v_start jsonb;
  v_characters jsonb;
  v_obstacles jsonb;
  v_snapshot jsonb;
  v_state jsonb;
  v_action_id uuid;
  v_rejected boolean;
  v_expired integer;
  v_board jsonb;
BEGIN
  INSERT INTO public.common_multiplayer_game_rules(game_id, min_players, max_players, is_enabled)
  VALUES ('democracy-merge', 2, 4, true)
  ON CONFLICT (game_id) DO UPDATE
  SET min_players=2, max_players=4, is_enabled=true;

  SELECT jsonb_agg(NULL::jsonb), jsonb_agg(1::integer), jsonb_agg(NULL::jsonb)
  INTO v_board, v_characters, v_obstacles
  FROM generate_series(1, 36);

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
  v_start := public.democracy_merge_start_match(
    v_room_id, v_host, v_characters, v_obstacles
  );
  v_started_at := (v_start->>'startedAt')::timestamptz;
  v_match_id := (v_start->>'matchId')::uuid;
  v_snapshot := public.democracy_merge_match_snapshot(v_room_id, v_host);
  IF v_snapshot->'match'->'me'->'board' IS NULL
     OR v_snapshot->'match'->'players'->0 ? 'board' THEN
    RAISE EXCEPTION 'Match snapshot must expose private board only to its owner';
  END IF;

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
  v_start := public.democracy_merge_start_match(
    v_room_id, v_host || '_expiry', v_characters, v_obstacles
  );
  v_started_at := (v_start->>'startedAt')::timestamptz;
  v_match_id := (v_start->>'matchId')::uuid;
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

  -- Player actions are atomic, revision-checked and idempotent; completion preserves the room for results.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_actions', 'Action host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_actions', 'Action guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_actions', 'Action host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_actions', 'Action host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_actions', 'Action guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_start := public.democracy_merge_start_match(
    v_room_id, v_host || '_actions', v_characters, v_obstacles
  );
  v_match_id := (v_start->>'matchId')::uuid;
  v_action_id := gen_random_uuid();
  v_state := jsonb_build_object(
    'status', 'active',
    'board', jsonb_set(v_board, '{0}', '{"kind":"character","level":1}'::jsonb, true),
    'turnNumber', 1,
    'score', 0,
    'maxLevel', 1,
    'mergeCount', 0,
    'chainReactions', 0,
    'toolsUsed', 0,
    'coins', 200,
    'inventory', '{"saw":0,"storage":0,"swap":0,"replace":0}'::jsonb,
    'storage', 'null'::jsonb,
    'level6MergeCount', 0,
    'result', 'null'::jsonb
  );
  v_snapshot := public.democracy_merge_commit_player_action(
    v_room_id, v_match_id, v_host || '_actions', v_action_id,
    'place_character', 0, v_state
  );
  IF v_snapshot->'match'->'me'->>'revision' <> '1'
     OR v_snapshot->'match'->'me'->>'turnNumber' <> '1' THEN
    RAISE EXCEPTION 'A successful placement must advance one turn and one revision';
  END IF;

  -- Retrying the exact action returns its stored response without applying it twice.
  v_snapshot := public.democracy_merge_commit_player_action(
    v_room_id, v_match_id, v_host || '_actions', v_action_id,
    'place_character', 0, v_state
  );
  IF v_snapshot->'match'->'me'->>'revision' <> '1' THEN
    RAISE EXCEPTION 'An idempotent retry must not advance the player revision twice';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.democracy_merge_commit_player_action(
      v_room_id, v_match_id, v_host || '_actions', gen_random_uuid(),
      'place_character', 0, v_state
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'A stale player revision must be rejected'; END IF;

  v_state := jsonb_build_object(
    'status', 'surrendered',
    'board', v_board,
    'turnNumber', 0,
    'score', 0,
    'maxLevel', 1,
    'mergeCount', 0,
    'chainReactions', 0,
    'toolsUsed', 0,
    'coins', 200,
    'inventory', '{"saw":0,"storage":0,"swap":0,"replace":0}'::jsonb,
    'storage', 'null'::jsonb,
    'level6MergeCount', 0,
    'result', '{"score":0,"maxLevel":1}'::jsonb
  );
  PERFORM public.democracy_merge_commit_player_action(
    v_room_id, v_match_id, v_guest || '_actions', gen_random_uuid(),
    'surrender', 0, v_state
  );
  UPDATE public.common_multiplayer_players
  SET last_seen_at = now() - interval '6 minutes'
  WHERE room_id=v_room_id AND user_id=v_guest || '_actions';
  v_room := public.multiplayer_execute_action(
    'heartbeat', v_guest || '_actions', 'Action guest', jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'expired' = 'true'
     OR NOT EXISTS (
       SELECT 1 FROM public.common_multiplayer_players
       WHERE room_id=v_room_id AND user_id=v_guest || '_actions'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.games_democracy_merge_match_players
       WHERE match_id=v_match_id AND user_id=v_guest || '_actions' AND status='surrendered'
     ) THEN
    RAISE EXCEPTION 'A surrendered player must keep their result and room membership after disconnect';
  END IF;

  v_state := jsonb_build_object(
    'status', 'completed',
    'board', jsonb_set(jsonb_set(v_board, '{0}', '{"kind":"character","level":1}'::jsonb, true), '{1}', '{"kind":"character","level":1}'::jsonb, true),
    'turnNumber', 2,
    'score', 0,
    'maxLevel', 1,
    'mergeCount', 0,
    'chainReactions', 0,
    'toolsUsed', 0,
    'coins', 200,
    'inventory', '{"saw":0,"storage":0,"swap":0,"replace":0}'::jsonb,
    'storage', 'null'::jsonb,
    'level6MergeCount', 0,
    'result', '{"score":0,"maxLevel":1}'::jsonb
  );
  v_snapshot := public.democracy_merge_commit_player_action(
    v_room_id, v_match_id, v_host || '_actions', gen_random_uuid(),
    'place_character', 1, v_state
  );
  IF v_snapshot->'match'->>'status' <> 'completed'
     OR jsonb_array_length(v_snapshot->'match'->'finalResults') <> 2 THEN
    RAISE EXCEPTION 'The match must finish when all players complete or surrender';
  END IF;
  IF v_snapshot->'room'->>'status' <> 'playing' THEN
    RAISE EXCEPTION 'Completed match must keep the shared room available for results';
  END IF;


  -- The 30-minute deadline wins over the five-minute disconnect expiry.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_deadline', 'Deadline host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_deadline', 'Deadline guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_deadline', 'Deadline host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_deadline', 'Deadline host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_deadline', 'Deadline guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_start := public.democracy_merge_start_match(
    v_room_id, v_host || '_deadline', v_characters, v_obstacles
  );
  v_match_id := (v_start->>'matchId')::uuid;
  UPDATE public.games_democracy_merge_matches
  SET started_at = now() - interval '31 minutes',
      game_started_at = now() - interval '30 minutes',
      deadline_at = now() - interval '1 second'
  WHERE id = v_match_id;
  UPDATE public.common_multiplayer_players
  SET last_seen_at = now() - interval '6 minutes'
  WHERE room_id=v_room_id AND user_id=v_host || '_deadline';

  v_expired := public.democracy_merge_expire_disconnected_players();
  IF v_expired <> 0 THEN
    RAISE EXCEPTION 'Disconnect expiry must not override the match deadline';
  END IF;
  IF public.democracy_merge_finalize_expired_matches() <> 1 THEN
    RAISE EXCEPTION 'The expired match must be finalized once';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.games_democracy_merge_match_players
    WHERE match_id=v_match_id AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'At the 30-minute deadline all non-left players must be completed';
  END IF;
  IF (SELECT status FROM public.games_democracy_merge_matches WHERE id=v_match_id) <> 'completed'
     OR (SELECT status FROM public.common_multiplayer_rooms WHERE id=v_room_id) <> 'playing' THEN
    RAISE EXCEPTION 'Deadline finalization must preserve the results room';
  END IF;

  -- A heartbeat after five minutes expires an active player before it can refresh presence.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_heartbeat', 'Heartbeat host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_heartbeat', 'Heartbeat guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_heartbeat', 'Heartbeat host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'democracy-merge')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_heartbeat', 'Heartbeat host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_heartbeat', 'Heartbeat guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_start := public.democracy_merge_start_match(
    v_room_id, v_host || '_heartbeat', v_characters, v_obstacles
  );
  v_match_id := (v_start->>'matchId')::uuid;
  UPDATE public.common_multiplayer_players
  SET last_seen_at = now() - interval '6 minutes'
  WHERE room_id=v_room_id AND user_id=v_host || '_heartbeat';
  v_room := public.multiplayer_execute_action(
    'heartbeat', v_host || '_heartbeat', 'Heartbeat host', jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'expired' <> 'true' THEN
    RAISE EXCEPTION 'A late heartbeat must report an expired return window';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id=v_room_id AND user_id=v_host || '_heartbeat'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.games_democracy_merge_match_players
    WHERE match_id=v_match_id AND user_id=v_host || '_heartbeat' AND status='left'
  ) THEN
    RAISE EXCEPTION 'A late heartbeat must atomically remove and mark the active player left';
  END IF;
  IF (SELECT status FROM public.common_multiplayer_rooms WHERE id=v_room_id) <> 'playing'
     OR NOT EXISTS (
       SELECT 1 FROM public.common_multiplayer_players
       WHERE room_id=v_room_id AND user_id=v_guest || '_heartbeat' AND is_host
     ) THEN
    RAISE EXCEPTION 'The remaining participant must continue and receive host status';
  END IF;

END;
$test$;

ROLLBACK;

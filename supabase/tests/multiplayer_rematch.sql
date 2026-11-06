-- Multiplayer rematch lifecycle integration checks.
-- Run only against a disposable/local Supabase database.
-- All synthetic data is rolled back.

BEGIN;

DO $test$
DECLARE
  v_host text := '__fb_rematch_host_' || replace(gen_random_uuid()::text, '-', '');
  v_guest text := '__fb_rematch_guest_' || replace(gen_random_uuid()::text, '-', '');
  v_room jsonb;
  v_room_id uuid;
  v_started_at text;
  v_guest_room jsonb;
  v_match_id uuid;
BEGIN
  -- Default mode opens a 60-second vote window after a completed match.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host, 'Host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest, 'Guest', jsonb_build_object('inviteCode', v_room->>'inviteCode')
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
  v_room := public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush', 'startedAt', v_started_at)
  );
  IF v_room->>'rematchStatus' <> 'open'
     OR (v_room->>'rematchDeadlineAt')::timestamptz < now()
     OR (v_room->>'rematchDeadlineAt')::timestamptz > now() + interval '61 seconds' THEN
    RAISE EXCEPTION 'Default lifecycle must open a 60-second rematch vote';
  END IF;

  v_guest_room := public.multiplayer_execute_action(
    'vote_rematch', v_guest, 'Guest',
    jsonb_build_object('roomId', v_room_id, 'vote', 'yes')
  );
  IF v_guest_room->>'rematchStatus' <> 'open' THEN
    RAISE EXCEPTION 'One yes vote must not accept the rematch';
  END IF;

  v_room := public.multiplayer_execute_action(
    'vote_rematch', v_host, 'Host',
    jsonb_build_object('roomId', v_room_id, 'vote', 'yes')
  );
  IF v_room->>'rematchStatus' <> 'accepted' THEN
    RAISE EXCEPTION 'Unanimous yes votes must accept the rematch';
  END IF;

  -- Any current member may trigger the already-approved rematch; the game
  -- module still creates and owns its new match row.
  v_guest_room := public.reaction_rush_start_match(v_room_id, v_guest);
  v_match_id := (v_guest_room->>'matchId')::uuid;
  IF v_guest_room->'room'->>'status' <> 'playing'
     OR EXISTS (
       SELECT 1 FROM public.common_multiplayer_rooms
       WHERE id = v_room_id AND rematch_status IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Accepted rematch did not start and clear its vote state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.games_reaction_rush_matches
    WHERE id = v_match_id AND status = 'playing'
  ) THEN
    RAISE EXCEPTION 'Reaction Rush did not create its next match';
  END IF;

  -- A single no vote cancels the rematch.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_no', 'Host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_no', 'Guest', jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_no', 'Host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_no', 'Host', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_no', 'Guest', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_room := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  v_started_at := v_room->>'startedAt';
  PERFORM public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush', 'startedAt', v_started_at)
  );
  v_room := public.multiplayer_execute_action(
    'vote_rematch', v_guest || '_no', 'Guest',
    jsonb_build_object('roomId', v_room_id, 'vote', 'no')
  );
  IF v_room->>'rematchStatus' <> 'declined' THEN
    RAISE EXCEPTION 'One no vote must decline the rematch';
  END IF;

  -- An unanswered vote expires lazily on the next authoritative get_room.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_expired', 'Host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_expired', 'Guest', jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_expired', 'Host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_expired', 'Host', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_expired', 'Guest', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_room := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  v_started_at := v_room->>'startedAt';
  PERFORM public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush', 'startedAt', v_started_at)
  );
  UPDATE public.common_multiplayer_rooms
  SET rematch_deadline_at = now() - interval '1 second'
  WHERE id = v_room_id;
  v_room := public.multiplayer_execute_action(
    'get_room', v_host || '_expired', 'Host', jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'rematchStatus' <> 'expired' THEN
    RAISE EXCEPTION 'Unanswered rematch vote must expire after its deadline';
  END IF;

  -- Disabled/custom modes do not get the standard Multiplayer vote window.
  UPDATE public.common_multiplayer_game_rules SET lifecycle_mode = 'disabled'
  WHERE game_id = 'reaction-rush';
  v_room := public.multiplayer_execute_action(
    'create_room', v_host || '_disabled', 'Host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest || '_disabled', 'Guest', jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host || '_disabled', 'Host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_disabled', 'Host', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_disabled', 'Guest', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_room := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  v_started_at := v_room->>'startedAt';
  v_room := public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush', 'startedAt', v_started_at)
  );
  IF v_room->>'rematchStatus' IS NOT NULL OR v_room->>'rematchDeadlineAt' IS NOT NULL THEN
    RAISE EXCEPTION 'Disabled lifecycle must not open a standard rematch vote';
  END IF;

  -- Custom mode delegates post-match behavior to the game module.
  UPDATE public.common_multiplayer_game_rules SET lifecycle_mode = 'custom'
  WHERE game_id = 'reaction-rush';
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host || '_disabled', 'Host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest || '_disabled', 'Guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_room := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush')
  );
  v_started_at := v_room->>'startedAt';
  v_room := public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'reaction-rush', 'startedAt', v_started_at)
  );
  IF v_room->>'rematchStatus' IS NOT NULL OR v_room->>'rematchDeadlineAt' IS NOT NULL THEN
    RAISE EXCEPTION 'Custom lifecycle must not open the standard Multiplayer vote';
  END IF;
END;
$test$;

ROLLBACK;

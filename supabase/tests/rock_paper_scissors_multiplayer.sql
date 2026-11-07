-- Rock Paper Scissors database integration checks.
-- Run only against a disposable/local Supabase database after applying
-- supabase/sql/rock_paper_scissors_multiplayer.sql.
-- The enclosing transaction rolls back all synthetic data.

BEGIN;

DO $test$
DECLARE
  v_host text := '__fb_rps_host_' || replace(gen_random_uuid()::text, '-', '');
  v_guest text := '__fb_rps_guest_' || replace(gen_random_uuid()::text, '-', '');
  v_third text := '__fb_rps_third_' || replace(gen_random_uuid()::text, '-', '');
  v_host_leave text := '__fb_rps_leave_host_' || replace(gen_random_uuid()::text, '-', '');
  v_guest_leave text := '__fb_rps_leave_guest_' || replace(gen_random_uuid()::text, '-', '');
  v_room jsonb;
  v_room_id uuid;
  v_match jsonb;
  v_match_id uuid;
  v_started_at text;
  v_rejected boolean := false;
  v_wins integer;
  v_matches integer;
  v_round integer;
BEGIN
  -- A selected Rock Paper Scissors room is capped at exactly two players.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host, 'Test host', jsonb_build_object('maxPlayers', 4)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest, 'Test guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  v_room := public.multiplayer_execute_action(
    'select_game', v_host, 'Test host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'rock-paper-scissors')
  );
  IF (v_room->>'maxPlayers')::integer IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Selecting Rock Paper Scissors must set room capacity to two';
  END IF;

  BEGIN
    PERFORM public.multiplayer_execute_action(
      'join_room', v_third, 'Third player',
      jsonb_build_object('inviteCode', v_room->>'inviteCode')
    );
  EXCEPTION WHEN SQLSTATE '54000' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A third player unexpectedly joined a two-player room';
  END IF;

  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host, 'Test host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest, 'Test guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );

  v_match := public.rock_paper_scissors_start_match(v_room_id, v_host, 'Test host');
  v_match_id := (v_match->'match'->>'matchId')::uuid;
  v_started_at := v_match->'match'->>'startedAt';
  IF v_match->'match'->>'phase' IS DISTINCT FROM 'choosing'
    OR v_match->'room'->>'status' IS DISTINCT FROM 'playing'
  THEN
    RAISE EXCEPTION 'New match must start in the choosing phase';
  END IF;

  -- Choices may be changed during the selection window, but the opponent's
  -- current choice must remain hidden from the requesting player.
  PERFORM public.rock_paper_scissors_submit_choice(
    v_room_id, v_match_id, 1, v_host, 'paper'
  );
  PERFORM public.rock_paper_scissors_submit_choice(
    v_room_id, v_match_id, 1, v_host, 'rock'
  );
  PERFORM public.rock_paper_scissors_submit_choice(
    v_room_id, v_match_id, 1, v_guest, 'scissors'
  );

  v_match := public.rock_paper_scissors_match_snapshot(v_room_id, v_host);
  IF v_match->'match'->'round'->'players'->1->>'choice' IS NOT NULL THEN
    RAISE EXCEPTION 'Opponent choice leaked during the choosing phase';
  END IF;

  -- A draw awards no points; three later wins end the match. Each round has
  -- a 3s choice, 4s reveal and 4s result phase. Force deadlines in this test.
  FOR v_round IN 1..4 LOOP
    IF v_round = 1 THEN
      PERFORM public.rock_paper_scissors_submit_choice(
        v_room_id, v_match_id, 1, v_guest, 'rock'
      );
    ELSE
      PERFORM public.rock_paper_scissors_submit_choice(
        v_room_id, v_match_id, v_round, v_host, 'rock'
      );
      PERFORM public.rock_paper_scissors_submit_choice(
        v_room_id, v_match_id, v_round, v_guest, 'scissors'
      );
    END IF;

    UPDATE public.games_rock_paper_scissors_matches
    SET phase_deadline = pg_catalog.clock_timestamp() - interval '1 second'
    WHERE id = v_match_id AND phase = 'choosing';
    v_match := public.rock_paper_scissors_match_snapshot(v_room_id, v_host);
    IF v_match->'match'->>'phase' IS DISTINCT FROM 'revealing' THEN
      RAISE EXCEPTION 'Expired choice phase did not reveal both choices';
    END IF;
    IF v_round = 1 THEN
      IF (v_match->'match'->'round'->>'isDraw')::boolean IS DISTINCT FROM true
        OR v_match->'match'->'players'->0->>'score' IS DISTINCT FROM '0'
      THEN
        RAISE EXCEPTION 'Equal choices must produce a draw without awarding points';
      END IF;
    ELSE
      IF v_match->'match'->'round'->>'winnerUserId' IS DISTINCT FROM v_host THEN
        RAISE EXCEPTION 'Rock must beat scissors';
      END IF;
      IF v_match->'match'->'round'->'players'->1->>'choice' IS DISTINCT FROM 'scissors' THEN
        RAISE EXCEPTION 'Both choices must be visible during reveal';
      END IF;
    END IF;

    UPDATE public.games_rock_paper_scissors_matches
    SET phase_deadline = pg_catalog.clock_timestamp() - interval '1 second'
    WHERE id = v_match_id AND phase = 'revealing';
    v_match := public.rock_paper_scissors_match_snapshot(v_room_id, v_host);
    IF v_match->'match'->>'phase' IS DISTINCT FROM 'result' THEN
      RAISE EXCEPTION 'Reveal phase did not advance to the result phase';
    END IF;

    UPDATE public.games_rock_paper_scissors_matches
    SET phase_deadline = pg_catalog.clock_timestamp() - interval '1 second'
    WHERE id = v_match_id AND phase = 'result';
    v_match := public.rock_paper_scissors_match_snapshot(v_room_id, v_host);

    IF v_round < 4 AND (
      v_match->'match'->>'status' IS DISTINCT FROM 'playing'
      OR (v_match->'match'->>'currentRound')::integer <> v_round + 1
      OR v_match->'match'->>'phase' IS DISTINCT FROM 'choosing'
    ) THEN
      RAISE EXCEPTION 'Match did not advance to the next round';
    END IF;
  END LOOP;

  IF v_match->'match'->>'status' IS DISTINCT FROM 'completed'
    OR v_match->'match'->>'winnerUserId' IS DISTINCT FROM v_host
  THEN
    RAISE EXCEPTION 'The first player should win after three winning rounds';
  END IF;

  SELECT wins, matches_played INTO v_wins, v_matches
  FROM public.common_multiplayer_room_stats
  WHERE room_id = v_room_id AND user_id = v_host;
  IF v_wins IS DISTINCT FROM 1 OR v_matches IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Winner room statistics were not updated exactly once';
  END IF;

  v_room := public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    jsonb_build_object(
      'roomId', v_room_id,
      'gameId', 'rock-paper-scissors',
      'startedAt', v_started_at
    )
  );
  IF v_room->>'status' IS DISTINCT FROM 'finished' THEN
    RAISE EXCEPTION 'Completed match did not return the shared room to finished';
  END IF;

  -- An absent choice defaults to rock at the server deadline. Leaving during
  -- the active match then exercises the game-owned cancellation hook.
  v_room := public.multiplayer_execute_action(
    'create_room', v_host_leave, 'Test host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest_leave, 'Test guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );
  PERFORM public.multiplayer_execute_action(
    'select_game', v_host_leave, 'Test host',
    jsonb_build_object('roomId', v_room_id, 'gameId', 'rock-paper-scissors')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host_leave, 'Test host',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest_leave, 'Test guest',
    jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  v_match := public.rock_paper_scissors_start_match(v_room_id, v_host_leave, 'Test host');
  v_match_id := (v_match->'match'->>'matchId')::uuid;
  PERFORM public.rock_paper_scissors_submit_choice(
    v_room_id, v_match_id, 1, v_guest_leave, 'scissors'
  );
  UPDATE public.games_rock_paper_scissors_matches
  SET phase_deadline = pg_catalog.clock_timestamp() - interval '1 second'
  WHERE id = v_match_id AND phase = 'choosing';
  v_match := public.rock_paper_scissors_match_snapshot(v_room_id, v_host_leave);
  IF v_match->'match'->'round'->'players'->0->>'choice' IS DISTINCT FROM 'rock'
    OR v_match->'match'->'round'->>'winnerUserId' IS DISTINCT FROM v_host_leave
  THEN
    RAISE EXCEPTION 'A missing choice must default to rock';
  END IF;

  v_room := public.multiplayer_execute_action(
    'leave_room', v_guest_leave, 'Test guest',
    jsonb_build_object('roomId', v_room_id)
  );
  IF v_room->>'status' IS DISTINCT FROM 'waiting' OR v_room->>'gameId' IS NOT NULL THEN
    RAISE EXCEPTION 'Leaving during play did not reset the common room';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.games_rock_paper_scissors_matches
    WHERE id = v_match_id AND status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Game-owned room-reset hook did not cancel the active match';
  END IF;
END;
$test$;

ROLLBACK;

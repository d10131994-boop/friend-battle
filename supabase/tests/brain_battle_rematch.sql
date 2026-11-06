-- Brain Battle consecutive-match statistics integration checks.
-- Run only against a disposable/local Supabase database.
-- All synthetic data is rolled back.

BEGIN;

DO $test$
DECLARE
  v_host text := '__fb_brain_host_' || replace(gen_random_uuid()::text, '-', '');
  v_guest text := '__fb_brain_guest_' || replace(gen_random_uuid()::text, '-', '');
  v_room jsonb;
  v_started jsonb;
  v_room_id uuid;
  v_match_id uuid;
  v_questions jsonb;
  v_stats record;
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
    jsonb_build_object('roomId', v_room_id, 'gameId', 'brain-battle')
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_host, 'Host', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );
  PERFORM public.multiplayer_execute_action(
    'set_ready', v_guest, 'Guest', jsonb_build_object('roomId', v_room_id, 'isReady', true)
  );

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', question_number,
      'question', 'Test question ' || question_number,
      'answers', jsonb_build_array('A', 'B', 'C', 'D'),
      'correctAnswer', 0,
      'explanation', 'Test explanation'
    ) ORDER BY question_number
  )
  INTO v_questions
  FROM generate_series(1, 10) AS series(question_number);

  -- First match: Host wins.
  v_started := public.brain_battle_start_match(v_room_id, v_host, v_questions);
  v_match_id := (v_started->>'matchId')::uuid;

  INSERT INTO public.games_brain_battle_answers(
    match_id, room_id, user_id, question_index, selected_answer,
    is_correct, response_time_ms, score
  )
  SELECT v_match_id, v_room_id, p.user_id, series.question_index, 0,
         true, 1000, CASE WHEN p.user_id = v_host THEN 150 ELSE 100 END
  FROM public.common_multiplayer_players p
  CROSS JOIN generate_series(0, 9) AS series(question_index)
  WHERE p.room_id = v_room_id;

  UPDATE public.games_brain_battle_matches
  SET current_question_index = 9
  WHERE id = v_match_id;

  v_started := public.brain_battle_advance_if_due(v_room_id, v_match_id);
  IF v_started->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'First Brain Battle match did not complete';
  END IF;

  SELECT wins, matches_played INTO v_stats
  FROM public.common_multiplayer_room_stats
  WHERE room_id = v_room_id AND user_id = v_host;
  IF v_stats.wins <> 1 OR v_stats.matches_played <> 1 THEN
    RAISE EXCEPTION 'First match statistics were not recorded for the host';
  END IF;

  -- Both remaining members approve the rematch for the exact finished session.
  PERFORM public.multiplayer_execute_action(
    'vote_rematch', v_host, 'Host',
    jsonb_build_object('roomId', v_room_id, 'vote', 'yes')
  );
  v_room := public.multiplayer_execute_action(
    'vote_rematch', v_guest, 'Guest',
    jsonb_build_object('roomId', v_room_id, 'vote', 'yes')
  );
  IF v_room->>'rematchStatus' <> 'accepted' THEN
    RAISE EXCEPTION 'Brain Battle rematch was not unanimously accepted';
  END IF;

  -- Second match: Guest wins. The room statistics must accumulate, not reset.
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', question_number + 100,
      'question', 'Second match question ' || question_number,
      'answers', jsonb_build_array('A', 'B', 'C', 'D'),
      'correctAnswer', 0,
      'explanation', 'Second test explanation'
    ) ORDER BY question_number
  )
  INTO v_questions
  FROM generate_series(1, 10) AS series(question_number);

  v_started := public.brain_battle_start_match(v_room_id, v_host, v_questions);
  v_match_id := (v_started->>'matchId')::uuid;

  INSERT INTO public.games_brain_battle_answers(
    match_id, room_id, user_id, question_index, selected_answer,
    is_correct, response_time_ms, score
  )
  SELECT v_match_id, v_room_id, p.user_id, series.question_index, 0,
         true, 1000, CASE WHEN p.user_id = v_guest THEN 150 ELSE 100 END
  FROM public.common_multiplayer_players p
  CROSS JOIN generate_series(0, 9) AS series(question_index)
  WHERE p.room_id = v_room_id;

  UPDATE public.games_brain_battle_matches
  SET current_question_index = 9
  WHERE id = v_match_id;

  v_started := public.brain_battle_advance_if_due(v_room_id, v_match_id);
  IF v_started->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'Second Brain Battle match did not complete';
  END IF;

  SELECT wins, matches_played INTO v_stats
  FROM public.common_multiplayer_room_stats
  WHERE room_id = v_room_id AND user_id = v_host;
  IF v_stats.wins <> 1 OR v_stats.matches_played <> 2 THEN
    RAISE EXCEPTION 'Host statistics did not accumulate correctly across two matches';
  END IF;

  SELECT wins, matches_played INTO v_stats
  FROM public.common_multiplayer_room_stats
  WHERE room_id = v_room_id AND user_id = v_guest;
  IF v_stats.wins <> 1 OR v_stats.matches_played <> 2 THEN
    RAISE EXCEPTION 'Guest statistics did not accumulate correctly across two matches';
  END IF;

  -- Replaying completion for an already completed match must not add statistics.
  PERFORM public.brain_battle_advance_if_due(v_room_id, v_match_id);
  SELECT wins, matches_played INTO v_stats
  FROM public.common_multiplayer_room_stats
  WHERE room_id = v_room_id AND user_id = v_guest;
  IF v_stats.wins <> 1 OR v_stats.matches_played <> 2 THEN
    RAISE EXCEPTION 'Repeated completion must not duplicate room statistics';
  END IF;
END;
$test$;

ROLLBACK;

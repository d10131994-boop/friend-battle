-- NoCountIt early exit for all participants and the shared six-second reveal interval.
-- Apply this patch together with the matching NoCountIt Edge Function deployment.

CREATE OR REPLACE FUNCTION public.no_count_it_prepare_next_round(
  p_room_id uuid,
  p_match_id uuid,
  p_scene jsonb,
  p_image_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_no_count_it_matches%ROWTYPE;
  v_round public.games_no_count_it_rounds%ROWTYPE;
  v_next smallint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_results jsonb;
  v_winner text;
  v_best bigint;
  v_best_count integer;
BEGIN
  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_match FROM public.games_no_count_it_matches
  WHERE id = p_match_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_match.status <> 'playing' OR v_room.status <> 'playing'
     OR v_room.started_at IS DISTINCT FROM v_match.started_at THEN
    RAISE EXCEPTION 'Match is no longer active' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_round FROM public.games_no_count_it_rounds
  WHERE match_id = p_match_id AND round_number = v_match.current_round FOR UPDATE;
  IF NOT FOUND OR v_round.status <> 'revealing'
     OR v_round.reveal_started_at > v_now - interval '6 seconds' THEN
    RAISE EXCEPTION 'Round reveal is still active' USING ERRCODE = '55000';
  END IF;

  IF v_match.current_round = 3 THEN
    SELECT
      COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('userId', user_id, 'displayName', display_name, 'totalError', total_error)
        ORDER BY total_error, joined_at, user_id
      ), '[]'::jsonb),
      min(total_error),
      count(*) FILTER (WHERE total_error = (
        SELECT min(total_error) FROM public.games_no_count_it_match_players WHERE match_id = p_match_id
      ))
    INTO v_results, v_best, v_best_count
    FROM public.games_no_count_it_match_players
    WHERE match_id = p_match_id AND status = 'active';

    IF v_best_count = 1 THEN
      SELECT user_id INTO v_winner FROM public.games_no_count_it_match_players
      WHERE match_id = p_match_id AND status = 'active' AND total_error = v_best;
    END IF;

    UPDATE public.games_no_count_it_matches
    SET status = 'completed', completed_at = v_now, final_results = v_results, winner_user_id = v_winner
    WHERE id = p_match_id;

    -- Preserve scene assets for 24 hours after normal match completion.
    UPDATE public.games_no_count_it_rounds
    SET delete_after = v_now + interval '24 hours'
    WHERE match_id = p_match_id;

    INSERT INTO public.common_multiplayer_room_stats(room_id, user_id, wins, matches_played, updated_at)
    SELECT p_room_id, mp.user_id, CASE WHEN mp.user_id = v_winner THEN 1 ELSE 0 END, 1, v_now
    FROM public.games_no_count_it_match_players mp
    WHERE mp.match_id = p_match_id AND mp.status = 'active'
    ON CONFLICT (room_id, user_id) DO UPDATE SET
      wins = public.common_multiplayer_room_stats.wins + EXCLUDED.wins,
      matches_played = public.common_multiplayer_room_stats.matches_played + 1,
      updated_at = EXCLUDED.updated_at;

    RETURN pg_catalog.jsonb_build_object(
      'status', 'completed', 'startedAt', v_match.started_at,
      'winnerUserId', v_winner, 'finalResults', v_results
    );
  END IF;

  v_next := v_match.current_round + 1;
  IF pg_catalog.jsonb_typeof(p_scene) IS DISTINCT FROM 'object'
     OR p_scene->>'generator' IS DISTINCT FROM 'candy-jar'
     OR pg_catalog.jsonb_typeof(p_scene->'objects') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_scene->'objects') NOT BETWEEN 40 AND 120
     OR p_image_path IS NULL
     OR p_image_path !~ '^[0-9a-f-]+/round-[1-3]/[a-zA-Z0-9_-]+\.svg$' THEN
    RAISE EXCEPTION 'Invalid next-round scene' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.games_no_count_it_rounds(
    match_id, room_id, round_number, status, scene, correct_count, target_color, image_path, preparation_deadline
  )
  VALUES (
    p_match_id, p_room_id, v_next, 'preparing', p_scene,
    (p_scene->>'correctCount')::integer, p_scene->>'targetColor',
    p_image_path, v_now + interval '30 seconds'
  )
  ON CONFLICT (match_id, round_number) DO NOTHING;

  INSERT INTO public.games_no_count_it_round_players(match_id, round_number, user_id, status)
  SELECT p_match_id, v_next, mp.user_id, 'preparing'
  FROM public.games_no_count_it_match_players mp
  WHERE mp.match_id = p_match_id AND mp.status = 'active'
  ON CONFLICT (match_id, round_number, user_id) DO NOTHING;

  UPDATE public.games_no_count_it_matches SET current_round = v_next WHERE id = p_match_id;
  RETURN pg_catalog.jsonb_build_object('status', 'prepared', 'roundNumber', v_next);
END;
$function$;

REVOKE ALL ON FUNCTION public.no_count_it_prepare_next_round(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.no_count_it_prepare_next_round(uuid, uuid, jsonb, text)
  TO service_role;


CREATE OR REPLACE FUNCTION public.no_count_it_exit_early(
  p_room_id uuid,
  p_match_id uuid,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_no_count_it_matches%ROWTYPE;
  v_round public.games_no_count_it_rounds%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_results jsonb;
  v_finished_room jsonb;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'Authenticated player is required' USING ERRCODE = '22023';
  END IF;

  -- Lock order is shared room first, then game match.
  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id IS DISTINCT FROM 'no-count-it' THEN
    RAISE EXCEPTION 'NoCountIt is not selected' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match FROM public.games_no_count_it_matches
  WHERE id = p_match_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.started_at IS DISTINCT FROM v_match.started_at THEN
    RAISE EXCEPTION 'Match is no longer active' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501';
  END IF;

  -- Concurrent requests for this same exit are safe to retry.
  IF v_match.status = 'cancelled' AND v_room.status = 'finished' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'room', public.multiplayer_room_snapshot(p_room_id)
    );
  END IF;

  IF v_room.status <> 'playing' OR v_match.status <> 'playing' THEN
    RAISE EXCEPTION 'Match is no longer active' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_round
  FROM public.games_no_count_it_rounds
  WHERE match_id = p_match_id AND round_number = v_match.current_round
  FOR UPDATE;
  IF NOT FOUND OR v_round.status <> 'revealing' THEN
    RAISE EXCEPTION 'Early exit is available only after a round' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('userId', user_id, 'displayName', display_name, 'totalError', total_error)
    ORDER BY total_error, joined_at, user_id
  ), '[]'::jsonb)
  INTO v_results
  FROM public.games_no_count_it_match_players
  WHERE match_id = p_match_id;

  UPDATE public.games_no_count_it_matches
  SET status = 'cancelled', completed_at = v_now,
      final_results = v_results, winner_user_id = NULL
  WHERE id = p_match_id;

  -- Early-exited matches also receive the normal 24-hour scene retention window.
  UPDATE public.games_no_count_it_rounds
  SET delete_after = v_now + interval '24 hours'
  WHERE match_id = p_match_id;

  -- This trusted transition finishes the shared room without removing members.
  v_finished_room := public.multiplayer_execute_action(
    'finish_game', '__game_server__', 'Game server',
    pg_catalog.jsonb_build_object(
      'roomId', p_room_id, 'gameId', 'no-count-it', 'startedAt', v_match.started_at
    )
  );

  RETURN pg_catalog.jsonb_build_object('status', 'cancelled', 'room', v_finished_room);
END;
$function$;

REVOKE ALL ON FUNCTION public.no_count_it_exit_early(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.no_count_it_exit_early(uuid, uuid, text)
  TO service_role;

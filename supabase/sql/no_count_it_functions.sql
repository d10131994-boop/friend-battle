-- NoCountIt trusted multiplayer RPCs.
-- Every mutating operation locks the shared room before the game match.

CREATE OR REPLACE FUNCTION public.no_count_it_start_match(
  p_room_id uuid,
  p_user_id text,
  p_display_name text,
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
  v_started jsonb;
  v_started_at timestamptz;
  v_match_id uuid;
  v_round_id uuid;
  v_round_players jsonb;
BEGIN
  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id IS DISTINCT FROM 'no-count-it' THEN
    RAISE EXCEPTION 'NoCountIt is not selected' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id AND is_host
  ) THEN RAISE EXCEPTION 'Only the room host can start a match' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_scene) IS DISTINCT FROM 'object'
     OR p_scene->>'generator' IS DISTINCT FROM 'candy-jar'
     OR jsonb_typeof(p_scene->'objects') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_scene->'objects') NOT BETWEEN 40 AND 120
     OR (p_scene->>'correctCount')::integer NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Invalid scene payload' USING ERRCODE = '22023';
  END IF;
  IF p_image_path IS NULL OR p_image_path !~ '^[0-9a-f-]+/round-[1-3]/[a-zA-Z0-9_-]+\.svg$' THEN
    RAISE EXCEPTION 'Invalid scene image path' USING ERRCODE = '22023';
  END IF;

  v_started := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    pg_catalog.jsonb_build_object('roomId', p_room_id, 'gameId', 'no-count-it')
  );
  v_started_at := (v_started->>'startedAt')::timestamptz;

  INSERT INTO public.games_no_count_it_matches(room_id, started_at, status, current_round)
  VALUES (p_room_id, v_started_at, 'preparing', 1)
  RETURNING id INTO v_match_id;

  INSERT INTO public.games_no_count_it_match_players(match_id, room_id, user_id, display_name)
  SELECT v_match_id, p_room_id, p.user_id, p.display_name
  FROM public.common_multiplayer_players p
  WHERE p.room_id = p_room_id;

  INSERT INTO public.games_no_count_it_rounds(
    match_id, room_id, round_number, status, scene, correct_count,
    target_color, image_path, preparation_deadline
  )
  VALUES (
    v_match_id, p_room_id, 1, 'preparing', p_scene,
    (p_scene->>'correctCount')::integer, p_scene->>'targetColor',
    p_image_path, pg_catalog.clock_timestamp() + interval '30 seconds'
  )
  RETURNING id INTO v_round_id;

  INSERT INTO public.games_no_count_it_round_players(match_id, round_number, user_id, status)
  SELECT v_match_id, 1, p.user_id, 'preparing'
  FROM public.common_multiplayer_players p
  WHERE p.room_id = p_room_id;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('userId', user_id, 'displayName', display_name, 'status', status,
      'answer', NULL, 'error', NULL, 'answeredAt', NULL)
    ORDER BY joined_at, user_id
  ) INTO v_round_players
  FROM public.games_no_count_it_match_players
  WHERE match_id = v_match_id;

  RETURN pg_catalog.jsonb_build_object('matchId', v_match_id, 'startedAt', v_started_at, 'room', v_started,
    'round', pg_catalog.jsonb_build_object('roundNumber', 1, 'status', 'preparing',
      'preparationDeadline', pg_catalog.clock_timestamp() + interval '30 seconds',
      'players', COALESCE(v_round_players, '[]'::jsonb)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.no_count_it_round_ready(
  p_room_id uuid, p_match_id uuid, p_user_id text
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
  v_player_count integer;
  v_ready_count integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_match FROM public.games_no_count_it_matches
  WHERE id = p_match_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_match.status NOT IN ('preparing', 'playing')
     OR v_room.status <> 'playing' OR v_room.started_at IS DISTINCT FROM v_match.started_at THEN
    RAISE EXCEPTION 'Match is no longer active' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_round FROM public.games_no_count_it_rounds
  WHERE match_id = p_match_id AND round_number = v_match.current_round FOR UPDATE;
  IF NOT FOUND OR v_round.status <> 'preparing' THEN
    RAISE EXCEPTION 'Round is not preparing' USING ERRCODE = '55000';
  END IF;
  UPDATE public.games_no_count_it_round_players
  SET status = 'ready'
  WHERE match_id = p_match_id AND round_number = v_match.current_round
    AND user_id = p_user_id AND status = 'preparing';
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.games_no_count_it_round_players
    WHERE match_id = p_match_id AND round_number = v_match.current_round
      AND user_id = p_user_id AND status IN ('ready', 'active')
  ) THEN RAISE EXCEPTION 'Player is not eligible for this round' USING ERRCODE = '42501'; END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'ready')
  INTO v_player_count, v_ready_count
  FROM public.games_no_count_it_round_players
  WHERE match_id = p_match_id AND round_number = v_match.current_round
    AND status IN ('preparing', 'ready');

  IF v_ready_count = v_player_count OR v_now >= v_round.preparation_deadline THEN
    UPDATE public.games_no_count_it_round_players
    SET status = CASE WHEN status = 'ready' THEN 'active' ELSE 'excluded_not_ready' END
    WHERE match_id = p_match_id AND round_number = v_match.current_round
      AND status IN ('preparing', 'ready');

    IF v_ready_count = 0 THEN
      UPDATE public.games_no_count_it_rounds SET status = 'technical_aborted', completed_at = v_now
      WHERE id = v_round.id;
      UPDATE public.games_no_count_it_matches SET status = 'technical_aborted', completed_at = v_now
      WHERE id = p_match_id;
      RETURN pg_catalog.jsonb_build_object('status', 'technical_aborted', 'startedAt', v_match.started_at);
    END IF;

    UPDATE public.games_no_count_it_rounds
    SET status = 'showing', show_started_at = v_now, answer_deadline = v_now + interval '15 seconds'
    WHERE id = v_round.id;
    UPDATE public.games_no_count_it_matches SET status = 'playing' WHERE id = p_match_id;
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'updated');
END;
$function$;

CREATE OR REPLACE FUNCTION public.no_count_it_submit_answer(
  p_room_id uuid, p_match_id uuid, p_round_number integer, p_user_id text, p_answer bigint
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
  v_player public.games_no_count_it_round_players%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_error bigint;
  v_answered integer;
  v_active integer;
BEGIN
  IF p_answer IS NULL OR p_answer < 0 THEN
    RAISE EXCEPTION 'Answer must be a non-negative integer' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_match FROM public.games_no_count_it_matches
  WHERE id = p_match_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_match.status <> 'playing' OR v_room.status <> 'playing'
     OR v_room.started_at IS DISTINCT FROM v_match.started_at
     OR v_match.current_round <> p_round_number THEN
    RAISE EXCEPTION 'Match or round is no longer active' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_round FROM public.games_no_count_it_rounds
  WHERE match_id = p_match_id AND round_number = p_round_number FOR UPDATE;
  IF NOT FOUND OR v_round.status NOT IN ('showing', 'answering') THEN
    RAISE EXCEPTION 'Round is not accepting answers' USING ERRCODE = '55000';
  END IF;
  IF v_now < v_round.show_started_at + interval '5 seconds' THEN
    RAISE EXCEPTION 'Answer window has not started' USING ERRCODE = '55000';
  END IF;
  IF v_now > v_round.answer_deadline THEN
    RAISE EXCEPTION 'Answer deadline has passed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.games_no_count_it_rounds SET status = 'answering'
  WHERE id = v_round.id AND status = 'showing';

  SELECT * INTO v_player FROM public.games_no_count_it_round_players
  WHERE match_id = p_match_id AND round_number = p_round_number AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_player.status <> 'active' THEN
    RAISE EXCEPTION 'Player is not active in this round' USING ERRCODE = '42501';
  END IF;
  IF v_player.answer IS NOT NULL THEN
    RAISE EXCEPTION 'Answer has already been submitted' USING ERRCODE = '23505';
  END IF;
  v_error := pg_catalog.abs(p_answer - v_round.correct_count);
  UPDATE public.games_no_count_it_round_players
  SET answer = p_answer, error = v_error, answered_at = v_now, status = 'completed'
  WHERE id = v_player.id;

  SELECT count(*) FILTER (WHERE status = 'completed'), count(*) FILTER (WHERE status IN ('active', 'completed'))
  INTO v_answered, v_active
  FROM public.games_no_count_it_round_players
  WHERE match_id = p_match_id AND round_number = p_round_number;
  RETURN pg_catalog.jsonb_build_object('accepted', true, 'error', v_error, 'allAnswered', v_answered = v_active);
END;
$function$;

CREATE OR REPLACE FUNCTION public.no_count_it_match_snapshot(p_room_id uuid, p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room jsonb;
  v_match public.games_no_count_it_matches%ROWTYPE;
  v_round public.games_no_count_it_rounds%ROWTYPE;
  v_players jsonb;
  v_round_players jsonb;
  v_all_answered boolean;
  v_active_count integer;
  v_answered_count integer;
  v_average bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.common_multiplayer_players WHERE room_id = p_room_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501';
  END IF;
  SELECT public.multiplayer_room_snapshot(p_room_id) INTO v_room;
  SELECT * INTO v_match FROM public.games_no_count_it_matches
  WHERE room_id = p_room_id AND status IN ('preparing', 'playing', 'completed', 'technical_aborted')
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('room', v_room, 'match', NULL); END IF;

  SELECT * INTO v_round FROM public.games_no_count_it_rounds
  WHERE match_id = v_match.id AND round_number = v_match.current_round;

  IF FOUND AND v_round.status = 'showing' AND v_now >= v_round.show_started_at + interval '5 seconds' THEN
    UPDATE public.games_no_count_it_rounds SET status = 'answering' WHERE id = v_round.id;
    v_round.status := 'answering';
  END IF;

  IF FOUND AND v_round.status IN ('showing', 'answering') THEN
    SELECT count(*) FILTER (WHERE status = 'active' OR status = 'completed'),
           count(*) FILTER (WHERE status = 'completed')
    INTO v_active_count, v_answered_count
    FROM public.games_no_count_it_round_players
    WHERE match_id = v_match.id AND round_number = v_match.current_round;
    v_all_answered := v_active_count > 0 AND v_answered_count = v_active_count;
    IF v_all_answered OR v_now >= v_round.answer_deadline THEN
      UPDATE public.games_no_count_it_round_players
      SET error = v_round.correct_count, status = 'completed'
      WHERE match_id = v_match.id AND round_number = v_match.current_round
        AND status = 'active';
      SELECT COALESCE(ceil(avg(error) FILTER (WHERE status = 'completed')), 0)::bigint
      INTO v_average
      FROM public.games_no_count_it_round_players
      WHERE match_id = v_match.id AND round_number = v_match.current_round
        AND status = 'completed';
      UPDATE public.games_no_count_it_round_players
      SET error = v_average, status = 'completed'
      WHERE match_id = v_match.id AND round_number = v_match.current_round
        AND status = 'excluded_not_ready';
      UPDATE public.games_no_count_it_match_players mp
      SET total_error = total_error + rp.error
      FROM public.games_no_count_it_round_players rp
      WHERE rp.match_id = v_match.id AND rp.round_number = v_match.current_round
        AND rp.user_id = mp.user_id AND mp.match_id = v_match.id;
      UPDATE public.games_no_count_it_rounds SET status = 'revealing', reveal_started_at = v_now
      WHERE id = v_round.id AND status IN ('showing', 'answering');
      v_round.status := 'revealing';
      v_match.status := 'playing';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'userId', mp.user_id, 'displayName', mp.display_name, 'totalError', mp.total_error,
    'roundErrors', (SELECT jsonb_agg(rp.error ORDER BY rp.round_number)
      FROM public.games_no_count_it_round_players rp WHERE rp.match_id = mp.match_id AND rp.user_id = mp.user_id)
  ) ORDER BY mp.joined_at, mp.user_id), '[]'::jsonb)
  INTO v_players FROM public.games_no_count_it_match_players mp WHERE mp.match_id = v_match.id;

  IF v_round.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'userId', mp.user_id, 'displayName', mp.display_name, 'status', rp.status,
      'answer', CASE WHEN v_round.status IN ('revealing', 'completed') THEN rp.answer ELSE NULL END,
      'error', CASE WHEN v_round.status IN ('revealing', 'completed') THEN rp.error ELSE NULL END,
      'answeredAt', CASE WHEN v_round.status IN ('revealing', 'completed') THEN rp.answered_at ELSE NULL END
    ) ORDER BY mp.joined_at, mp.user_id), '[]'::jsonb)
    INTO v_round_players
    FROM public.games_no_count_it_round_players rp
    JOIN public.games_no_count_it_match_players mp
      ON mp.match_id = rp.match_id AND mp.user_id = rp.user_id
    WHERE rp.match_id = v_match.id AND rp.round_number = v_match.current_round;
  END IF;

  RETURN pg_catalog.jsonb_build_object('room', v_room, 'match', jsonb_build_object(
    'matchId', v_match.id, 'startedAt', v_match.started_at, 'status', v_match.status,
    'currentRound', v_match.current_round, 'players', v_players,
    'winnerUserId', v_match.winner_user_id, 'finalResults', v_match.final_results,
    'round', CASE WHEN v_round.id IS NULL THEN NULL ELSE jsonb_build_object(
      'roundNumber', v_round.round_number, 'status', v_round.status,
      'targetColor', v_round.target_color,
      'preparationDeadline', v_round.preparation_deadline,
      'showStartedAt', v_round.show_started_at,
      'answerDeadline', v_round.answer_deadline,
      'correctCount', CASE WHEN v_round.status IN ('revealing', 'completed') THEN v_round.correct_count ELSE NULL END,
      'imagePath', v_round.image_path,
      'players', COALESCE(v_round_players, '[]'::jsonb)
    ) END
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.no_count_it_start_match(uuid,text,text,jsonb,text),
  public.no_count_it_round_ready(uuid,uuid,text),
  public.no_count_it_submit_answer(uuid,uuid,integer,text,bigint),
  public.no_count_it_match_snapshot(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.no_count_it_start_match(uuid,text,text,jsonb,text),
  public.no_count_it_round_ready(uuid,uuid,text),
  public.no_count_it_submit_answer(uuid,uuid,integer,text,bigint),
  public.no_count_it_match_snapshot(uuid,text)
  TO service_role;

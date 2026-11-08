-- Democracy Merge V2: five-minute matches and inclusive final rankings.
-- Review and test before applying to Production.
ALTER TABLE public.games_democracy_merge_player_history
  DROP CONSTRAINT IF EXISTS games_democracy_merge_player_history_status_check;
ALTER TABLE public.games_democracy_merge_player_history
  ADD CONSTRAINT games_democracy_merge_player_history_status_check
  CHECK (status IN ('completed', 'surrendered', 'left'));

CREATE OR REPLACE FUNCTION public.democracy_merge_start_match(
  p_room_id uuid,
  p_user_id text,
  p_character_sequence jsonb,
  p_obstacle_sequence jsonb
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
  v_sequence_length integer;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'Authenticated player is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id IS DISTINCT FROM 'democracy-merge' THEN
    RAISE EXCEPTION 'Democracy Merge is not selected' USING ERRCODE = '42501';
  END IF;
  IF v_room.status NOT IN ('waiting', 'finished') THEN
    RAISE EXCEPTION 'Room cannot start a Democracy Merge match now' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id AND is_host
  ) THEN
    RAISE EXCEPTION 'Only the room host can start the match' USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.jsonb_typeof(p_character_sequence) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(p_obstacle_sequence) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Server sequences must be JSON arrays' USING ERRCODE = '22023';
  END IF;
  v_sequence_length := pg_catalog.jsonb_array_length(p_character_sequence);
  IF v_sequence_length < 36 OR v_sequence_length > 10000
     OR pg_catalog.jsonb_array_length(p_obstacle_sequence) <> v_sequence_length THEN
    RAISE EXCEPTION 'Server sequence length is invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_character_sequence) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'number'
       OR (item.value #>> '{}') !~ '^[1-6]$'
  ) THEN
    RAISE EXCEPTION 'Character sequence contains an invalid level' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_obstacle_sequence) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'null'
      AND (
        pg_catalog.jsonb_typeof(item.value) <> 'string'
        OR item.value #>> '{}' NOT IN ('barricade', 'police', 'rock')
      )
  ) THEN
    RAISE EXCEPTION 'Obstacle sequence contains an invalid event' USING ERRCODE = '22023';
  END IF;

  v_started := public.multiplayer_execute_action(
    'start_game',
    '__game_server__',
    'Game server',
    pg_catalog.jsonb_build_object('roomId', p_room_id, 'gameId', 'democracy-merge')
  );
  v_started_at := (v_started->>'startedAt')::timestamptz;

  INSERT INTO public.games_democracy_merge_matches(
    room_id, started_at, game_started_at, deadline_at,
    character_sequence, obstacle_sequence
  )
  VALUES (
    p_room_id,
    v_started_at,
    v_started_at + interval '5 seconds',
    v_started_at + interval '5 minutes 5 seconds',
    p_character_sequence,
    p_obstacle_sequence
  )
  RETURNING id INTO v_match_id;

  INSERT INTO public.games_democracy_merge_match_players(
    match_id, room_id, user_id, display_name, board
  )
  SELECT
    v_match_id,
    p.room_id,
    p.user_id,
    p.display_name,
    (
      SELECT pg_catalog.jsonb_agg(NULL::jsonb ORDER BY cell_number)
      FROM pg_catalog.generate_series(1, 36) AS cells(cell_number)
    )
  FROM public.common_multiplayer_players p
  WHERE p.room_id = p_room_id
  ORDER BY p.joined_at, p.id;

  RETURN pg_catalog.jsonb_build_object(
    'matchId', v_match_id,
    'startedAt', v_started_at,
    'gameStartedAt', v_started_at + interval '5 seconds',
    'deadlineAt', v_started_at + interval '5 minutes 5 seconds',
    'room', public.multiplayer_room_snapshot(p_room_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.democracy_merge_build_final_results(p_match_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH ranked AS (
    SELECT p.user_id, p.display_name, p.status, p.score, p.max_level,
           p.merge_count, p.chain_reactions, p.tools_used, p.coins,
           rank() OVER (ORDER BY p.score DESC, p.max_level DESC) AS place,
           p.joined_at
    FROM public.games_democracy_merge_match_players p
    WHERE p.match_id = p_match_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'userId', user_id,
        'displayName', display_name,
        'status', status,
        'score', score,
        'maxLevel', max_level,
        'mergeCount', merge_count,
        'chainReactions', chain_reactions,
        'toolsUsed', tools_used,
        'coins', coins,
        'rank', place
      )
      ORDER BY place NULLS LAST, joined_at, user_id
    ),
    '[]'::jsonb
  )
  FROM ranked;
$function$;

CREATE OR REPLACE FUNCTION public.democracy_merge_record_completed_match(p_match_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH participants AS (
    SELECT p.*,
      pg_catalog.rank() OVER (ORDER BY p.score DESC, p.max_level DESC) AS player_rank
    FROM public.games_democracy_merge_match_players p
    WHERE p.match_id = p_match_id

  ),
  firsts AS (
    SELECT count(*)::integer AS first_place_count
    FROM participants
    WHERE player_rank = 1
  ),
  inserted AS (
    INSERT INTO public.games_democracy_merge_player_history(
      match_id, user_id, completed_at, player_count, opponents, status,
      score, max_level, merge_count, chain_reactions, tools_used, coins, player_rank
    )
    SELECT
      p.match_id,
      p.user_id,
      COALESCE(m.completed_at, pg_catalog.clock_timestamp()),
      (SELECT count(*)::integer FROM public.games_democracy_merge_match_players allp WHERE allp.match_id = p.match_id),
      COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('displayName', other.display_name, 'status', other.status)
          ORDER BY other.joined_at, other.user_id
        )
        FROM public.games_democracy_merge_match_players other
        WHERE other.match_id = p.match_id AND other.user_id <> p.user_id
      ), '[]'::jsonb),
      p.status, p.score, p.max_level, p.merge_count, p.chain_reactions, p.tools_used, p.coins,
      p.player_rank::integer
    FROM participants p
    JOIN public.games_democracy_merge_matches m ON m.id = p.match_id
    ON CONFLICT (match_id, user_id) DO NOTHING
    RETURNING user_id, score, max_level, player_rank
  ),
  deltas AS (
    SELECT
      i.user_id,
      count(*)::integer AS games,
      count(*) FILTER (WHERE i.player_rank = 1 AND f.first_place_count = 1)::integer AS wins,
      count(*) FILTER (WHERE i.player_rank > 1)::integer AS losses,
      count(*) FILTER (WHERE i.player_rank = 1 AND f.first_place_count > 1)::integer AS draws,
      sum(i.score)::bigint AS points,
      max(i.score)::bigint AS best_score,
      max(i.max_level)::smallint AS max_level
    FROM inserted i
    CROSS JOIN firsts f
    GROUP BY i.user_id
  )
  INSERT INTO public.games_democracy_merge_player_stats(
    user_id, total_games, wins, losses, draws, total_points, best_score, max_level, updated_at
  )
  SELECT user_id, games, wins, losses, draws, points, best_score, max_level, pg_catalog.clock_timestamp()
  FROM deltas
  ON CONFLICT (user_id) DO UPDATE SET
    total_games = public.games_democracy_merge_player_stats.total_games + EXCLUDED.total_games,
    wins = public.games_democracy_merge_player_stats.wins + EXCLUDED.wins,
    losses = public.games_democracy_merge_player_stats.losses + EXCLUDED.losses,
    draws = public.games_democracy_merge_player_stats.draws + EXCLUDED.draws,
    total_points = public.games_democracy_merge_player_stats.total_points + EXCLUDED.total_points,
    best_score = GREATEST(public.games_democracy_merge_player_stats.best_score, EXCLUDED.best_score),
    max_level = GREATEST(public.games_democracy_merge_player_stats.max_level, EXCLUDED.max_level),
    updated_at = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  DELETE FROM public.games_democracy_merge_player_history h
  WHERE h.user_id IN (
    SELECT p.user_id FROM public.games_democracy_merge_match_players p WHERE p.match_id = p_match_id
  )
  AND h.id IN (
    SELECT id FROM (
      SELECT id, pg_catalog.row_number() OVER (
        PARTITION BY user_id ORDER BY completed_at DESC, id DESC
      ) AS position
      FROM public.games_democracy_merge_player_history
      WHERE user_id IN (
        SELECT p.user_id FROM public.games_democracy_merge_match_players p WHERE p.match_id = p_match_id
      )
    ) recent
    WHERE recent.position > 50
  );

  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.democracy_merge_handle_player_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_match public.games_democracy_merge_matches%ROWTYPE;
  v_active_count integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_results jsonb;
BEGIN
  SELECT m.* INTO v_match
  FROM public.games_democracy_merge_matches m
  JOIN public.common_multiplayer_rooms r ON r.id = m.room_id
  WHERE m.room_id = OLD.room_id
    AND m.status = 'playing'
    AND r.status = 'playing'
    AND r.game_id = 'democracy-merge'
  ORDER BY m.started_at DESC
  LIMIT 1
  FOR UPDATE OF m;

  IF NOT FOUND THEN RETURN OLD; END IF;

  DELETE FROM public.games_democracy_merge_pending_actions
  WHERE match_id = v_match.id AND user_id = OLD.user_id;

  UPDATE public.games_democracy_merge_match_players
  SET status = 'left',
      result = NULL,
      updated_at = v_now
  WHERE match_id = v_match.id
    AND user_id = OLD.user_id
    AND status = 'active';

  SELECT count(*) INTO v_active_count
  FROM public.games_democracy_merge_match_players
  WHERE match_id = v_match.id AND status = 'active';

  IF v_active_count <= 1 THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'userId', ranked.user_id,
          'displayName', ranked.display_name,
          'status', ranked.status,
          'score', ranked.score,
          'maxLevel', ranked.max_level,
          'rank', ranked.place
        )
        ORDER BY ranked.place NULLS LAST, ranked.joined_at, ranked.user_id
      ),
      '[]'::jsonb
    )
    INTO v_results
    FROM (
      SELECT p.user_id, p.display_name, p.status, p.score, p.max_level,
             rank() OVER (ORDER BY p.score DESC, p.max_level DESC) AS place,
             p.joined_at
      FROM public.games_democracy_merge_match_players p
      WHERE p.match_id = v_match.id
        AND p.status IN ('completed', 'surrendered')
      UNION ALL
      SELECT p.user_id, p.display_name, p.status, p.score, p.max_level,
             NULL::bigint AS place, p.joined_at
      FROM public.games_democracy_merge_match_players p
      WHERE p.match_id = v_match.id AND p.status = 'left'
    ) ranked;

    UPDATE public.games_democracy_merge_matches
    SET status = 'completed', completed_at = v_now, final_results = v_results
    WHERE id = v_match.id AND status = 'playing';
    PERFORM public.democracy_merge_record_completed_match(v_match.id);
    DELETE FROM public.games_democracy_merge_pending_actions WHERE match_id = v_match.id;

    -- A match with no active participants is over. Preserve completed results,
    -- but close the shared room so no new participant can enter this session.
    UPDATE public.common_multiplayer_rooms
    SET status = 'cancelled', finished_at = COALESCE(finished_at, v_now)
    WHERE id = OLD.room_id AND status = 'playing';
  END IF;

  RETURN OLD;
END;
$function$;

-- Democracy Merge V1 multiplayer persistence and player-departure lifecycle.
-- Apply only after review and isolated-database testing; never apply to Production implicitly.


INSERT INTO public.common_multiplayer_game_rules (game_id, min_players, max_players, is_enabled)
VALUES ('democracy-merge', 2, 4, true)
ON CONFLICT (game_id) DO UPDATE
SET min_players = EXCLUDED.min_players,
    max_players = EXCLUDED.max_players,
    is_enabled = EXCLUDED.is_enabled;

CREATE TABLE IF NOT EXISTS public.games_democracy_merge_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.common_multiplayer_rooms(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  game_started_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'playing'
    CHECK (status IN ('playing', 'completed', 'cancelled')),
  character_sequence jsonb NOT NULL CHECK (jsonb_typeof(character_sequence) = 'array'),
  obstacle_sequence jsonb NOT NULL CHECK (jsonb_typeof(obstacle_sequence) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  final_results jsonb,
  UNIQUE (room_id, id),
  CHECK (game_started_at >= started_at),
  CHECK (deadline_at > game_started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS games_democracy_merge_one_active_match_per_room
  ON public.games_democracy_merge_matches(room_id)
  WHERE status = 'playing';

CREATE TABLE IF NOT EXISTS public.games_democracy_merge_match_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  room_id uuid NOT NULL,
  user_id text NOT NULL CHECK (length(btrim(user_id)) > 0),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'surrendered', 'left')),
  board jsonb NOT NULL CHECK (
    jsonb_typeof(board) = 'array' AND jsonb_array_length(board) = 36
  ),
  turn_number integer NOT NULL DEFAULT 0 CHECK (turn_number >= 0),
  score bigint NOT NULL DEFAULT 0 CHECK (score >= 0),
  max_level smallint NOT NULL DEFAULT 1 CHECK (max_level BETWEEN 1 AND 6),
  merge_count integer NOT NULL DEFAULT 0 CHECK (merge_count >= 0),
  chain_reactions integer NOT NULL DEFAULT 0 CHECK (chain_reactions >= 0),
  tools_used integer NOT NULL DEFAULT 0 CHECK (tools_used >= 0),
  coins integer NOT NULL DEFAULT 200 CHECK (coins >= 0),
  inventory jsonb NOT NULL DEFAULT '{"saw":0,"storage":0,"swap":0,"replace":0}'::jsonb
    CHECK (jsonb_typeof(inventory) = 'object'),
  storage jsonb,
  level6_merge_count integer NOT NULL DEFAULT 0 CHECK (level6_merge_count >= 0),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  result jsonb,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (room_id, match_id)
    REFERENCES public.games_democracy_merge_matches(room_id, id) ON DELETE CASCADE,
  UNIQUE (match_id, user_id)
);

CREATE INDEX IF NOT EXISTS games_democracy_merge_players_match_status_idx
  ON public.games_democracy_merge_match_players(match_id, status);

CREATE INDEX IF NOT EXISTS games_democracy_merge_players_room_user_idx
  ON public.games_democracy_merge_match_players(room_id, user_id);

ALTER TABLE public.games_democracy_merge_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_democracy_merge_match_players ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.games_democracy_merge_matches,
  public.games_democracy_merge_match_players FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.games_democracy_merge_matches,
  public.games_democracy_merge_match_players TO service_role;

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

  IF v_active_count = 0 THEN
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

DROP TRIGGER IF EXISTS democracy_merge_player_leave
  ON public.common_multiplayer_players;
CREATE TRIGGER democracy_merge_player_leave
AFTER DELETE ON public.common_multiplayer_players
FOR EACH ROW EXECUTE FUNCTION public.democracy_merge_handle_player_leave();

CREATE OR REPLACE FUNCTION public.democracy_merge_cancel_match_on_room_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.status = 'playing' AND NEW.status = 'cancelled' THEN
    DELETE FROM public.games_democracy_merge_pending_actions
    WHERE match_id IN (
      SELECT id FROM public.games_democracy_merge_matches WHERE room_id = NEW.id
    );
    UPDATE public.games_democracy_merge_matches
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, pg_catalog.clock_timestamp())
    WHERE room_id = NEW.id AND status = 'playing';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS democracy_merge_room_cancel
  ON public.common_multiplayer_rooms;
CREATE TRIGGER democracy_merge_room_cancel
AFTER UPDATE OF status ON public.common_multiplayer_rooms
FOR EACH ROW
WHEN (OLD.status = 'playing' AND NEW.status = 'cancelled')
EXECUTE FUNCTION public.democracy_merge_cancel_match_on_room_cancel();

CREATE OR REPLACE FUNCTION public.democracy_merge_expire_disconnected_players()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room_id uuid;
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_player record;
  v_expired integer := 0;
  v_now timestamptz;
BEGIN
  FOR v_room_id IN
    SELECT DISTINCT r.id
    FROM public.common_multiplayer_rooms r
    JOIN public.games_democracy_merge_matches m ON m.room_id = r.id
    JOIN public.games_democracy_merge_match_players mp ON mp.match_id = m.id
    JOIN public.common_multiplayer_players p
      ON p.room_id = r.id AND p.user_id = mp.user_id
    WHERE r.status = 'playing'
      AND r.game_id = 'democracy-merge'
      AND m.status = 'playing'
      AND m.deadline_at > pg_catalog.clock_timestamp()
      AND mp.status = 'active'
      AND COALESCE(p.last_seen_at, p.joined_at) <= pg_catalog.clock_timestamp() - interval '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.games_democracy_merge_pending_actions pending
        WHERE pending.match_id = m.id
          AND pending.user_id = p.user_id
          AND pending.started_at <= COALESCE(p.last_seen_at, p.joined_at) + interval '5 minutes'
          AND pending.expires_at > pg_catalog.clock_timestamp()
      )
    ORDER BY r.id
  LOOP
    SELECT * INTO v_room
    FROM public.common_multiplayer_rooms
    WHERE id = v_room_id
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR v_room.status <> 'playing' OR v_room.game_id <> 'democracy-merge' THEN
      CONTINUE;
    END IF;

    v_now := pg_catalog.clock_timestamp();
    FOR v_player IN
      SELECT p.user_id
      FROM public.common_multiplayer_players p
      JOIN public.games_democracy_merge_match_players mp
        ON mp.room_id = p.room_id AND mp.user_id = p.user_id
      JOIN public.games_democracy_merge_matches m ON m.id = mp.match_id
      WHERE p.room_id = v_room_id
        AND m.status = 'playing'
        AND m.deadline_at > v_now
        AND mp.status = 'active'
        AND COALESCE(p.last_seen_at, p.joined_at) <= v_now - interval '5 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM public.games_democracy_merge_pending_actions pending
          WHERE pending.match_id = m.id
            AND pending.user_id = p.user_id
            AND pending.started_at <= COALESCE(p.last_seen_at, p.joined_at) + interval '5 minutes'
            AND pending.expires_at > v_now
        )
      ORDER BY p.joined_at, p.id
      FOR UPDATE OF p
    LOOP
      PERFORM public.multiplayer_execute_action(
        'leave_active_match',
        '__game_server__',
        'Game server',
        pg_catalog.jsonb_build_object(
          'roomId', v_room_id,
          'gameId', 'democracy-merge',
          'playerUserId', v_player.user_id
        )
      );
      v_expired := v_expired + 1;
    END LOOP;
  END LOOP;

  RETURN v_expired;
END;
$function$;

REVOKE ALL ON FUNCTION public.democracy_merge_handle_player_leave() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.democracy_merge_cancel_match_on_room_cancel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.democracy_merge_expire_disconnected_players() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.democracy_merge_expire_disconnected_players() TO service_role;

DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'democracy-merge-disconnect-expiry';
  IF FOUND THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule(
    'democracy-merge-disconnect-expiry',
    '30 seconds',
    'SELECT public.democracy_merge_expire_disconnected_players();'
  );
END;
$cron$;



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
    v_started_at + interval '30 minutes 5 seconds',
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
    'deadlineAt', v_started_at + interval '30 minutes 5 seconds',
    'room', public.multiplayer_room_snapshot(p_room_id)
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.democracy_merge_match_snapshot(
  p_room_id uuid,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_democracy_merge_matches%ROWTYPE;
  v_player public.games_democracy_merge_match_players%ROWTYPE;
  v_opponents jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Player is not a current room member' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match
  FROM public.games_democracy_merge_matches
  WHERE room_id = p_room_id
  ORDER BY created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'room', public.multiplayer_room_snapshot(p_room_id),
      'match', NULL
    );
  END IF;

  SELECT * INTO v_player
  FROM public.games_democracy_merge_match_players
  WHERE match_id = v_match.id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player has no record in this match' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'userId', p.user_id,
        'displayName', p.display_name,
        'score', p.score,
        'maxLevel', p.max_level
      )
      ORDER BY p.score DESC, p.max_level DESC, p.joined_at, p.user_id
    ),
    '[]'::jsonb
  )
  INTO v_opponents
  FROM public.games_democracy_merge_match_players p
  WHERE p.match_id = v_match.id AND p.user_id <> p_user_id;

  RETURN pg_catalog.jsonb_build_object(
    'room', public.multiplayer_room_snapshot(p_room_id),
    'match', pg_catalog.jsonb_build_object(
      'matchId', v_match.id,
      'startedAt', v_match.started_at,
      'gameStartedAt', v_match.game_started_at,
      'deadlineAt', v_match.deadline_at,
      'status', v_match.status,
      'completedAt', v_match.completed_at,
      'finalResults', CASE WHEN v_match.status IN ('completed', 'cancelled') THEN v_match.final_results ELSE NULL END,
      'currentCharacter', v_match.character_sequence->v_player.turn_number,
      'nextCharacter', v_match.character_sequence->(v_player.turn_number + 1),
      'obstacleEvent', v_match.obstacle_sequence->v_player.turn_number,
      'players', v_opponents,
      'me', pg_catalog.jsonb_build_object(
        'userId', v_player.user_id,
        'displayName', v_player.display_name,
        'status', v_player.status,
        'board', v_player.board,
        'turnNumber', v_player.turn_number,
        'score', v_player.score,
        'maxLevel', v_player.max_level,
        'mergeCount', v_player.merge_count,
        'chainReactions', v_player.chain_reactions,
        'toolsUsed', v_player.tools_used,
        'coins', v_player.coins,
        'inventory', v_player.inventory,
        'storage', v_player.storage,
        'level6MergeCount', v_player.level6_merge_count,
        'revision', v_player.revision,
        'result', v_player.result
      )
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.democracy_merge_start_match(uuid, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.democracy_merge_match_snapshot(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.democracy_merge_start_match(uuid, text, jsonb, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.democracy_merge_match_snapshot(uuid, text)
  TO service_role;


CREATE TABLE IF NOT EXISTS public.games_democracy_merge_action_receipts (
  match_id uuid NOT NULL REFERENCES public.games_democracy_merge_matches(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  action_id uuid NOT NULL,
  action_type text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id, action_id)
);
ALTER TABLE public.games_democracy_merge_action_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.games_democracy_merge_action_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.games_democracy_merge_action_receipts TO service_role;


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
    WHERE p.match_id = p_match_id AND p.status IN ('completed', 'surrendered')
  ),
  all_rows AS (
    SELECT * FROM ranked
    UNION ALL
    SELECT p.user_id, p.display_name, p.status, p.score, p.max_level,
           p.merge_count, p.chain_reactions, p.tools_used, p.coins,
           NULL::bigint AS place, p.joined_at
    FROM public.games_democracy_merge_match_players p
    WHERE p.match_id = p_match_id AND p.status = 'left'
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
  FROM all_rows;
$function$;


CREATE OR REPLACE FUNCTION public.democracy_merge_commit_player_action(
  p_room_id uuid,
  p_match_id uuid,
  p_user_id text,
  p_action_id uuid,
  p_action_type text,
  p_expected_revision bigint,
  p_state jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_democracy_merge_matches%ROWTYPE;
  v_player public.games_democracy_merge_match_players%ROWTYPE;
  v_receipt public.games_democracy_merge_action_receipts%ROWTYPE;
  v_action_started_at timestamptz;
  v_status text;
  v_turn_number integer;
  v_score bigint;
  v_max_level integer;
  v_merge_count integer;
  v_chain_reactions integer;
  v_tools_used integer;
  v_coins integer;
  v_level6_merge_count integer;
  v_active_count integer;
  v_response jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = ''
     OR p_action_id IS NULL OR p_expected_revision IS NULL
     OR pg_catalog.jsonb_typeof(p_state) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid player action payload' USING ERRCODE = '22023';
  END IF;
  IF p_action_type IS NULL
     OR p_action_type NOT IN ('place_character', 'use_tool', 'buy_tool', 'surrender') THEN
    RAISE EXCEPTION 'Unsupported Democracy Merge action' USING ERRCODE = '22023';
  END IF;

  -- Lock order: shared room -> game match -> game player -> idempotency receipt.
  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id IS DISTINCT FROM 'democracy-merge' THEN
    RAISE EXCEPTION 'Democracy Merge is not selected' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match
  FROM public.games_democracy_merge_matches
  WHERE id = p_match_id AND room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_player
  FROM public.games_democracy_merge_match_players
  WHERE match_id = p_match_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player has no record in this match' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_receipt
  FROM public.games_democracy_merge_action_receipts
  WHERE match_id = p_match_id AND user_id = p_user_id AND action_id = p_action_id;
  IF FOUND THEN
    IF v_receipt.action_type <> p_action_type THEN
      RAISE EXCEPTION 'Action id was already used for another action' USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  SELECT started_at INTO v_action_started_at
  FROM public.games_democracy_merge_pending_actions
  WHERE match_id = p_match_id
    AND user_id = p_user_id
    AND action_id = p_action_id
    AND action_type = p_action_type
    AND expires_at > v_now
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Action reservation is missing or expired' USING ERRCODE = '55000';
  END IF;

  IF v_room.status <> 'playing' OR v_match.status <> 'playing' THEN
    RAISE EXCEPTION 'Match is no longer active' USING ERRCODE = '55000';
  END IF;
  IF v_match.deadline_at <= v_now AND v_action_started_at > v_match.deadline_at THEN
    RAISE EXCEPTION 'Match deadline has passed' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Player is no longer a room member' USING ERRCODE = '42501';
  END IF;
  IF v_player.status <> 'active' THEN
    RAISE EXCEPTION 'Player has already completed this match' USING ERRCODE = '55000';
  END IF;
  IF v_player.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Player state has changed; refresh the match snapshot' USING ERRCODE = '40001';
  END IF;

  v_status := p_state->>'status';
  v_turn_number := (p_state->>'turnNumber')::integer;
  v_score := (p_state->>'score')::bigint;
  v_max_level := (p_state->>'maxLevel')::integer;
  v_merge_count := (p_state->>'mergeCount')::integer;
  v_chain_reactions := (p_state->>'chainReactions')::integer;
  v_tools_used := (p_state->>'toolsUsed')::integer;
  v_coins := (p_state->>'coins')::integer;
  v_level6_merge_count := (p_state->>'level6MergeCount')::integer;

  IF v_status IS NULL OR v_status NOT IN ('active', 'completed', 'surrendered')
     OR v_turn_number IS NULL OR v_score IS NULL OR v_max_level IS NULL
     OR v_merge_count IS NULL OR v_chain_reactions IS NULL OR v_tools_used IS NULL
     OR v_coins IS NULL OR v_level6_merge_count IS NULL
     OR v_turn_number < 0 OR v_score < v_player.score
     OR v_max_level NOT BETWEEN v_player.max_level AND 6
     OR v_merge_count < v_player.merge_count
     OR v_chain_reactions < v_player.chain_reactions
     OR v_tools_used < v_player.tools_used
     OR v_coins < 0
     OR v_level6_merge_count < v_player.level6_merge_count
     OR p_state->'storage' IS NULL THEN
    RAISE EXCEPTION 'Player state failed validation' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_state->'board') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_state->'board') <> 36 THEN
    RAISE EXCEPTION 'Board must contain exactly 36 cells' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_state->'inventory') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Tool inventory must be an object' USING ERRCODE = '22023';
  END IF;

  IF COALESCE((p_state->'inventory'->>'saw')::integer, -1) NOT BETWEEN 0 AND 3
     OR COALESCE((p_state->'inventory'->>'storage')::integer, -1) NOT BETWEEN 0 AND 3
     OR COALESCE((p_state->'inventory'->>'swap')::integer, -1) NOT BETWEEN 0 AND 3
     OR COALESCE((p_state->'inventory'->>'replace')::integer, -1) NOT BETWEEN 0 AND 3 THEN
    RAISE EXCEPTION 'Tool inventory failed validation' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_typeof(p_state->'storage') NOT IN ('null', 'object')
     OR (
       pg_catalog.jsonb_typeof(p_state->'storage') = 'object'
       AND COALESCE((p_state->'storage'->>'level')::integer, 0) NOT BETWEEN 1 AND 6
     ) THEN
    RAISE EXCEPTION 'Storage state failed validation' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_state->'board') AS cell(value)
    WHERE pg_catalog.jsonb_typeof(cell.value) <> 'null'
      AND NOT (
        (
          cell.value->>'kind' = 'character'
          AND COALESCE((cell.value->>'level')::integer, 0) BETWEEN 1 AND 6
        )
        OR (
          cell.value->>'kind' = 'obstacle'
          AND cell.value->>'obstacleType' IN ('barricade', 'police', 'rock')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Board state failed validation' USING ERRCODE = '22023';
  END IF;

  IF p_action_type = 'place_character' AND v_turn_number <> v_player.turn_number + 1 THEN
    RAISE EXCEPTION 'A successful placement must advance exactly one turn' USING ERRCODE = '22023';
  ELSIF p_action_type IN ('use_tool', 'buy_tool', 'surrender')
        AND v_turn_number <> v_player.turn_number THEN
    RAISE EXCEPTION 'This action cannot advance the turn' USING ERRCODE = '22023';
  END IF;
  IF p_action_type = 'surrender' AND v_status <> 'surrendered' THEN
    RAISE EXCEPTION 'Surrender action must finish the player as surrendered' USING ERRCODE = '22023';
  ELSIF p_action_type = 'buy_tool' AND v_status <> 'active' THEN
    RAISE EXCEPTION 'A shop purchase cannot finish the player' USING ERRCODE = '22023';
  ELSIF p_action_type IN ('place_character', 'use_tool') AND v_status = 'surrendered' THEN
    RAISE EXCEPTION 'Only surrender can set surrendered status' USING ERRCODE = '22023';
  END IF;
  IF v_status IN ('completed', 'surrendered')
     AND pg_catalog.jsonb_typeof(p_state->'result') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'A completed player must have a result record' USING ERRCODE = '22023';
  END IF;
  IF v_status = 'active' AND v_player.status <> 'active' THEN
    RAISE EXCEPTION 'Completed player cannot become active again' USING ERRCODE = '55000';
  END IF;

  UPDATE public.games_democracy_merge_match_players
  SET status = v_status,
      board = p_state->'board',
      turn_number = v_turn_number,
      score = v_score,
      max_level = v_max_level,
      merge_count = v_merge_count,
      chain_reactions = v_chain_reactions,
      tools_used = v_tools_used,
      coins = v_coins,
      inventory = p_state->'inventory',
      storage = p_state->'storage',
      level6_merge_count = v_level6_merge_count,
      result = CASE WHEN v_status IN ('completed', 'surrendered') THEN p_state->'result' ELSE NULL END,
      revision = revision + 1,
      updated_at = v_now
  WHERE id = v_player.id;

  SELECT count(*) INTO v_active_count
  FROM public.games_democracy_merge_match_players
  WHERE match_id = p_match_id AND status = 'active';
  IF v_active_count = 0 THEN
    UPDATE public.games_democracy_merge_matches
    SET status = 'completed',
        completed_at = v_now,
        final_results = public.democracy_merge_build_final_results(p_match_id)
    WHERE id = p_match_id AND status = 'playing';
    PERFORM public.democracy_merge_record_completed_match(p_match_id);
  END IF;

  v_response := public.democracy_merge_match_snapshot(p_room_id, p_user_id)
    || pg_catalog.jsonb_build_object('rewards', COALESCE(p_state->'rewards', '[]'::jsonb));
  INSERT INTO public.games_democracy_merge_action_receipts(
    match_id, user_id, action_id, action_type, response
  ) VALUES (p_match_id, p_user_id, p_action_id, p_action_type, v_response);

  DELETE FROM public.games_democracy_merge_pending_actions
  WHERE match_id = p_match_id AND user_id = p_user_id AND action_id = p_action_id;
  IF v_active_count = 0 THEN
    DELETE FROM public.games_democracy_merge_pending_actions WHERE match_id = p_match_id;
  END IF;

  RETURN v_response;
END;
$function$;


CREATE OR REPLACE FUNCTION public.democracy_merge_finalize_expired_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room_id uuid;
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_democracy_merge_matches%ROWTYPE;
  v_now timestamptz;
  v_finalized integer := 0;
BEGIN
  FOR v_room_id IN
    SELECT DISTINCT m.room_id
    FROM public.games_democracy_merge_matches m
    JOIN public.common_multiplayer_rooms r ON r.id = m.room_id
    WHERE m.status = 'playing'
      AND m.deadline_at <= pg_catalog.clock_timestamp()
      AND r.status = 'playing'
      AND r.game_id = 'democracy-merge'
      AND NOT EXISTS (
        SELECT 1 FROM public.games_democracy_merge_pending_actions pending
        WHERE pending.match_id = m.id
          AND pending.started_at <= m.deadline_at
          AND pending.expires_at > pg_catalog.clock_timestamp()
      )
    ORDER BY m.room_id
  LOOP
    SELECT * INTO v_room
    FROM public.common_multiplayer_rooms
    WHERE id = v_room_id
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR v_room.status <> 'playing' OR v_room.game_id <> 'democracy-merge' THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_match
    FROM public.games_democracy_merge_matches
    WHERE room_id = v_room_id AND status = 'playing'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_now := pg_catalog.clock_timestamp();
    IF v_match.deadline_at > v_now OR EXISTS (
      SELECT 1 FROM public.games_democracy_merge_pending_actions pending
      WHERE pending.match_id = v_match.id
        AND pending.started_at <= v_match.deadline_at
        AND pending.expires_at > v_now
    ) THEN CONTINUE; END IF;

    UPDATE public.games_democracy_merge_match_players
    SET status = 'completed',
        result = pg_catalog.jsonb_build_object(
          'score', score,
          'maxLevel', max_level,
          'mergeCount', merge_count,
          'chainReactions', chain_reactions,
          'toolsUsed', tools_used,
          'coins', coins,
          'timedOut', true
        ),
        revision = revision + 1,
        updated_at = v_now
    WHERE match_id = v_match.id AND status = 'active';

    UPDATE public.games_democracy_merge_matches
    SET status = 'completed',
        completed_at = v_now,
        final_results = public.democracy_merge_build_final_results(v_match.id)
    WHERE id = v_match.id AND status = 'playing';
    PERFORM public.democracy_merge_record_completed_match(v_match.id);

    v_finalized := v_finalized + 1;
  END LOOP;

  RETURN v_finalized;
END;
$function$;

REVOKE ALL ON FUNCTION public.democracy_merge_build_final_results(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.democracy_merge_commit_player_action(uuid, uuid, text, uuid, text, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.democracy_merge_finalize_expired_matches()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.democracy_merge_commit_player_action(uuid, uuid, text, uuid, text, bigint, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.democracy_merge_finalize_expired_matches()
  TO service_role;

DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'democracy-merge-deadline-finalization';
  IF FOUND THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule(
    'democracy-merge-deadline-finalization',
    '30 seconds',
    'SELECT public.democracy_merge_finalize_expired_matches();'
  );
END;
$cron$;


-- Per-player match history is separate from immutable match/player results.
-- Deleting a history row never changes match results or aggregate statistics.
CREATE TABLE IF NOT EXISTS public.games_democracy_merge_player_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.games_democracy_merge_matches(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  completed_at timestamptz NOT NULL,
  player_count integer NOT NULL CHECK (player_count >= 1),
  opponents jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(opponents) = 'array'),
  status text NOT NULL CHECK (status IN ('completed', 'surrendered')),
  score bigint NOT NULL CHECK (score >= 0),
  max_level smallint NOT NULL CHECK (max_level BETWEEN 1 AND 6),
  merge_count integer NOT NULL CHECK (merge_count >= 0),
  chain_reactions integer NOT NULL CHECK (chain_reactions >= 0),
  tools_used integer NOT NULL CHECK (tools_used >= 0),
  coins integer NOT NULL CHECK (coins >= 0),
  player_rank integer NOT NULL CHECK (player_rank >= 1),
  UNIQUE (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS games_democracy_merge_history_user_date_idx
  ON public.games_democracy_merge_player_history(user_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS public.games_democracy_merge_player_stats (
  user_id text PRIMARY KEY,
  total_games integer NOT NULL DEFAULT 0 CHECK (total_games >= 0),
  wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses integer NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws integer NOT NULL DEFAULT 0 CHECK (draws >= 0),
  total_points bigint NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  best_score bigint NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  max_level smallint NOT NULL DEFAULT 1 CHECK (max_level BETWEEN 1 AND 6),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.games_democracy_merge_player_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_democracy_merge_player_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.games_democracy_merge_player_history,
  public.games_democracy_merge_player_stats FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.games_democracy_merge_player_history,
  public.games_democracy_merge_player_stats TO service_role;

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
      AND p.status IN ('completed', 'surrendered')
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

CREATE OR REPLACE FUNCTION public.democracy_merge_get_personal_history(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_history jsonb;
  v_stats jsonb;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'A valid player is required' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', h.id, 'matchId', h.match_id, 'completedAt', h.completed_at,
      'playerCount', h.player_count, 'opponents', h.opponents, 'status', h.status,
      'score', h.score, 'maxLevel', h.max_level, 'mergeCount', h.merge_count,
      'chainReactions', h.chain_reactions, 'toolsUsed', h.tools_used,
      'coins', h.coins, 'rank', h.player_rank
    ) ORDER BY h.completed_at DESC, h.id DESC
  ), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT * FROM public.games_democracy_merge_player_history
    WHERE user_id = p_user_id
    ORDER BY completed_at DESC, id DESC
    LIMIT 50
  ) h;

  SELECT pg_catalog.jsonb_build_object(
    'totalGames', COALESCE(s.total_games, 0),
    'wins', COALESCE(s.wins, 0),
    'losses', COALESCE(s.losses, 0),
    'draws', COALESCE(s.draws, 0),
    'totalPoints', COALESCE(s.total_points, 0),
    'bestScore', COALESCE(s.best_score, 0),
    'maxLevel', COALESCE(s.max_level, 1)
  )
  INTO v_stats
  FROM (SELECT 1) seed
  LEFT JOIN public.games_democracy_merge_player_stats s ON s.user_id = p_user_id;

  RETURN pg_catalog.jsonb_build_object('history', v_history, 'stats', v_stats);
END;
$function$;

CREATE OR REPLACE FUNCTION public.democracy_merge_delete_history_record(
  p_user_id text,
  p_record_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.games_democracy_merge_player_history
  WHERE user_id = p_user_id AND id = p_record_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.democracy_merge_record_completed_match(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.democracy_merge_get_personal_history(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.democracy_merge_delete_history_record(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.democracy_merge_record_completed_match(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.democracy_merge_get_personal_history(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.democracy_merge_delete_history_record(text, uuid)
  TO service_role;



-- Reservations serialize a turn/action that began before the match deadline.
-- The deadline finalizer waits for these short-lived server-side reservations.
CREATE TABLE IF NOT EXISTS public.games_democracy_merge_pending_actions (
  match_id uuid NOT NULL REFERENCES public.games_democracy_merge_matches(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  action_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('place_character', 'use_tool', 'buy_tool', 'surrender')),
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (match_id, user_id, action_id),
  CHECK (expires_at > started_at)
);
CREATE INDEX IF NOT EXISTS games_democracy_merge_pending_actions_expiry_idx
  ON public.games_democracy_merge_pending_actions(match_id, expires_at);

ALTER TABLE public.games_democracy_merge_pending_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.games_democracy_merge_pending_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.games_democracy_merge_pending_actions TO service_role;

CREATE OR REPLACE FUNCTION public.democracy_merge_reserve_action(
  p_room_id uuid,
  p_user_id text,
  p_action_id uuid,
  p_action_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_democracy_merge_matches%ROWTYPE;
  v_player public.games_democracy_merge_match_players%ROWTYPE;
  v_receipt public.games_democracy_merge_action_receipts%ROWTYPE;
  v_pending public.games_democracy_merge_pending_actions%ROWTYPE;
  v_last_seen timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = ''
     OR p_action_id IS NULL
     OR p_action_type NOT IN ('place_character', 'use_tool', 'buy_tool', 'surrender') THEN
    RAISE EXCEPTION 'Invalid action reservation' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id IS DISTINCT FROM 'democracy-merge' THEN
    RAISE EXCEPTION 'Democracy Merge is not selected' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match
  FROM public.games_democracy_merge_matches
  WHERE room_id = p_room_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_player
  FROM public.games_democracy_merge_match_players
  WHERE match_id = v_match.id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player has no record in this match' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_receipt
  FROM public.games_democracy_merge_action_receipts
  WHERE match_id = v_match.id AND user_id = p_user_id AND action_id = p_action_id;
  IF FOUND THEN
    IF v_receipt.action_type <> p_action_type THEN
      RAISE EXCEPTION 'Action id was already used for another action' USING ERRCODE = '22023';
    END IF;
    RETURN pg_catalog.jsonb_build_object('replayed', true, 'response', v_receipt.response);
  END IF;

  IF v_room.status <> 'playing' OR v_match.status <> 'playing'
     OR v_player.status <> 'active' THEN
    RAISE EXCEPTION 'Player or match is no longer active' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(last_seen_at, joined_at) INTO v_last_seen
  FROM public.common_multiplayer_players
  WHERE room_id = p_room_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player is no longer a room member' USING ERRCODE = '42501';
  END IF;
  IF v_last_seen <= v_now - interval '5 minutes' THEN
    RAISE EXCEPTION 'The five-minute reconnect window has expired' USING ERRCODE = '55000';
  END IF;
  IF v_match.deadline_at <= v_now THEN
    RAISE EXCEPTION 'Match deadline has passed' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_pending
  FROM public.games_democracy_merge_pending_actions
  WHERE match_id = v_match.id AND user_id = p_user_id AND action_id = p_action_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_pending.action_type <> p_action_type THEN
      RAISE EXCEPTION 'Action id was already reserved for another action' USING ERRCODE = '22023';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'replayed', false,
      'startedAt', v_pending.started_at,
      'expiresAt', v_pending.expires_at
    );
  END IF;

  INSERT INTO public.games_democracy_merge_pending_actions(
    match_id, user_id, action_id, action_type, started_at, expires_at
  ) VALUES (
    v_match.id, p_user_id, p_action_id, p_action_type, v_now, v_now + interval '3 minutes'
  );

  RETURN pg_catalog.jsonb_build_object(
    'replayed', false,
    'startedAt', v_now,
    'expiresAt', v_now + interval '3 minutes'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.democracy_merge_release_action(
  p_match_id uuid,
  p_user_id text,
  p_action_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.games_democracy_merge_pending_actions
  WHERE match_id = p_match_id AND user_id = p_user_id AND action_id = p_action_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.democracy_merge_reserve_action(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.democracy_merge_release_action(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.democracy_merge_reserve_action(uuid, text, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.democracy_merge_release_action(uuid, text, uuid)
  TO service_role;


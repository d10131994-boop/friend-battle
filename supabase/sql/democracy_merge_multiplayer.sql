-- Democracy Merge V1 multiplayer persistence and player-departure lifecycle.
-- Apply only after review and isolated-database testing; never apply to Production implicitly.

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

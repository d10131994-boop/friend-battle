-- Universal multiplayer lobby and three-round Reaction Rush lifecycle.
-- Apply after the existing Multiplayer Core and Reaction Rush SQL foundations.

ALTER TABLE public.common_multiplayer_rooms
  ALTER COLUMN game_id DROP NOT NULL,
  ALTER COLUMN max_players SET DEFAULT 4;

ALTER TABLE public.common_multiplayer_rooms
  DROP CONSTRAINT IF EXISTS common_multiplayer_rooms_game_id_check,
  DROP CONSTRAINT IF EXISTS common_multiplayer_rooms_max_players_check,
  ADD CONSTRAINT common_multiplayer_rooms_game_id_check
    CHECK (game_id IS NULL OR length(btrim(game_id)) > 0),
  ADD CONSTRAINT common_multiplayer_rooms_max_players_check
    CHECK (max_players IS NULL OR max_players BETWEEN 2 AND 4);

CREATE TABLE IF NOT EXISTS public.common_multiplayer_room_stats (
  room_id uuid NOT NULL REFERENCES public.common_multiplayer_rooms(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(btrim(user_id)) > 0),
  wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  matches_played integer NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.common_multiplayer_game_rules (
  game_id text PRIMARY KEY CHECK (length(btrim(game_id)) > 0),
  min_players integer NOT NULL CHECK (min_players >= 1),
  max_players integer NOT NULL CHECK (max_players >= min_players AND max_players <= 4),
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.common_multiplayer_game_rules(game_id, min_players, max_players, is_enabled)
VALUES ('reaction-rush', 2, 4, true)
ON CONFLICT (game_id) DO UPDATE SET
  min_players = EXCLUDED.min_players,
  max_players = EXCLUDED.max_players,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();
ALTER TABLE public.common_multiplayer_game_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.common_multiplayer_game_rules FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.common_multiplayer_game_rules TO service_role;

CREATE TABLE IF NOT EXISTS public.games_reaction_rush_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.common_multiplayer_rooms(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  current_round smallint NOT NULL DEFAULT 1 CHECK (current_round BETWEEN 1 AND 3),
  round_started_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  final_results jsonb,
  winner_user_id text,
  UNIQUE (room_id, id)
);
ALTER TABLE public.games_reaction_rush_matches
  ADD COLUMN IF NOT EXISTS final_results jsonb,
  ADD COLUMN IF NOT EXISTS winner_user_id text;
CREATE UNIQUE INDEX IF NOT EXISTS games_reaction_rush_one_active_match_per_room
  ON public.games_reaction_rush_matches(room_id) WHERE status = 'playing';

CREATE TABLE IF NOT EXISTS public.games_reaction_rush_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.games_reaction_rush_matches(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.common_multiplayer_rooms(id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(btrim(user_id)) > 0),
  round_number smallint NOT NULL CHECK (round_number BETWEEN 1 AND 3),
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1000),
  last_tap_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, user_id, round_number)
);
CREATE INDEX IF NOT EXISTS games_reaction_rush_scores_match_round_idx
  ON public.games_reaction_rush_scores(match_id, round_number);

CREATE TABLE IF NOT EXISTS public.games_reaction_rush_leaderboard (
  user_id text PRIMARY KEY CHECK (length(btrim(user_id)) > 0),
  display_name text NOT NULL,
  wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  matches_played integer NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  total_taps bigint NOT NULL DEFAULT 0 CHECK (total_taps >= 0),
  best_match_score integer NOT NULL DEFAULT 0 CHECK (best_match_score >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.common_multiplayer_room_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_reaction_rush_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_reaction_rush_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_reaction_rush_leaderboard ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.common_multiplayer_room_stats, public.games_reaction_rush_matches,
  public.games_reaction_rush_scores, public.games_reaction_rush_leaderboard
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.common_multiplayer_room_stats, public.games_reaction_rush_matches,
  public.games_reaction_rush_scores, public.games_reaction_rush_leaderboard TO service_role;

CREATE OR REPLACE FUNCTION public.multiplayer_room_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'roomId', r.id,
    'gameId', r.game_id,
    'inviteCode', r.invite_code,
    'status', r.status,
    'maxPlayers', r.max_players,
    'createdAt', r.created_at,
    'startedAt', r.started_at,
    'finishedAt', r.finished_at,
    'players', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'userId', p.user_id,
          'displayName', p.display_name,
          'isReady', p.is_ready,
          'isHost', p.is_host,
          'joinedAt', p.joined_at,
          'lastSeenAt', p.last_seen_at,
          'wins', COALESCE(s.wins, 0),
          'matchesPlayed', COALESCE(s.matches_played, 0)
        ) ORDER BY p.joined_at, p.id
      )
      FROM public.common_multiplayer_players p
      LEFT JOIN public.common_multiplayer_room_stats s
        ON s.room_id = p.room_id AND s.user_id = p.user_id
      WHERE p.room_id = r.id
    ), '[]'::jsonb)
  )
  FROM public.common_multiplayer_rooms r
  WHERE r.id = p_room_id;
$function$;

CREATE OR REPLACE FUNCTION public.multiplayer_execute_action(
  p_action text,
  p_user_id text,
  p_display_name text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_room_id uuid;
  v_next_host_id uuid;
  v_invite_code text;
  v_game_id text;
  v_max_players integer;
  v_is_host boolean;
  v_player_count integer;
  v_ready_count integer;
  v_min_players integer;
  v_game_max_players integer;
  v_last_seen timestamptz;
  v_expected_started_at timestamptz;
  v_departing_user_id text;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'Authenticated caller is required' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'create_room' THEN
    v_max_players := COALESCE((p_payload->>'maxPlayers')::integer, 4);
    IF v_max_players < 2 OR v_max_players > 4 THEN
      RAISE EXCEPTION 'maxPlayers must be between 2 and 4' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.common_multiplayer_rooms(game_id, max_players)
    VALUES (NULL, v_max_players)
    RETURNING * INTO v_room;
    INSERT INTO public.common_multiplayer_players(room_id, user_id, display_name, is_host, last_seen_at)
    VALUES (v_room.id, p_user_id, COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), 'Игрок'), true, pg_catalog.clock_timestamp());
    RETURN public.multiplayer_room_snapshot(v_room.id);
  END IF;

  IF p_action = 'join_room' THEN
    v_invite_code := pg_catalog.lower(pg_catalog.btrim(p_payload->>'inviteCode'));
    IF v_invite_code IS NULL OR v_invite_code = '' OR pg_catalog.length(v_invite_code) > 100 THEN
      RAISE EXCEPTION 'Invalid inviteCode' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_room FROM public.common_multiplayer_rooms
    WHERE invite_code = v_invite_code FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
    IF v_room.status NOT IN ('waiting', 'finished') THEN
      RAISE EXCEPTION 'Room is not accepting players' USING ERRCODE = '55000';
    END IF;
    UPDATE public.common_multiplayer_players
    SET display_name = COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), display_name),
        last_seen_at = pg_catalog.clock_timestamp()
    WHERE room_id = v_room.id AND user_id = p_user_id;
    IF FOUND THEN RETURN public.multiplayer_room_snapshot(v_room.id); END IF;
    SELECT count(*) INTO v_player_count FROM public.common_multiplayer_players WHERE room_id = v_room.id;
    IF v_player_count >= COALESCE(v_room.max_players, 4) THEN
      RAISE EXCEPTION 'Room is full' USING ERRCODE = '54000';
    END IF;
    INSERT INTO public.common_multiplayer_players(room_id, user_id, display_name, last_seen_at)
    VALUES (v_room.id, p_user_id, COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), 'Игрок'), pg_catalog.clock_timestamp());
    RETURN public.multiplayer_room_snapshot(v_room.id);
  END IF;

  BEGIN
    v_room_id := (p_payload->>'roomId')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid roomId' USING ERRCODE = '22023';
  END;
  IF v_room_id IS NULL THEN RAISE EXCEPTION 'roomId is required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;

  IF p_action IN ('start_game', 'finish_game', 'leave_active_match') THEN
    IF p_user_id <> '__game_server__' THEN
      RAISE EXCEPTION 'Trusted game server is required' USING ERRCODE = '42501';
    END IF;
    IF p_payload->>'gameId' IS DISTINCT FROM v_room.game_id THEN
      RAISE EXCEPTION 'Game server is not authorized for this game' USING ERRCODE = '42501';
    END IF;
    IF p_action = 'leave_active_match' THEN
      IF v_room.game_id IS DISTINCT FROM 'democracy-merge' THEN
        RAISE EXCEPTION 'Active-match departure is not enabled for this game' USING ERRCODE = '42501';
      END IF;
      IF v_room.status <> 'playing' THEN
        RAISE EXCEPTION 'There is no active match to leave' USING ERRCODE = '55000';
      END IF;
      v_departing_user_id := NULLIF(pg_catalog.btrim(p_payload->>'playerUserId'), '');
      IF v_departing_user_id IS NULL OR v_departing_user_id = '__game_server__' THEN
        RAISE EXCEPTION 'A valid departing player is required' USING ERRCODE = '22023';
      END IF;
      SELECT p.is_host INTO v_is_host
      FROM public.common_multiplayer_players p
      WHERE p.room_id = v_room_id AND p.user_id = v_departing_user_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Departing player is not a room member' USING ERRCODE = '42501';
      END IF;
      DELETE FROM public.common_multiplayer_players
      WHERE room_id = v_room_id AND user_id = v_departing_user_id;
      IF v_is_host THEN
        SELECT p.id INTO v_next_host_id
        FROM public.common_multiplayer_players p
        WHERE p.room_id = v_room_id
        ORDER BY p.joined_at, p.id
        LIMIT 1;
        IF FOUND THEN
          UPDATE public.common_multiplayer_players SET is_host = true WHERE id = v_next_host_id;
        END IF;
      END IF;
      SELECT count(*) INTO v_player_count
      FROM public.common_multiplayer_players WHERE room_id = v_room_id;
      IF v_player_count = 0 THEN
        UPDATE public.common_multiplayer_rooms
        SET status = 'cancelled', finished_at = COALESCE(finished_at, pg_catalog.clock_timestamp())
        WHERE id = v_room_id;
      END IF;
      RETURN public.multiplayer_room_snapshot(v_room_id);
    END IF;
    IF p_action = 'start_game' THEN
      IF v_room.status NOT IN ('waiting', 'finished') OR v_room.game_id IS NULL THEN
        RAISE EXCEPTION 'Room cannot start a game in its current state' USING ERRCODE = '55000';
      END IF;
      SELECT min_players, max_players INTO v_min_players, v_game_max_players
      FROM public.common_multiplayer_game_rules
      WHERE game_id = v_room.game_id AND is_enabled = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected game is not enabled for multiplayer' USING ERRCODE = '55000';
      END IF;
      SELECT count(*), count(*) FILTER (
        WHERE is_ready AND last_seen_at >= pg_catalog.clock_timestamp() - interval '90 seconds'
      ) INTO v_player_count, v_ready_count
      FROM public.common_multiplayer_players WHERE room_id = v_room_id;
      IF v_player_count < v_min_players OR v_player_count > v_game_max_players THEN
        RAISE EXCEPTION 'Player count does not meet the selected game rules' USING ERRCODE = '55000';
      END IF;
      IF v_ready_count <> v_player_count THEN
        RAISE EXCEPTION 'All players must be ready to start a new match' USING ERRCODE = '55000';
      END IF;
      UPDATE public.common_multiplayer_rooms
      SET status = 'playing', started_at = pg_catalog.clock_timestamp(), finished_at = NULL
      WHERE id = v_room_id;
      UPDATE public.common_multiplayer_players SET is_ready = false WHERE room_id = v_room_id;
      RETURN public.multiplayer_room_snapshot(v_room_id);
    END IF;
    BEGIN
      v_expected_started_at := (p_payload->>'startedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'A valid startedAt value is required' USING ERRCODE = '22023';
    END;
    IF v_room.status = 'finished' AND v_room.started_at = v_expected_started_at THEN
      RETURN public.multiplayer_room_snapshot(v_room_id);
    END IF;
    IF v_room.status <> 'playing' OR v_room.started_at IS DISTINCT FROM v_expected_started_at THEN
      RAISE EXCEPTION 'Game session is no longer active' USING ERRCODE = '55000';
    END IF;
    UPDATE public.common_multiplayer_rooms
    SET status = 'finished',
        finished_at = pg_catalog.clock_timestamp()
    WHERE id = v_room_id;
    RETURN public.multiplayer_room_snapshot(v_room_id);
  END IF;

  SELECT p.is_host INTO v_is_host
  FROM public.common_multiplayer_players p
  WHERE p.room_id = v_room_id AND p.user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not a member of this room' USING ERRCODE = '42501'; END IF;

  IF p_action = 'get_room' THEN
    RETURN public.multiplayer_room_snapshot(v_room_id);
  ELSIF p_action = 'select_game' THEN
    IF NOT v_is_host THEN RAISE EXCEPTION 'Only the host can select a game' USING ERRCODE = '42501'; END IF;
    IF v_room.status NOT IN ('waiting', 'finished') THEN
      RAISE EXCEPTION 'Game selection is locked during a match' USING ERRCODE = '55000';
    END IF;
    v_game_id := pg_catalog.btrim(p_payload->>'gameId');
    IF v_game_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.common_multiplayer_game_rules
      WHERE game_id = v_game_id AND is_enabled = true
    ) THEN
      RAISE EXCEPTION 'Unsupported game selection' USING ERRCODE = '22023';
    END IF;
    UPDATE public.common_multiplayer_rooms SET game_id = v_game_id WHERE id = v_room_id;
    RETURN public.multiplayer_room_snapshot(v_room_id);
  ELSIF p_action = 'set_ready' THEN
    IF v_room.status NOT IN ('waiting', 'finished') THEN
      RAISE EXCEPTION 'Room is not accepting readiness changes' USING ERRCODE = '55000';
    END IF;
    IF pg_catalog.jsonb_typeof(p_payload->'isReady') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'isReady must be boolean' USING ERRCODE = '22023';
    END IF;
    UPDATE public.common_multiplayer_players
    SET is_ready = (p_payload->>'isReady')::boolean, last_seen_at = pg_catalog.clock_timestamp()
    WHERE room_id = v_room_id AND user_id = p_user_id;
    RETURN public.multiplayer_room_snapshot(v_room_id);
  ELSIF p_action = 'leave_room' THEN
    IF v_room.game_id = 'democracy-merge' AND v_room.status = 'playing' THEN
      RAISE EXCEPTION 'Use the trusted active-match departure action for Democracy Merge' USING ERRCODE = '55000';
    END IF;
    DELETE FROM public.common_multiplayer_players WHERE room_id = v_room_id AND user_id = p_user_id;
    IF v_room.status = 'playing' THEN
      UPDATE public.common_multiplayer_rooms
      SET status = 'waiting', game_id = NULL, started_at = NULL, finished_at = NULL
      WHERE id = v_room_id;
      UPDATE public.common_multiplayer_players SET is_ready = false WHERE room_id = v_room_id;
    END IF;
    IF v_is_host THEN
      SELECT id INTO v_next_host_id FROM public.common_multiplayer_players
      WHERE room_id = v_room_id ORDER BY joined_at, id LIMIT 1;
      IF FOUND THEN UPDATE public.common_multiplayer_players SET is_host = true WHERE id = v_next_host_id; END IF;
    END IF;
    SELECT count(*) INTO v_player_count FROM public.common_multiplayer_players WHERE room_id = v_room_id;
    IF v_player_count = 0 THEN
      UPDATE public.common_multiplayer_rooms SET status = 'cancelled' WHERE id = v_room_id;
    END IF;
    RETURN public.multiplayer_room_snapshot(v_room_id);
  ELSIF p_action = 'close_room' THEN
    IF NOT v_is_host THEN RAISE EXCEPTION 'Only the host can close the room' USING ERRCODE = '42501'; END IF;
    UPDATE public.common_multiplayer_rooms SET status = 'cancelled' WHERE id = v_room_id;
    RETURN public.multiplayer_room_snapshot(v_room_id);
  ELSIF p_action = 'heartbeat' THEN
    IF v_room.status NOT IN ('waiting', 'starting', 'playing', 'finished') THEN
      RAISE EXCEPTION 'Room is not active' USING ERRCODE = '55000';
    END IF;

    SELECT COALESCE(last_seen_at, joined_at) INTO v_last_seen
    FROM public.common_multiplayer_players
    WHERE room_id = v_room_id AND user_id = p_user_id
    FOR UPDATE;

    -- A returning active Democracy Merge player cannot extend the five-minute
    -- return window by sending a heartbeat after the deadline has elapsed.
    -- Completed/surrendered players keep their immutable result and membership.
    IF v_room.game_id = 'democracy-merge'
       AND v_room.status = 'playing'
       AND v_last_seen <= pg_catalog.clock_timestamp() - interval '5 minutes'
       AND EXISTS (
         SELECT 1
         FROM public.games_democracy_merge_match_players mp
         JOIN public.games_democracy_merge_matches dm ON dm.id = mp.match_id
         WHERE mp.room_id = v_room_id
           AND mp.user_id = p_user_id
           AND mp.status = 'active'
           AND dm.status = 'playing'
           AND dm.deadline_at > pg_catalog.clock_timestamp()
       ) THEN
      PERFORM public.multiplayer_execute_action(
        'leave_active_match',
        '__game_server__',
        'Game server',
        pg_catalog.jsonb_build_object(
          'roomId', v_room_id,
          'gameId', 'democracy-merge',
          'playerUserId', p_user_id
        )
      );
      RETURN pg_catalog.jsonb_build_object(
        'roomId', v_room_id,
        'lastSeenAt', v_last_seen,
        'expired', true
      );
    END IF;

    UPDATE public.common_multiplayer_players SET last_seen_at = pg_catalog.clock_timestamp()
    WHERE room_id = v_room_id AND user_id = p_user_id RETURNING last_seen_at INTO v_last_seen;
    RETURN pg_catalog.jsonb_build_object('roomId', v_room_id, 'lastSeenAt', v_last_seen, 'expired', false);
  ELSIF p_action = 'get_room_token' THEN
    IF v_room.status NOT IN ('waiting', 'starting', 'playing', 'finished') THEN
      RAISE EXCEPTION 'Room is not active' USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object('roomId', v_room_id, 'telegramId', p_user_id, 'status', v_room.status);
  END IF;
  RAISE EXCEPTION 'Unknown multiplayer action' USING ERRCODE = '22023';
END;
$function$;

CREATE OR REPLACE FUNCTION public.reaction_rush_start_match(p_room_id uuid, p_user_id text)
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
BEGIN
  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id <> 'reaction-rush' THEN RAISE EXCEPTION 'Reaction Rush is not selected' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players p
    WHERE p.room_id = p_room_id AND p.user_id = p_user_id
      AND p.is_host
  ) THEN
    RAISE EXCEPTION 'Only the room host can start a new match' USING ERRCODE = '42501';
  END IF;
  v_started := public.multiplayer_execute_action(
    'start_game', '__game_server__', 'Game server',
    pg_catalog.jsonb_build_object('roomId', p_room_id, 'gameId', 'reaction-rush')
  );
  v_started_at := (v_started->>'startedAt')::timestamptz;
  DELETE FROM public.games_reaction_rush_matches
  WHERE room_id = p_room_id AND status = 'completed';
  INSERT INTO public.games_reaction_rush_matches(room_id, started_at, round_started_at)
  VALUES (p_room_id, v_started_at, v_started_at) RETURNING id INTO v_match_id;
  RETURN pg_catalog.jsonb_build_object(
    'matchId', v_match_id, 'roundNumber', 1,
    'roundStartedAt', v_started_at, 'room', v_started
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reaction_rush_record_tap(
  p_room_id uuid, p_match_id uuid, p_round_number integer, p_user_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_match public.games_reaction_rush_matches%ROWTYPE;
  v_now timestamptz;
  v_score integer;
BEGIN
  SELECT * INTO v_match FROM public.games_reaction_rush_matches
  WHERE id = p_match_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_match.status <> 'playing' OR v_match.current_round <> p_round_number THEN
    RAISE EXCEPTION 'Reaction Rush round is no longer active' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.common_multiplayer_rooms WHERE id = p_room_id AND status = 'playing' AND started_at = v_match.started_at) THEN
    RAISE EXCEPTION 'Match is not active' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.common_multiplayer_players WHERE room_id = p_room_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_now < v_match.round_started_at OR v_now > v_match.round_started_at + interval '10 seconds' THEN
    RAISE EXCEPTION 'Reaction Rush round has ended' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.games_reaction_rush_scores(match_id, room_id, user_id, round_number, score, last_tap_at)
  VALUES (p_match_id, p_room_id, p_user_id, p_round_number, 1, v_now)
  ON CONFLICT (match_id, user_id, round_number)
  DO UPDATE SET score = public.games_reaction_rush_scores.score + 1, last_tap_at = EXCLUDED.last_tap_at
  WHERE public.games_reaction_rush_scores.score < 1000
  RETURNING score INTO v_score;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maximum score reached for this round' USING ERRCODE = '54000'; END IF;
  RETURN v_score;
END;
$function$;

DROP FUNCTION IF EXISTS public.reaction_rush_finish_round(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.reaction_rush_finish_round(
  p_room_id uuid,
  p_match_id uuid,
  p_round_number integer,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_reaction_rush_matches%ROWTYPE;
  v_results jsonb;
  v_totals jsonb;
  v_winner text;
  v_round_started_at timestamptz;
  v_completed_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'Authenticated player is required' USING ERRCODE = '22023';
  END IF;

  -- Match Multiplayer mutation lock order: room first, then match.
  -- This serializes round completion with leave_room and membership changes.
  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id IS DISTINCT FROM 'reaction-rush'
     OR v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'Reaction Rush match is not active in this room' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match
  FROM public.games_reaction_rush_matches
  WHERE id = p_match_id AND room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002'; END IF;
  IF v_match.started_at IS DISTINCT FROM v_room.started_at THEN
    RAISE EXCEPTION 'Match does not belong to the active room session' USING ERRCODE = '55000';
  END IF;
  IF v_match.status <> 'playing' THEN RAISE EXCEPTION 'Match is not active' USING ERRCODE = '55000'; END IF;
  IF p_round_number <> v_match.current_round THEN
    RAISE EXCEPTION 'Round has already advanced' USING ERRCODE = '55000';
  END IF;
  IF pg_catalog.clock_timestamp() < v_match.round_started_at + interval '10 seconds' THEN
    RAISE EXCEPTION 'Round has not ended yet' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'userId', p.user_id, 'displayName', p.display_name, 'score', COALESCE(s.score, 0)
  ) ORDER BY p.joined_at, p.id), '[]'::jsonb)
  INTO v_results
  FROM public.common_multiplayer_players p
  LEFT JOIN public.games_reaction_rush_scores s
    ON s.match_id = p_match_id AND s.user_id = p.user_id AND s.round_number = p_round_number
  WHERE p.room_id = p_room_id;

  IF p_round_number < 3 THEN
    v_round_started_at := pg_catalog.clock_timestamp();
    UPDATE public.games_reaction_rush_matches
    SET current_round = current_round + 1, round_started_at = v_round_started_at
    WHERE id = p_match_id;
    RETURN pg_catalog.jsonb_build_object(
      'completedRound', p_round_number, 'roundResults', v_results,
      'roundNumber', p_round_number + 1, 'roundStartedAt', v_round_started_at,
      'matchFinished', false
    );
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'userId', p.user_id, 'displayName', p.display_name,
    'score', COALESCE(s.total_score, 0)
  ) ORDER BY COALESCE(s.total_score, 0) DESC, p.joined_at, p.id), '[]'::jsonb)
  INTO v_totals
  FROM public.common_multiplayer_players p
  LEFT JOIN (
    SELECT user_id, sum(score)::integer AS total_score
    FROM public.games_reaction_rush_scores WHERE match_id = p_match_id GROUP BY user_id
  ) s ON s.user_id = p.user_id
  WHERE p.room_id = p_room_id;

  SELECT CASE WHEN count(*) FILTER (WHERE total_score = max_score) = 1
    THEN max(user_id) FILTER (WHERE total_score = max_score) ELSE NULL END
  INTO v_winner
  FROM (
    SELECT user_id, sum(score)::integer AS total_score,
      max(sum(score)::integer) OVER () AS max_score
    FROM public.games_reaction_rush_scores
    WHERE match_id = p_match_id
    GROUP BY user_id
  ) ranked;

  INSERT INTO public.common_multiplayer_room_stats(room_id, user_id, wins, matches_played)
  SELECT p_room_id, p.user_id, CASE WHEN p.user_id = v_winner THEN 1 ELSE 0 END, 1
  FROM public.common_multiplayer_players p WHERE p.room_id = p_room_id
  ON CONFLICT (room_id, user_id) DO UPDATE SET
    wins = public.common_multiplayer_room_stats.wins + EXCLUDED.wins,
    matches_played = public.common_multiplayer_room_stats.matches_played + 1,
    updated_at = now();

  INSERT INTO public.games_reaction_rush_leaderboard(user_id, display_name, wins, matches_played, total_taps, best_match_score)
  SELECT p.user_id, p.display_name, CASE WHEN p.user_id = v_winner THEN 1 ELSE 0 END, 1,
    COALESCE(s.total_score, 0), COALESCE(s.total_score, 0)
  FROM public.common_multiplayer_players p
  LEFT JOIN (
    SELECT user_id, sum(score)::integer AS total_score
    FROM public.games_reaction_rush_scores WHERE match_id = p_match_id GROUP BY user_id
  ) s ON s.user_id = p.user_id
  WHERE p.room_id = p_room_id
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    wins = public.games_reaction_rush_leaderboard.wins + EXCLUDED.wins,
    matches_played = public.games_reaction_rush_leaderboard.matches_played + 1,
    total_taps = public.games_reaction_rush_leaderboard.total_taps + EXCLUDED.total_taps,
    best_match_score = GREATEST(public.games_reaction_rush_leaderboard.best_match_score, EXCLUDED.best_match_score),
    updated_at = now();

  UPDATE public.games_reaction_rush_matches
  SET status = 'completed', completed_at = pg_catalog.clock_timestamp(),
      final_results = v_totals, winner_user_id = v_winner
  WHERE id = p_match_id
  RETURNING completed_at INTO v_completed_at;
  DELETE FROM public.games_reaction_rush_scores WHERE match_id = p_match_id;
  RETURN pg_catalog.jsonb_build_object(
    'completedRound', 3, 'roundResults', v_results, 'finalResults', v_totals,
    'winnerUserId', v_winner, 'matchFinished', true,
    'completedAt', v_completed_at,
    'room', public.multiplayer_room_snapshot(p_room_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reaction_rush_start_match(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reaction_rush_record_tap(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reaction_rush_finish_round(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reaction_rush_start_match(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reaction_rush_record_tap(uuid, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reaction_rush_finish_round(uuid, uuid, integer, text) TO service_role;


CREATE OR REPLACE FUNCTION public.reaction_rush_match_snapshot(p_room_id uuid, p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_reaction_rush_matches%ROWTYPE;
  v_score integer;
BEGIN
  SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.common_multiplayer_players WHERE room_id = p_room_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_match FROM public.games_reaction_rush_matches
  WHERE room_id = p_room_id AND status IN ('playing', 'completed')
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('room', public.multiplayer_room_snapshot(p_room_id), 'match', NULL);
  END IF;
  IF v_match.status = 'playing' THEN
    SELECT score INTO v_score FROM public.games_reaction_rush_scores
    WHERE match_id = v_match.id AND user_id = p_user_id AND round_number = v_match.current_round;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'room', public.multiplayer_room_snapshot(p_room_id),
    'match', pg_catalog.jsonb_build_object(
      'matchId', v_match.id,
      'roundNumber', v_match.current_round,
      'roundStartedAt', v_match.round_started_at,
      'startedAt', v_match.started_at,
      'completedAt', v_match.completed_at,
      'status', v_match.status,
      'finalResults', v_match.final_results,
      'winnerUserId', v_match.winner_user_id,
      'myScore', COALESCE(v_score, 0)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reaction_rush_match_snapshot(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reaction_rush_match_snapshot(uuid, text) TO service_role;


-- Retire the first-generation single-round score store after the new Edge
-- Function is deployed together with this migration.
DROP FUNCTION IF EXISTS public.reaction_rush_record_tap(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.reaction_rush_finish_round(uuid, timestamptz);
DROP TABLE IF EXISTS public.reaction_rush_scores;

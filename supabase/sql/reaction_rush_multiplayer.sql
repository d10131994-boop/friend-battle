-- Reaction Rush server-authoritative multiplayer scoring.
-- The shared room lifecycle remains in Multiplayer Core. This table stores
-- only game-specific score state for one ten-second room session.

CREATE TABLE IF NOT EXISTS public.reaction_rush_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.common_multiplayer_rooms(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  user_id text NOT NULL CHECK (length(btrim(user_id)) > 0),
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1000),
  last_tap_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reaction_rush_scores_room_session_user_key
    UNIQUE (room_id, started_at, user_id)
);

CREATE INDEX IF NOT EXISTS reaction_rush_scores_room_session_idx
  ON public.reaction_rush_scores (room_id, started_at);

ALTER TABLE public.reaction_rush_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reaction_rush_scores FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.reaction_rush_scores TO service_role;

CREATE OR REPLACE FUNCTION public.reaction_rush_record_tap(
  p_room_id uuid,
  p_user_id text,
  p_started_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_game_id text;
  v_status text;
  v_started_at timestamptz;
  v_now timestamptz;
  v_score integer;
BEGIN
  IF p_room_id IS NULL OR p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = ''
     OR p_started_at IS NULL THEN
    RAISE EXCEPTION 'Invalid tap request' USING ERRCODE = '22023';
  END IF;

  SELECT r.game_id, r.status, r.started_at
    INTO v_game_id, v_status, v_started_at
  FROM public.common_multiplayer_rooms AS r
  WHERE r.id = p_room_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_game_id <> 'reaction-rush' THEN
    RAISE EXCEPTION 'Room does not belong to Reaction Rush' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'playing' OR v_started_at IS DISTINCT FROM p_started_at THEN
    RAISE EXCEPTION 'This Reaction Rush round is no longer active' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.common_multiplayer_players AS p
    WHERE p.room_id = p_room_id AND p.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501';
  END IF;

  v_now := pg_catalog.clock_timestamp();
  IF v_now < v_started_at OR v_now > v_started_at + interval '10 seconds' THEN
    RAISE EXCEPTION 'Reaction Rush round has ended' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.reaction_rush_scores AS current_score (
    room_id, started_at, user_id, score, last_tap_at
  )
  VALUES (p_room_id, p_started_at, p_user_id, 1, v_now)
  ON CONFLICT (room_id, started_at, user_id)
  DO UPDATE SET
    score = current_score.score + 1,
    last_tap_at = EXCLUDED.last_tap_at
  WHERE current_score.score < 1000
    AND EXCLUDED.last_tap_at <= current_score.started_at + interval '10 seconds'
  RETURNING score INTO v_score;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maximum score reached for this round' USING ERRCODE = '54000';
  END IF;

  RETURN v_score;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reaction_rush_finish_round(
  p_room_id uuid,
  p_started_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_game_id text;
  v_status text;
  v_started_at timestamptz;
  v_results jsonb;
BEGIN
  IF p_room_id IS NULL OR p_started_at IS NULL THEN
    RAISE EXCEPTION 'Invalid round finish request' USING ERRCODE = '22023';
  END IF;

  SELECT r.game_id, r.status, r.started_at
    INTO v_game_id, v_status, v_started_at
  FROM public.common_multiplayer_rooms AS r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_game_id <> 'reaction-rush' THEN
    RAISE EXCEPTION 'Room does not belong to Reaction Rush' USING ERRCODE = '42501';
  END IF;
  IF v_started_at IS DISTINCT FROM p_started_at THEN
    RAISE EXCEPTION 'Reaction Rush round has been replaced' USING ERRCODE = '55000';
  END IF;

  IF v_status = 'finished' THEN
    -- Idempotent retry for the same completed round.
    NULL;
  ELSIF v_status <> 'playing' THEN
    RAISE EXCEPTION 'Reaction Rush round is not active' USING ERRCODE = '55000';
  ELSIF pg_catalog.clock_timestamp() < v_started_at + interval '10 seconds' THEN
    RAISE EXCEPTION 'Reaction Rush round has not ended yet' USING ERRCODE = '55000';
  ELSE
    UPDATE public.common_multiplayer_rooms
    SET status = 'finished',
        finished_at = pg_catalog.clock_timestamp()
    WHERE id = p_room_id;
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'userId', p.user_id,
        'displayName', p.display_name,
        'score', COALESCE(s.score, 0)
      )
      ORDER BY p.joined_at, p.id
    ),
    '[]'::jsonb
  )
  INTO v_results
  FROM public.common_multiplayer_players AS p
  LEFT JOIN public.reaction_rush_scores AS s
    ON s.room_id = p.room_id
   AND s.started_at = p_started_at
   AND s.user_id = p.user_id
  WHERE p.room_id = p_room_id;

  RETURN pg_catalog.jsonb_build_object(
    'room', public.multiplayer_room_snapshot(p_room_id),
    'results', v_results
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reaction_rush_record_tap(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reaction_rush_record_tap(uuid, text, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.reaction_rush_finish_round(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reaction_rush_finish_round(uuid, timestamptz)
  TO service_role;

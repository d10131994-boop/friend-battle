-- New empty leaderboard. Historical records are not copied.
CREATE TABLE public.games_reaction_rush_records (
  telegram_id text PRIMARY KEY,
  username text NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 3000)
);
ALTER TABLE public.games_reaction_rush_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.games_reaction_rush_records FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.games_reaction_rush_records TO service_role;

CREATE TABLE public.games_reaction_rush_solo_sessions (
  telegram_id text PRIMARY KEY,
  session_id uuid NOT NULL DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1000),
  completed_at timestamptz,
  rounds_played integer NOT NULL DEFAULT 0 CHECK (rounds_played >= 0)
);
ALTER TABLE public.games_reaction_rush_solo_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.games_reaction_rush_solo_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.games_reaction_rush_solo_sessions TO service_role;

-- Serializes top-ten updates, preserving a single record per player.
CREATE OR REPLACE FUNCTION public.reaction_rush_save_record(
  p_telegram_id text, p_username text, p_score integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_name text;
BEGIN
  IF p_telegram_id IS NULL OR btrim(p_telegram_id) = '' OR p_score IS NULL
     OR p_score < 0 OR p_score > 3000 THEN
    RAISE EXCEPTION 'Invalid leaderboard record' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(748219, 10);
  SELECT username INTO v_name FROM public.games_reaction_rush_records
  WHERE telegram_id = p_telegram_id;
  v_name := COALESCE(NULLIF(btrim(p_username), ''), v_name, 'Игрок');
  INSERT INTO public.games_reaction_rush_records(telegram_id, username, score)
  VALUES (p_telegram_id, left(v_name, 100), p_score)
  ON CONFLICT (telegram_id) DO UPDATE SET
    username = CASE WHEN p_username IS NULL OR btrim(p_username) = ''
      THEN public.games_reaction_rush_records.username ELSE EXCLUDED.username END,
    score = GREATEST(public.games_reaction_rush_records.score, EXCLUDED.score);
  DELETE FROM public.games_reaction_rush_records WHERE telegram_id IN (
    SELECT telegram_id FROM public.games_reaction_rush_records
    ORDER BY score DESC, telegram_id ASC OFFSET 10
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reaction_rush_refresh_username(
  p_telegram_id text, p_username text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
  IF p_telegram_id IS NULL OR btrim(p_telegram_id) = ''
     OR p_username IS NULL OR btrim(p_username) = '' THEN
    RAISE EXCEPTION 'Invalid Telegram identity' USING ERRCODE = '22023';
  END IF;
  UPDATE public.games_reaction_rush_records
  SET username = left(btrim(p_username), 100) WHERE telegram_id = p_telegram_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reaction_rush_solo_action(
  p_action text, p_telegram_id text, p_username text, p_session_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  v_session public.games_reaction_rush_solo_sessions%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_telegram_id IS NULL OR btrim(p_telegram_id) = '' THEN
    RAISE EXCEPTION 'Invalid Telegram identity' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'start' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.common_game_availability
      WHERE game_id = 'reaction-rush' AND is_enabled AND is_solo_enabled
    ) THEN RAISE EXCEPTION 'Solo Reaction Rush is disabled' USING ERRCODE = '55000'; END IF;
    INSERT INTO public.games_reaction_rush_solo_sessions(telegram_id)
    VALUES (p_telegram_id)
    ON CONFLICT (telegram_id) DO UPDATE SET
      session_id = gen_random_uuid(), started_at = clock_timestamp(),
      score = 0, completed_at = NULL
    RETURNING * INTO v_session;
  ELSE
    SELECT * INTO v_session FROM public.games_reaction_rush_solo_sessions
    WHERE telegram_id = p_telegram_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Solo session not found' USING ERRCODE = 'P0002'; END IF;
    IF p_action IN ('tap', 'finish') AND (p_session_id IS NULL OR p_session_id <> v_session.session_id) THEN
      RAISE EXCEPTION 'Solo session is no longer active' USING ERRCODE = '55000';
    END IF;
    v_now := clock_timestamp();
    IF p_action = 'tap' THEN
      IF v_session.completed_at IS NOT NULL OR v_now >= v_session.started_at + interval '10 seconds' THEN
        RAISE EXCEPTION 'Solo round has ended' USING ERRCODE = '55000';
      END IF;
      UPDATE public.games_reaction_rush_solo_sessions SET score = score + 1
      WHERE telegram_id = p_telegram_id AND score < 1000 RETURNING * INTO v_session;
      IF NOT FOUND THEN RAISE EXCEPTION 'Maximum score reached' USING ERRCODE = '54000'; END IF;
    ELSIF p_action = 'finish' AND v_session.completed_at IS NULL THEN
      IF v_now < v_session.started_at + interval '10 seconds' THEN
        RAISE EXCEPTION 'Round has not ended yet' USING ERRCODE = '55000';
      END IF;
      UPDATE public.games_reaction_rush_solo_sessions
      SET completed_at = v_now, rounds_played = rounds_played + 1
      WHERE telegram_id = p_telegram_id RETURNING * INTO v_session;
      PERFORM public.reaction_rush_save_record(p_telegram_id, p_username, v_session.score);
    ELSIF p_action NOT IN ('snapshot', 'finish') THEN
      RAISE EXCEPTION 'Unknown solo action' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'sessionId', v_session.session_id, 'startedAt', v_session.started_at,
    'score', v_session.score, 'completed', v_session.completed_at IS NOT NULL,
    'roundsPlayed', v_session.rounds_played,
    'best', (SELECT score FROM public.games_reaction_rush_records WHERE telegram_id = p_telegram_id)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.reaction_rush_save_record(text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reaction_rush_refresh_username(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reaction_rush_solo_action(text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reaction_rush_save_record(text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reaction_rush_refresh_username(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reaction_rush_solo_action(text,text,text,uuid) TO service_role;

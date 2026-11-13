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

-- Preserve the multiplayer lifecycle while directing its final scores to the new shared leaderboard.
CREATE OR REPLACE FUNCTION public.reaction_rush_finish_round(p_room_id uuid, p_match_id uuid, p_round_number integer, p_user_id text)
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
  v_player record;
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

  -- Update shared records for every player, using verified Telegram usernames
  -- when available; the current room name is not used as a username.
  FOR v_player IN
    SELECT p.user_id, COALESCE(s.total_score, 0) AS score
    FROM public.common_multiplayer_players p
    LEFT JOIN (
      SELECT user_id, sum(score)::integer AS total_score
      FROM public.games_reaction_rush_scores WHERE match_id = p_match_id GROUP BY user_id
    ) s ON s.user_id = p.user_id
    WHERE p.room_id = p_room_id
  LOOP
    PERFORM public.reaction_rush_save_record(v_player.user_id, NULL, v_player.score);
  END LOOP;

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
$function$
;

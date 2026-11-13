-- Reaction Rush: award one round point to every player tied for the most taps.
-- The match winner(s) are those with the most round points, including ties.
-- Tap totals remain the score submitted to the shared solo/multiplayer records.
CREATE OR REPLACE FUNCTION public.reaction_rush_finish_round(
  p_room_id uuid, p_match_id uuid, p_round_number integer, p_user_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_reaction_rush_matches%ROWTYPE;
  v_results jsonb;
  v_totals jsonb;
  v_winners jsonb;
  v_winner text;
  v_round_started_at timestamptz;
  v_completed_at timestamptz;
  v_player record;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'Authenticated player is required' USING ERRCODE = '22023';
  END IF;

  -- Shared Multiplayer Core acquires the room lock before match locks.
  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;
  IF v_room.game_id IS DISTINCT FROM 'reaction-rush' OR v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'Reaction Rush match is not active in this room' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match FROM public.games_reaction_rush_matches
  WHERE id = p_match_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002'; END IF;
  IF v_match.started_at IS DISTINCT FROM v_room.started_at THEN
    RAISE EXCEPTION 'Match does not belong to the active room session' USING ERRCODE = '55000';
  END IF;
  IF v_match.status <> 'playing' THEN
    RAISE EXCEPTION 'Match is not active' USING ERRCODE = '55000';
  END IF;
  IF p_round_number <> v_match.current_round THEN
    RAISE EXCEPTION 'Round has already advanced' USING ERRCODE = '55000';
  END IF;
  IF pg_catalog.clock_timestamp() < v_match.round_started_at + interval '10 seconds' THEN
    RAISE EXCEPTION 'Round has not ended yet' USING ERRCODE = '55000';
  END IF;

  WITH round_scores AS (
    SELECT p.user_id, p.display_name, p.joined_at, p.id,
           COALESCE(s.score, 0) AS taps
    FROM public.common_multiplayer_players p
    LEFT JOIN public.games_reaction_rush_scores s
      ON s.match_id = p_match_id
     AND s.user_id = p.user_id
     AND s.round_number = p_round_number
    WHERE p.room_id = p_room_id
  ), ranked AS (
    SELECT *, pg_catalog.max(taps) OVER () AS most_taps FROM round_scores
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'userId', user_id,
    'displayName', display_name,
    'score', taps,
    'roundPoint', CASE WHEN taps = most_taps THEN 1 ELSE 0 END
  ) ORDER BY joined_at, id), '[]'::jsonb)
  INTO v_results FROM ranked;

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

  -- Include all room players and all three rounds, even for zero-tap rounds.
  -- Each round may have multiple winners. A round tied at zero still awards
  -- one point to every player, consistently with the highest-taps rule.
  WITH player_round_scores AS (
    SELECT p.user_id, p.display_name, p.joined_at, p.id,
           round_number,
           COALESCE(s.score, 0) AS taps
    FROM public.common_multiplayer_players p
    CROSS JOIN pg_catalog.generate_series(1, 3) AS round_number
    LEFT JOIN public.games_reaction_rush_scores s
      ON s.match_id = p_match_id
     AND s.user_id = p.user_id
     AND s.round_number = round_number
    WHERE p.room_id = p_room_id
  ), round_ranked AS (
    SELECT *, pg_catalog.max(taps) OVER (PARTITION BY round_number) AS most_taps
    FROM player_round_scores
  ), match_scores AS (
    SELECT user_id, display_name, joined_at, id,
           pg_catalog.sum(CASE WHEN taps = most_taps THEN 1 ELSE 0 END)::integer AS round_points,
           pg_catalog.sum(taps)::integer AS total_taps
    FROM round_ranked GROUP BY user_id, display_name, joined_at, id
  ), match_ranked AS (
    SELECT *, pg_catalog.max(round_points) OVER () AS most_points
    FROM match_scores
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'userId', user_id,
    'displayName', display_name,
    'score', round_points,
    'totalTaps', total_taps,
    'isWinner', round_points = most_points
  ) ORDER BY round_points DESC, total_taps DESC, joined_at, id), '[]'::jsonb)
  INTO v_totals FROM match_ranked;

  SELECT COALESCE(pg_catalog.jsonb_agg(player->'userId'), '[]'::jsonb)
  INTO v_winners
  FROM pg_catalog.jsonb_array_elements(v_totals) AS player
  WHERE (player->>'isWinner')::boolean;

  -- Keep the legacy single-winner field compatible for non-tied matches.
  -- Multi-winner outcomes are persisted in final_results[*].isWinner.
  IF pg_catalog.jsonb_array_length(v_winners) = 1 THEN
    v_winner := v_winners->>0;
  END IF;

  INSERT INTO public.common_multiplayer_room_stats(room_id, user_id, wins, matches_played)
  SELECT p_room_id, p.user_id,
         CASE WHEN v_winners @> pg_catalog.jsonb_build_array(p.user_id) THEN 1 ELSE 0 END,
         1
  FROM public.common_multiplayer_players p
  WHERE p.room_id = p_room_id
  ON CONFLICT (room_id, user_id) DO UPDATE SET
    wins = public.common_multiplayer_room_stats.wins + EXCLUDED.wins,
    matches_played = public.common_multiplayer_room_stats.matches_played + 1,
    updated_at = pg_catalog.now();

  -- The shared top-ten uses actual taps rather than 0-3 match points.
  -- This keeps solo and multiplayer records on the same scale.
  FOR v_player IN
    SELECT item->>'userId' AS user_id, (item->>'totalTaps')::integer AS total_taps
    FROM pg_catalog.jsonb_array_elements(v_totals) AS item
  LOOP
    PERFORM public.reaction_rush_save_record(v_player.user_id, NULL, v_player.total_taps);
  END LOOP;

  UPDATE public.games_reaction_rush_matches
  SET status = 'completed', completed_at = pg_catalog.clock_timestamp(),
      final_results = v_totals, winner_user_id = v_winner
  WHERE id = p_match_id RETURNING completed_at INTO v_completed_at;

  DELETE FROM public.games_reaction_rush_scores WHERE match_id = p_match_id;
  RETURN pg_catalog.jsonb_build_object(
    'completedRound', 3,
    'roundResults', v_results,
    'finalResults', v_totals,
    'winnerUserId', v_winner,
    'winnerUserIds', v_winners,
    'matchFinished', true,
    'completedAt', v_completed_at,
    'room', public.multiplayer_room_snapshot(p_room_id)
  );
END;
$function$;

-- Keep the service-role-only RPC access model from the existing migration.
REVOKE ALL ON FUNCTION public.reaction_rush_finish_round(uuid,uuid,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reaction_rush_finish_round(uuid,uuid,integer,text)
  TO service_role;

-- The Multiplayer Core already supports rooms with up to four players.
UPDATE public.common_game_availability
SET min_players = 2, max_players = 4, updated_at = pg_catalog.now()
WHERE game_id = 'reaction-rush';

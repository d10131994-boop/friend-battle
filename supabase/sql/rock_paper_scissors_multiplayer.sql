-- Rock Paper Scissors game-owned multiplayer schema and lifecycle.
-- Apply after the existing Multiplayer Core and universal lobby SQL.
-- This is a source patch; do not apply it to Production without explicit approval.

INSERT INTO public.common_multiplayer_game_rules(game_id, min_players, max_players, is_enabled)
VALUES ('rock-paper-scissors', 2, 2, true)
ON CONFLICT (game_id) DO UPDATE SET
  min_players = EXCLUDED.min_players,
  max_players = EXCLUDED.max_players,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = pg_catalog.now();

-- Keep room capacity aligned with the selected game's actual maximum.
-- This makes join_room enforce a two-player cap before the match starts.
CREATE OR REPLACE FUNCTION public.multiplayer_set_room_capacity_from_game()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_game_max_players integer;
  v_player_count integer;
BEGIN
  IF NEW.game_id IS NOT NULL THEN
    SELECT max_players INTO v_game_max_players
    FROM public.common_multiplayer_game_rules
    WHERE game_id = NEW.game_id AND is_enabled = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected game is not enabled' USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO v_player_count
    FROM public.common_multiplayer_players
    WHERE room_id = NEW.id;

    IF v_player_count > v_game_max_players THEN
      RAISE EXCEPTION 'Room already has more players than the selected game allows'
        USING ERRCODE = '55000';
    END IF;

    NEW.max_players := v_game_max_players;
  ELSE
    -- Rooms without a selected game return to the standard four-player capacity.
    NEW.max_players := 4;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS multiplayer_set_room_capacity_from_game
  ON public.common_multiplayer_rooms;
CREATE TRIGGER multiplayer_set_room_capacity_from_game
BEFORE UPDATE OF game_id ON public.common_multiplayer_rooms
FOR EACH ROW
EXECUTE FUNCTION public.multiplayer_set_room_capacity_from_game();

CREATE TABLE IF NOT EXISTS public.games_rock_paper_scissors_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.common_multiplayer_rooms(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'playing'
    CHECK (status IN ('playing', 'completed', 'cancelled')),
  current_round integer NOT NULL DEFAULT 1 CHECK (current_round >= 1),
  phase text NOT NULL DEFAULT 'choosing'
    CHECK (phase IN ('choosing', 'revealing', 'result')),
  phase_started_at timestamptz NOT NULL,
  phase_deadline timestamptz NOT NULL,
  winner_user_id text,
  final_results jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at timestamptz,
  UNIQUE (room_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS games_rock_paper_scissors_one_active_match_per_room
  ON public.games_rock_paper_scissors_matches(room_id)
  WHERE status = 'playing';

CREATE TABLE IF NOT EXISTS public.games_rock_paper_scissors_match_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  room_id uuid NOT NULL,
  user_id text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(user_id)) > 0),
  display_name text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(display_name)) > 0),
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 3),
  joined_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (match_id, user_id),
  FOREIGN KEY (room_id, match_id)
    REFERENCES public.games_rock_paper_scissors_matches(room_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.games_rock_paper_scissors_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  round_number integer NOT NULL CHECK (round_number >= 1),
  winner_user_id text,
  is_draw boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at timestamptz,
  UNIQUE (match_id, round_number),
  FOREIGN KEY (match_id)
    REFERENCES public.games_rock_paper_scissors_matches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.games_rock_paper_scissors_round_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  round_number integer NOT NULL,
  user_id text NOT NULL,
  choice text CHECK (choice IS NULL OR choice IN ('rock', 'scissors', 'paper')),
  chosen_at timestamptz,
  UNIQUE (match_id, round_number, user_id),
  FOREIGN KEY (match_id, round_number)
    REFERENCES public.games_rock_paper_scissors_rounds(match_id, round_number) ON DELETE CASCADE,
  FOREIGN KEY (match_id, user_id)
    REFERENCES public.games_rock_paper_scissors_match_players(match_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS games_rock_paper_scissors_round_players_match_round_idx
  ON public.games_rock_paper_scissors_round_players(match_id, round_number);

ALTER TABLE public.games_rock_paper_scissors_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_rock_paper_scissors_match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_rock_paper_scissors_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_rock_paper_scissors_round_players ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.games_rock_paper_scissors_matches,
  public.games_rock_paper_scissors_match_players,
  public.games_rock_paper_scissors_rounds,
  public.games_rock_paper_scissors_round_players
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.games_rock_paper_scissors_matches,
  public.games_rock_paper_scissors_match_players,
  public.games_rock_paper_scissors_rounds,
  public.games_rock_paper_scissors_round_players
  TO service_role;

CREATE OR REPLACE FUNCTION public.rock_paper_scissors_cancel_match_on_room_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.game_id = 'rock-paper-scissors'
    AND OLD.status = 'playing'
    AND (NEW.status IN ('waiting', 'cancelled') OR NEW.game_id IS DISTINCT FROM OLD.game_id)
  THEN
    UPDATE public.games_rock_paper_scissors_matches
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, pg_catalog.clock_timestamp())
    WHERE room_id = NEW.id AND status = 'playing';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rock_paper_scissors_cancel_match_on_room_reset
  ON public.common_multiplayer_rooms;
CREATE TRIGGER rock_paper_scissors_cancel_match_on_room_reset
AFTER UPDATE OF status, game_id ON public.common_multiplayer_rooms
FOR EACH ROW
EXECUTE FUNCTION public.rock_paper_scissors_cancel_match_on_room_reset();

CREATE OR REPLACE FUNCTION public.rock_paper_scissors_start_match(
  p_room_id uuid,
  p_user_id text,
  p_display_name text
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
  v_existing public.games_rock_paper_scissors_matches%ROWTYPE;
  v_now timestamptz;
  v_player_count integer;
BEGIN
  SELECT * INTO v_room
  FROM public.common_multiplayer_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;

  IF v_room.game_id IS DISTINCT FROM 'rock-paper-scissors' THEN
    RAISE EXCEPTION 'Rock Paper Scissors is not selected' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id AND is_host
  ) THEN
    RAISE EXCEPTION 'Only the room host can start a match' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.games_rock_paper_scissors_matches
  WHERE room_id = p_room_id AND status = 'playing'
  FOR UPDATE;
  IF FOUND AND v_room.status = 'playing'
    AND v_room.started_at IS NOT DISTINCT FROM v_existing.started_at
  THEN
    RETURN public.rock_paper_scissors_match_snapshot(p_room_id, p_user_id);
  END IF;

  SELECT count(*) INTO v_player_count
  FROM public.common_multiplayer_players
  WHERE room_id = p_room_id;
  IF v_player_count <> 2 THEN
    RAISE EXCEPTION 'Rock Paper Scissors requires exactly two players' USING ERRCODE = '55000';
  END IF;

  v_started := public.multiplayer_execute_action(
    'start_game',
    '__game_server__',
    'Game server',
    pg_catalog.jsonb_build_object('roomId', p_room_id, 'gameId', 'rock-paper-scissors')
  );
  v_started_at := (v_started->>'startedAt')::timestamptz;
  v_now := pg_catalog.clock_timestamp();

  INSERT INTO public.games_rock_paper_scissors_matches(
    room_id, started_at, status, current_round, phase, phase_started_at, phase_deadline
  )
  VALUES (
    p_room_id, v_started_at, 'playing', 1, 'choosing', v_now, v_now + interval '3 seconds'
  )
  RETURNING id INTO v_match_id;

  INSERT INTO public.games_rock_paper_scissors_match_players(
    match_id, room_id, user_id, display_name, joined_at
  )
  SELECT v_match_id, p_room_id, p.user_id, p.display_name, p.joined_at
  FROM public.common_multiplayer_players p
  WHERE p.room_id = p_room_id
  ORDER BY p.joined_at, p.id;

  INSERT INTO public.games_rock_paper_scissors_rounds(match_id, round_number)
  VALUES (v_match_id, 1);

  INSERT INTO public.games_rock_paper_scissors_round_players(match_id, round_number, user_id)
  SELECT v_match_id, 1, mp.user_id
  FROM public.games_rock_paper_scissors_match_players mp
  WHERE mp.match_id = v_match_id;

  RETURN public.rock_paper_scissors_match_snapshot(p_room_id, p_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rock_paper_scissors_submit_choice(
  p_room_id uuid,
  p_match_id uuid,
  p_round_number integer,
  p_user_id text,
  p_choice text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_rock_paper_scissors_matches%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_choice IS NULL OR p_choice NOT IN ('rock', 'scissors', 'paper') THEN
    RAISE EXCEPTION 'Invalid choice' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_room FROM public.common_multiplayer_rooms
  WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_match FROM public.games_rock_paper_scissors_matches
  WHERE id = p_match_id AND room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_match.status <> 'playing'
    OR v_room.status <> 'playing'
    OR v_room.game_id IS DISTINCT FROM 'rock-paper-scissors'
    OR v_room.started_at IS DISTINCT FROM v_match.started_at
    OR v_match.current_round <> p_round_number
  THEN
    RAISE EXCEPTION 'Match or round is no longer active' USING ERRCODE = '55000';
  END IF;

  IF v_match.phase <> 'choosing' OR v_now >= v_match.phase_deadline THEN
    RAISE EXCEPTION 'Choice deadline has passed' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.games_rock_paper_scissors_match_players
    WHERE match_id = p_match_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Player is not a member of this match' USING ERRCODE = '42501';
  END IF;

  UPDATE public.games_rock_paper_scissors_round_players
  SET choice = p_choice, chosen_at = v_now
  WHERE match_id = p_match_id AND round_number = p_round_number AND user_id = p_user_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Player is not in this round' USING ERRCODE = '42501'; END IF;

  RETURN pg_catalog.jsonb_build_object('accepted', true, 'choice', p_choice);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rock_paper_scissors_match_snapshot(
  p_room_id uuid,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.common_multiplayer_rooms%ROWTYPE;
  v_match public.games_rock_paper_scissors_matches%ROWTYPE;
  v_round public.games_rock_paper_scissors_rounds%ROWTYPE;
  v_user_one text;
  v_user_two text;
  v_choice_one text;
  v_choice_two text;
  v_round_winner text;
  v_match_winner text;
  v_next_round integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_advanced boolean := false;
  v_players jsonb;
  v_round_players jsonb;
BEGIN
  SELECT * INTO v_room FROM public.common_multiplayer_rooms
  WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.common_multiplayer_players
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match
  FROM public.games_rock_paper_scissors_matches
  WHERE room_id = p_room_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'room', public.multiplayer_room_snapshot(p_room_id),
      'serverNow', v_now,
      'match', NULL,
      'advanced', false
    );
  END IF;

  IF v_match.status = 'playing'
    AND (v_room.status <> 'playing' OR v_room.started_at IS DISTINCT FROM v_match.started_at)
  THEN
    UPDATE public.games_rock_paper_scissors_matches
    SET status = 'cancelled', completed_at = v_now
    WHERE id = v_match.id;
    SELECT * INTO v_match FROM public.games_rock_paper_scissors_matches WHERE id = v_match.id;
    v_advanced := true;
  END IF;

  LOOP
    EXIT WHEN v_match.status <> 'playing' OR v_now < v_match.phase_deadline;

    IF v_match.phase = 'choosing' THEN
      UPDATE public.games_rock_paper_scissors_round_players
      SET choice = 'rock'
      WHERE match_id = v_match.id
        AND round_number = v_match.current_round
        AND choice IS NULL;

      SELECT mp.user_id, rp.choice
      INTO v_user_one, v_choice_one
      FROM public.games_rock_paper_scissors_round_players rp
      JOIN public.games_rock_paper_scissors_match_players mp
        ON mp.match_id = rp.match_id AND mp.user_id = rp.user_id
      WHERE rp.match_id = v_match.id AND rp.round_number = v_match.current_round
      ORDER BY mp.joined_at, mp.user_id
      LIMIT 1;

      SELECT mp.user_id, rp.choice
      INTO v_user_two, v_choice_two
      FROM public.games_rock_paper_scissors_round_players rp
      JOIN public.games_rock_paper_scissors_match_players mp
        ON mp.match_id = rp.match_id AND mp.user_id = rp.user_id
      WHERE rp.match_id = v_match.id AND rp.round_number = v_match.current_round
      ORDER BY mp.joined_at, mp.user_id
      OFFSET 1 LIMIT 1;

      IF v_user_one IS NULL OR v_user_two IS NULL THEN
        RAISE EXCEPTION 'Match must contain exactly two players' USING ERRCODE = '55000';
      END IF;

      v_round_winner := NULL;
      IF v_choice_one <> v_choice_two THEN
        IF (v_choice_one = 'rock' AND v_choice_two = 'scissors')
          OR (v_choice_one = 'scissors' AND v_choice_two = 'paper')
          OR (v_choice_one = 'paper' AND v_choice_two = 'rock')
        THEN
          v_round_winner := v_user_one;
        ELSE
          v_round_winner := v_user_two;
        END IF;
      END IF;

      UPDATE public.games_rock_paper_scissors_rounds
      SET winner_user_id = v_round_winner,
          is_draw = (v_round_winner IS NULL),
          completed_at = v_match.phase_deadline
      WHERE match_id = v_match.id AND round_number = v_match.current_round;

      IF v_round_winner IS NOT NULL THEN
        UPDATE public.games_rock_paper_scissors_match_players
        SET score = score + 1
        WHERE match_id = v_match.id AND user_id = v_round_winner;
      END IF;

      UPDATE public.games_rock_paper_scissors_matches
      SET phase = 'revealing',
          phase_started_at = v_now,
          phase_deadline = v_now + interval '4 seconds'
      WHERE id = v_match.id;
      v_advanced := true;

    ELSIF v_match.phase = 'revealing' THEN
      UPDATE public.games_rock_paper_scissors_matches
      SET phase = 'result',
          phase_started_at = v_now,
          phase_deadline = v_now + interval '4 seconds'
      WHERE id = v_match.id;
      v_advanced := true;

    ELSIF v_match.phase = 'result' THEN
      SELECT user_id INTO v_match_winner
      FROM public.games_rock_paper_scissors_match_players
      WHERE match_id = v_match.id AND score >= 3
      ORDER BY joined_at, user_id
      LIMIT 1;

      IF v_match_winner IS NOT NULL THEN
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'userId', user_id,
            'displayName', display_name,
            'score', score
          ) ORDER BY joined_at, user_id
        )
        INTO v_players
        FROM public.games_rock_paper_scissors_match_players
        WHERE match_id = v_match.id;

        UPDATE public.games_rock_paper_scissors_matches
        SET status = 'completed',
            winner_user_id = v_match_winner,
            final_results = COALESCE(v_players, '[]'::jsonb),
            completed_at = v_now
        WHERE id = v_match.id;

        INSERT INTO public.common_multiplayer_room_stats(
          room_id, user_id, wins, matches_played, updated_at
        )
        SELECT v_match.room_id,
          mp.user_id,
          CASE WHEN mp.user_id = v_match_winner THEN 1 ELSE 0 END,
          1,
          v_now
        FROM public.games_rock_paper_scissors_match_players mp
        WHERE mp.match_id = v_match.id
        ON CONFLICT (room_id, user_id) DO UPDATE SET
          wins = public.common_multiplayer_room_stats.wins + EXCLUDED.wins,
          matches_played = public.common_multiplayer_room_stats.matches_played + EXCLUDED.matches_played,
          updated_at = EXCLUDED.updated_at;

      ELSE
        v_next_round := v_match.current_round + 1;
        INSERT INTO public.games_rock_paper_scissors_rounds(match_id, round_number)
        VALUES (v_match.id, v_next_round);

        INSERT INTO public.games_rock_paper_scissors_round_players(match_id, round_number, user_id)
        SELECT v_match.id, v_next_round, mp.user_id
        FROM public.games_rock_paper_scissors_match_players mp
        WHERE mp.match_id = v_match.id;

        UPDATE public.games_rock_paper_scissors_matches
        SET current_round = v_next_round,
            phase = 'choosing',
            phase_started_at = v_now,
            phase_deadline = v_now + interval '3 seconds'
        WHERE id = v_match.id;
      END IF;
      v_advanced := true;
    END IF;

    SELECT * INTO v_match
    FROM public.games_rock_paper_scissors_matches
    WHERE id = v_match.id;
  END LOOP;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'userId', user_id,
      'displayName', display_name,
      'score', score,
      'joinedAt', joined_at
    ) ORDER BY joined_at, user_id
  )
  INTO v_players
  FROM public.games_rock_paper_scissors_match_players
  WHERE match_id = v_match.id;

  SELECT * INTO v_round
  FROM public.games_rock_paper_scissors_rounds
  WHERE match_id = v_match.id AND round_number = v_match.current_round;

  IF FOUND THEN
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'userId', mp.user_id,
        'displayName', mp.display_name,
        'choice', CASE
          WHEN v_match.phase = 'choosing' AND mp.user_id <> p_user_id THEN NULL
          ELSE rp.choice
        END
      ) ORDER BY mp.joined_at, mp.user_id
    )
    INTO v_round_players
    FROM public.games_rock_paper_scissors_round_players rp
    JOIN public.games_rock_paper_scissors_match_players mp
      ON mp.match_id = rp.match_id AND mp.user_id = rp.user_id
    WHERE rp.match_id = v_match.id AND rp.round_number = v_match.current_round;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'room', public.multiplayer_room_snapshot(p_room_id),
    'serverNow', v_now,
    'advanced', v_advanced,
    'match', pg_catalog.jsonb_build_object(
      'matchId', v_match.id,
      'startedAt', v_match.started_at,
      'completedAt', v_match.completed_at,
      'status', v_match.status,
      'currentRound', v_match.current_round,
      'phase', v_match.phase,
      'phaseStartedAt', v_match.phase_started_at,
      'phaseDeadline', v_match.phase_deadline,
      'players', COALESCE(v_players, '[]'::jsonb),
      'round', CASE WHEN v_round.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
        'roundNumber', v_round.round_number,
        'winnerUserId', v_round.winner_user_id,
        'isDraw', v_round.is_draw,
        'players', COALESCE(v_round_players, '[]'::jsonb)
      ) END,
      'winnerUserId', v_match.winner_user_id,
      'finalResults', v_match.final_results
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.multiplayer_set_room_capacity_from_game() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rock_paper_scissors_cancel_match_on_room_reset() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rock_paper_scissors_start_match(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rock_paper_scissors_submit_choice(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rock_paper_scissors_match_snapshot(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rock_paper_scissors_start_match(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rock_paper_scissors_submit_choice(uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rock_paper_scissors_match_snapshot(uuid, text) TO service_role;

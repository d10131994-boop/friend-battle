-- NoCountIt multiplayer schema and private scene storage.
-- This patch is intentionally game-scoped; shared Multiplayer tables and APIs
-- are not modified.

INSERT INTO public.common_multiplayer_game_rules (
  game_id, min_players, max_players, is_enabled, lifecycle_mode, updated_at
)
VALUES ('no-count-it', 2, 4, true, 'default', pg_catalog.now())
ON CONFLICT (game_id) DO UPDATE SET
  min_players = EXCLUDED.min_players,
  max_players = EXCLUDED.max_players,
  is_enabled = EXCLUDED.is_enabled,
  lifecycle_mode = EXCLUDED.lifecycle_mode,
  updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS public.games_no_count_it_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.common_multiplayer_rooms(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing', 'playing', 'completed', 'technical_aborted', 'cancelled')),
  current_round smallint NOT NULL DEFAULT 1 CHECK (current_round BETWEEN 1 AND 3),
  final_results jsonb,
  winner_user_id text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at timestamptz,
  UNIQUE (room_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS games_no_count_it_one_active_match_per_room
  ON public.games_no_count_it_matches(room_id)
  WHERE status IN ('preparing', 'playing');

CREATE TABLE IF NOT EXISTS public.games_no_count_it_match_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  room_id uuid NOT NULL,
  user_id text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(user_id)) > 0),
  display_name text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(display_name)) > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  total_error bigint NOT NULL DEFAULT 0 CHECK (total_error >= 0),
  joined_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (match_id, user_id),
  FOREIGN KEY (room_id, match_id)
    REFERENCES public.games_no_count_it_matches(room_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS games_no_count_it_match_players_room_idx
  ON public.games_no_count_it_match_players(room_id, match_id);

CREATE TABLE IF NOT EXISTS public.games_no_count_it_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  room_id uuid NOT NULL,
  round_number smallint NOT NULL CHECK (round_number BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing', 'showing', 'answering', 'revealing', 'completed', 'technical_aborted')),
  scene jsonb NOT NULL,
  correct_count integer NOT NULL CHECK (correct_count BETWEEN 0 AND 120),
  target_color text NOT NULL CHECK (target_color IN (
    'red', 'orange', 'yellow', 'green', 'blue',
    'purple', 'pink', 'teal', 'white', 'brown'
  )),
  image_path text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(image_path)) > 0),
  preparation_deadline timestamptz NOT NULL,
  show_started_at timestamptz,
  answer_deadline timestamptz,
  reveal_started_at timestamptz,
  completed_at timestamptz,
  delete_after timestamptz,
  UNIQUE (match_id, round_number),
  FOREIGN KEY (room_id, match_id)
    REFERENCES public.games_no_count_it_matches(room_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS games_no_count_it_rounds_cleanup_idx
  ON public.games_no_count_it_rounds(delete_after)
  WHERE delete_after IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.games_no_count_it_round_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  round_number smallint NOT NULL CHECK (round_number BETWEEN 1 AND 3),
  user_id text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(user_id)) > 0),
  status text NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing', 'ready', 'active', 'excluded_not_ready', 'completed')),
  answer bigint CHECK (answer IS NULL OR answer >= 0),
  error bigint CHECK (error IS NULL OR error >= 0),
  answered_at timestamptz,
  UNIQUE (match_id, round_number, user_id),
  FOREIGN KEY (match_id, round_number)
    REFERENCES public.games_no_count_it_rounds(match_id, round_number) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS games_no_count_it_round_players_round_idx
  ON public.games_no_count_it_round_players(match_id, round_number, status);

ALTER TABLE public.games_no_count_it_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_no_count_it_match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_no_count_it_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games_no_count_it_round_players ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.games_no_count_it_matches,
  public.games_no_count_it_match_players,
  public.games_no_count_it_rounds,
  public.games_no_count_it_round_players
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.games_no_count_it_matches,
  public.games_no_count_it_match_players,
  public.games_no_count_it_rounds,
  public.games_no_count_it_round_players
  TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'no-count-it-scenes',
  'no-count-it-scenes',
  false,
  1048576,
  ARRAY['image/svg+xml']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

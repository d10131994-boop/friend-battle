-- Shared game catalog for solo and multiplayer menus.
-- Apply before universal_lobby_reaction_rush.sql and rock_paper_scissors_multiplayer.sql.

CREATE TABLE IF NOT EXISTS public.common_game_availability (
  game_id text PRIMARY KEY CHECK (pg_catalog.length(pg_catalog.btrim(game_id)) > 0),
  is_solo_enabled boolean NOT NULL DEFAULT false,
  is_multiplayer_enabled boolean NOT NULL DEFAULT false,
  min_players integer NOT NULL DEFAULT 2 CHECK (min_players BETWEEN 2 AND 4),
  max_players integer NOT NULL DEFAULT 4 CHECK (max_players BETWEEN min_players AND 4),
  is_enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.common_game_availability ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.common_game_availability FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.common_game_availability TO anon, authenticated;

DROP POLICY IF EXISTS common_game_availability_public_read
  ON public.common_game_availability;
CREATE POLICY common_game_availability_public_read
  ON public.common_game_availability
  FOR SELECT
  TO anon, authenticated
  USING (true);

INSERT INTO public.common_game_availability (
  game_id,
  is_solo_enabled,
  is_multiplayer_enabled,
  min_players,
  max_players,
  is_enabled,
  sort_order
)
VALUES
  ('reaction-rush', true, true, 2, 4, true, 10),
  ('brain-battle', false, true, 2, 4, true, 20),
  ('no-count-it', false, true, 2, 4, true, 30),
  ('rock-paper-scissors', true, true, 2, 2, true, 40)
ON CONFLICT (game_id) DO UPDATE SET
  is_solo_enabled = EXCLUDED.is_solo_enabled,
  is_multiplayer_enabled = EXCLUDED.is_multiplayer_enabled,
  min_players = EXCLUDED.min_players,
  max_players = EXCLUDED.max_players,
  is_enabled = EXCLUDED.is_enabled,
  sort_order = EXCLUDED.sort_order,
  updated_at = pg_catalog.now();

COMMENT ON TABLE public.common_game_availability IS
  'Public read-only catalog controlling global, solo and multiplayer game availability and player limits.';
COMMENT ON COLUMN public.common_game_availability.game_id IS
  'Stable game identifier; must match the game ID used by the application and Multiplayer Core.';
COMMENT ON COLUMN public.common_game_availability.is_enabled IS
  'Global switch. When false, the game is hidden from every mode.';
COMMENT ON COLUMN public.common_game_availability.is_solo_enabled IS
  'Whether the game is offered in the solo menu when globally enabled.';
COMMENT ON COLUMN public.common_game_availability.is_multiplayer_enabled IS
  'Whether the game is offered and selectable in multiplayer when globally enabled.';

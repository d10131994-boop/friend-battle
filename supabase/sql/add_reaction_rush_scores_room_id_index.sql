-- Speed up room-scoped lookups in Reaction Rush round scores.
CREATE INDEX IF NOT EXISTS idx_games_reaction_rush_scores_room_id
  ON public.games_reaction_rush_scores (room_id);

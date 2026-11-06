-- Cover the composite room/match foreign key on game rounds.
CREATE INDEX IF NOT EXISTS games_no_count_it_rounds_room_match_idx
ON public.games_no_count_it_rounds(room_id,match_id);

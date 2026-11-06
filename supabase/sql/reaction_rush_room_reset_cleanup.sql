-- Reaction Rush owns its interrupted-match cleanup.
-- Multiplayer Core only resets the shared room; this game-owned hook removes
-- the active match (and its dependent score rows) when that room is reset or
-- closed while a match is still playing.

CREATE OR REPLACE FUNCTION public.reaction_rush_delete_active_match_on_room_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.status = 'playing' AND NEW.status IN ('waiting', 'cancelled') THEN
    DELETE FROM public.games_reaction_rush_matches
    WHERE room_id = NEW.id
      AND status = 'playing';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reaction_rush_delete_active_match_on_room_reset()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reaction_rush_delete_active_match_on_room_reset()
  TO service_role;

DROP TRIGGER IF EXISTS reaction_rush_delete_active_match_on_room_reset
  ON public.common_multiplayer_rooms;

CREATE TRIGGER reaction_rush_delete_active_match_on_room_reset
AFTER UPDATE OF status ON public.common_multiplayer_rooms
FOR EACH ROW
WHEN (OLD.status = 'playing' AND NEW.status IN ('waiting', 'cancelled'))
EXECUTE FUNCTION public.reaction_rush_delete_active_match_on_room_reset();

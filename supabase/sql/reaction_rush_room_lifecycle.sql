-- Reaction Rush-owned cleanup hook for shared room lifecycle transitions.
-- Multiplayer Core changes only common room state; this game module owns its match rows.

CREATE OR REPLACE FUNCTION public.reaction_rush_cleanup_matches_on_room_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status = 'cancelled'
     OR (OLD.status = 'playing' AND NEW.status = 'waiting') THEN
    DELETE FROM public.games_reaction_rush_matches
    WHERE room_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reaction_rush_cleanup_matches_on_room_reset
  ON public.common_multiplayer_rooms;

CREATE TRIGGER reaction_rush_cleanup_matches_on_room_reset
AFTER UPDATE OF status ON public.common_multiplayer_rooms
FOR EACH ROW
WHEN (
  NEW.status = 'cancelled'
  OR (OLD.status = 'playing' AND NEW.status = 'waiting')
)
EXECUTE FUNCTION public.reaction_rush_cleanup_matches_on_room_reset();

REVOKE ALL ON FUNCTION public.reaction_rush_cleanup_matches_on_room_reset()
  FROM PUBLIC, anon, authenticated;

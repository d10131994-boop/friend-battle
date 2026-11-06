-- Release NoCountIt's active-match uniqueness slot when Multiplayer closes or
-- idles out a room. The shared room lifecycle remains owned by Multiplayer.
CREATE OR REPLACE FUNCTION public.no_count_it_cancel_match_on_room_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF OLD.game_id='no-count-it' AND OLD.status='playing' AND NEW.status='cancelled' THEN
  UPDATE public.games_no_count_it_matches
  SET status='cancelled',completed_at=COALESCE(completed_at,pg_catalog.clock_timestamp())
  WHERE room_id=NEW.id AND status IN ('preparing','playing');
 END IF;
 RETURN NEW;
END;$function$;
DROP TRIGGER IF EXISTS no_count_it_room_cancel ON public.common_multiplayer_rooms;
CREATE TRIGGER no_count_it_room_cancel AFTER UPDATE OF status ON public.common_multiplayer_rooms
FOR EACH ROW WHEN (OLD.status='playing' AND NEW.status='cancelled')
EXECUTE FUNCTION public.no_count_it_cancel_match_on_room_cancel();
REVOKE ALL ON FUNCTION public.no_count_it_cancel_match_on_room_cancel() FROM PUBLIC,anon,authenticated;

-- Prevent the legacy readiness flow from bypassing an open unanimous rematch vote.
-- A default-lifecycle room that has an open vote may only start after that vote
-- transitions to accepted. The Multiplayer RPC performs the full unanimous check.
CREATE OR REPLACE FUNCTION public.enforce_multiplayer_rematch_unanimous_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_lifecycle_mode text;
BEGIN
  IF OLD.status = 'finished'
     AND NEW.status = 'playing'
     AND OLD.rematch_status = 'open' THEN
    SELECT lifecycle_mode INTO v_lifecycle_mode
    FROM public.common_multiplayer_game_rules
    WHERE game_id = OLD.game_id
      AND is_enabled = true;

    IF COALESCE(v_lifecycle_mode, 'default') = 'default' THEN
      RAISE EXCEPTION 'Rematch vote must be unanimously accepted before starting'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_multiplayer_rematch_unanimous_start()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_multiplayer_rematch_unanimous_start()
  TO service_role;

DROP TRIGGER IF EXISTS multiplayer_rematch_unanimous_start_guard
  ON public.common_multiplayer_rooms;

CREATE TRIGGER multiplayer_rematch_unanimous_start_guard
BEFORE UPDATE OF status ON public.common_multiplayer_rooms
FOR EACH ROW
WHEN (OLD.status = 'finished' AND NEW.status = 'playing')
EXECUTE FUNCTION public.enforce_multiplayer_rematch_unanimous_start();

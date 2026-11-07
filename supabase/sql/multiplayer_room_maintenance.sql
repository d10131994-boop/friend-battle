-- Multiplayer room maintenance functions.
-- The canonical shared room lifecycle RPC is defined in
-- universal_lobby_reaction_rush.sql. This file intentionally contains only
-- maintenance helpers and must not redefine multiplayer_execute_action.
--
-- multiplayer_cancel_idle_rooms is called by the production pg_cron job
-- multiplayer-room-idle-cleanup every 30 seconds.

CREATE OR REPLACE FUNCTION public.multiplayer_record_heartbeat(
  p_room_id uuid,
  p_user_id text
)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_status text;
  v_last_seen_at timestamptz;
BEGIN
  SELECT r.status
    INTO v_status
  FROM public.common_multiplayer_rooms AS r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status NOT IN ('waiting', 'starting', 'playing', 'finished') THEN
    RAISE EXCEPTION 'Room is not active' USING ERRCODE = '55000';
  END IF;

  UPDATE public.common_multiplayer_players AS p
  SET last_seen_at = pg_catalog.clock_timestamp()
  WHERE p.room_id = p_room_id
    AND p.user_id = p_user_id
  RETURNING p.last_seen_at INTO v_last_seen_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player is not a member of this room'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_last_seen_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.multiplayer_cancel_idle_rooms()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_room record;
  v_last_seen timestamptz;
  v_cancelled_count integer := 0;
BEGIN
  FOR v_room IN
    SELECT r.id, r.created_at
    FROM public.common_multiplayer_rooms AS r
    WHERE r.status IN ('waiting', 'starting', 'playing', 'finished')
    ORDER BY r.created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT pg_catalog.max(p.last_seen_at)
      INTO v_last_seen
    FROM public.common_multiplayer_players AS p
    WHERE p.room_id = v_room.id;

    IF COALESCE(v_last_seen, v_room.created_at)
       <= pg_catalog.clock_timestamp() - interval '10 minutes'
    THEN
      UPDATE public.common_multiplayer_rooms AS r
      SET status = 'cancelled'
      WHERE r.id = v_room.id
        AND r.status IN ('waiting', 'starting', 'playing', 'finished');

      IF FOUND THEN
        v_cancelled_count := v_cancelled_count + 1;
        BEGIN
          PERFORM realtime.send(
            payload => pg_catalog.jsonb_build_object(
              'roomId', v_room.id,
              'status', 'cancelled',
              'reason', 'idle_timeout'
            ),
            event => 'room_updated',
            topic => 'room:' || v_room.id::text,
            private => true
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING
            'Failed to broadcast idle room cancellation for %: %',
            v_room.id,
            SQLERRM;
        END;
      END IF;
    END IF;
  END LOOP;
  RETURN v_cancelled_count;
END;
$function$;

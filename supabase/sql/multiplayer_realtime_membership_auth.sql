-- Realtime room authorization must follow current room membership.
-- The JWT is short-lived and refreshed by MultiplayerRoomSession; this policy
-- rechecks membership whenever Realtime authorizes or refreshes a channel.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_multiplayer_room_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.common_multiplayer_players p
    WHERE p.room_id::text = ((SELECT auth.jwt())->>'room_id')
      AND p.user_id = ((SELECT auth.jwt())->>'telegram_id')
  );
$function$;

REVOKE ALL ON FUNCTION private.is_multiplayer_room_member()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_multiplayer_room_member()
  TO authenticated;

DROP POLICY IF EXISTS "multiplayer room members can receive broadcasts"
  ON realtime.messages;

CREATE POLICY "multiplayer room members can receive broadcasts"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'broadcast'
  AND (SELECT realtime.topic()) = 'room:' || ((SELECT auth.jwt())->>'room_id')
  AND (SELECT private.is_multiplayer_room_member())
);

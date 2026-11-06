-- Realtime room authorization integration checks.
-- Run only against an isolated/local Supabase database.

BEGIN;

DO $test$
DECLARE
  v_host text := '__fb_realtime_host_' || replace(gen_random_uuid()::text, '-', '');
  v_guest text := '__fb_realtime_guest_' || replace(gen_random_uuid()::text, '-', '');
  v_room jsonb;
  v_room_id uuid;
BEGIN
  IF NOT has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'authenticated must have USAGE on private';
  END IF;
  IF NOT has_function_privilege('authenticated', 'private.is_multiplayer_room_member()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must be able to execute the membership helper';
  END IF;
  IF has_function_privilege('anon', 'private.is_multiplayer_room_member()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not be able to execute the membership helper';
  END IF;

  v_room := public.multiplayer_execute_action(
    'create_room', v_host, 'Test host', jsonb_build_object('maxPlayers', 2)
  );
  v_room_id := (v_room->>'roomId')::uuid;
  PERFORM public.multiplayer_execute_action(
    'join_room', v_guest, 'Test guest',
    jsonb_build_object('inviteCode', v_room->>'inviteCode')
  );

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role', 'authenticated',
      'sub', v_guest,
      'room_id', v_room_id,
      'telegram_id', v_guest
    )::text,
    true
  );
  IF NOT private.is_multiplayer_room_member() THEN
    RAISE EXCEPTION 'A current room member was denied Realtime authorization';
  END IF;

  PERFORM public.multiplayer_execute_action(
    'leave_room', v_guest, 'Test guest',
    jsonb_build_object('roomId', v_room_id)
  );
  IF private.is_multiplayer_room_member() THEN
    RAISE EXCEPTION 'A former room member retained Realtime authorization';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role', 'authenticated',
      'sub', v_host,
      'room_id', v_room_id,
      'telegram_id', v_host
    )::text,
    true
  );
  IF NOT private.is_multiplayer_room_member() THEN
    RAISE EXCEPTION 'The remaining room member lost Realtime authorization';
  END IF;
END;
$test$;

ROLLBACK;

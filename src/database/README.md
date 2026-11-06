# Database module

The target architecture is for all browser-side Supabase access to go
through this module. New game and feature code should use this API and must
not import the Supabase client directly.

Some existing application code still uses the legacy `src/supabase.ts`
client directly. Migrating those existing integrations is intentionally
outside the scope of this foundational module task.

## Public API

- `database.getOne / getMany / getById / count`
- `database.create / createMany / update / upsert / delete`
- `database.rpc` for PostgreSQL functions
- `database.invokeFunction` for Supabase Edge Functions
- `database.storage` for Supabase Storage
- `database.realtime` for Postgres Changes and private Broadcast subscriptions
- `createRepository` for feature-specific typed repositories

Operations return data directly and throw a normalized `DatabaseError` when
Supabase reports a failure. Update and delete require explicit filters to
reduce the risk of accidental full-table changes.

## Realtime

The Database module exposes two distinct mechanisms:

- `realtime.subscribe` — Postgres Changes for tables deliberately enabled for
  that use case.
- `realtime.setAuth(token)` and `realtime.subscribeBroadcast(topic, events,
  callback, options)` — private Broadcast channels.

For Multiplayer, use private topics in the form `room:<roomId>`. The room
scoped JWT must be obtained from the trusted server-side Multiplayer endpoint
and installed with `realtime.setAuth(token)` before subscribing. Never put a
signing key or service-role key in browser code.

Broadcast payloads are notifications, not canonical application state. The
Multiplayer layer reloads the room through its trusted server API after
receiving an event. The Database module does not issue tokens or decide room
membership; those checks belong on the server.

Private Broadcast authorization is configured in Production for
Multiplayer. The trusted Multiplayer Edge Function issues one-hour ES256
JWTs scoped to a room and Telegram user; the Realtime RLS policy allows
authenticated subscribers to receive Broadcast messages only from the topic
matching the JWT `room_id` claim and requires a `telegram_id` claim.
The client must obtain the token through Multiplayer and call
`realtime.setAuth(token)` before subscribing. Existing tokens are not
immediately revoked when a player leaves; they may remain valid until expiry.
A live multi-player Telegram smoke test remains a separate verification step.

## Schema and migrations

This implementation does not create, alter, or migrate PostgreSQL tables or
Storage buckets. The generic core is ready to address the agreed future
contracts once those tables and buckets exist. Do not invent generated schema
types before the actual schema is finalized; replace the placeholder type
helpers with Supabase-generated types at that point.

Existing rows are not being preserved as part of the current release
rearchitecture. Legacy tables and Edge Functions will be replaced only after
their new shared equivalents are implemented and verified. Privileged
operations must remain in trusted Edge Functions. Never expose a service-role
key in browser code.

## Storage

Storage buckets must be created/configured separately in Supabase. Public URL
generation does not make a private bucket public; use signed URLs for private
assets and configure Storage policies according to the asset's access model.

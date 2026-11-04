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
- `database.realtime` for Postgres change subscriptions
- `createRepository` for feature-specific typed repositories

Operations return data directly and throw a normalized `DatabaseError` when
Supabase reports a failure. Update and delete require explicit filters to
reduce the risk of accidental full-table changes.

## Schema and migrations

This implementation does not create, alter, or migrate PostgreSQL tables or
Storage buckets. The generic core is ready to address the agreed future
contracts once those tables and buckets exist. Do not invent generated schema
types before the actual schema is finalized; replace the placeholder type
helpers with Supabase-generated types at that point.

The existing legacy tables and Edge Functions are not migrated by this task.
Privileged operations must remain in trusted Edge Functions. Never expose a
service-role key in browser code.

## Storage

Storage buckets must be created/configured separately in Supabase. Public URL
generation does not make a private bucket public; use signed URLs for private
assets and configure Storage policies according to the asset's access model.

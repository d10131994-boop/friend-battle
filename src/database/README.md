# Database module

All browser-side Supabase access should go through this module. Game UI and
feature modules must not import the Supabase client directly.

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

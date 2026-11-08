# Database — AI integration guide

This document describes the current `src/database` implementation for AI-assisted development. It complements the human-oriented `README.md`. The code is authoritative for the client API; the actual Supabase schema, policies and deployed functions are authoritative for server behavior. This module does not itself create or migrate database objects.

## 1. Purpose and boundaries

`src/database` is the shared browser-side access layer for Supabase:
- table reads and mutations;
- PostgreSQL RPC calls;
- Supabase Edge Function invocation;
- Supabase Storage operations;
- Realtime Postgres Changes and Broadcast;
- typed table repository wrappers;
- normalized remote-operation errors.

New feature and game code should use this public module rather than creating another Supabase client or importing the raw client directly.

The module does not:
- define application authorization or replace RLS;
- create tables, migrations, buckets or policies;
- make a multi-request workflow atomic;
- make arbitrary RPC functions safe to call from a browser;
- provide privileged server credentials.

Complex or security-sensitive operations belong in trusted server-side code (typically Supabase Edge Functions and SQL RPC functions) with explicit validation and narrow grants.

## 2. Client configuration

`src/database/client/supabaseClient.ts` creates the single browser-side Supabase client from:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The module throws during initialization if either variable is missing. Only a publishable/anon browser key belongs in the frontend. Never place a `service_role` key in Vite variables, browser bundles, local storage or client requests.

The public entrypoint `src/database/index.ts` does **not** export `supabaseClient` or a raw Supabase client. It exports the `database` facade and named service APIs described below.

`src/supabase.ts` is a separate legacy client module and still exists. Existing code may continue to import it. Do not claim that legacy direct imports have all been removed, and do not migrate unrelated legacy callers as part of a task that does not include that work.

## 3. Public API

Import from `src/database` (normally via the module's configured alias/relative path).

The `database` facade contains:
- `getOne`, `getMany`, `getById`, `count`;
- `create`, `createMany`, `update`, `upsert`, `delete`;
- `rpc`;
- `invokeFunction`;
- `storage`;
- `realtime`.

The entrypoint also exports named `rpc`, `invokeFunction`, `storage`, `realtime`, `createRepository`, `DatabaseError`, and the public database/query/storage/Realtime types. It does not export the internal `dataService`, raw client, error normalizer or query helpers.

### CRUD/query methods

- `getOne<T>(table, options?)` returns one row or `null`. It uses `maybeSingle()`; a supplied limit may be 0 or 1 only. Limit 0 returns `null`.
- `getById<T>(table, id, idColumn = 'id', columns = '*')` is a convenience wrapper around `getOne`.
- `getMany<T>(table, options?)` returns an array. Without an explicit limit it requests up to 1000 rows. Use `offset`/limit carefully; for large or changing datasets prefer a deliberate cursor/keyset strategy at the feature level.
- `count(table, filters = [])` performs an exact head count. Empty filters are allowed, so this can count the whole table.
- `create<T>(table, values)` inserts one row and returns the inserted row.
- `createMany<T>(table, values)` inserts rows and returns the returned rows.
- `update<T>(table, values, filters)` returns updated rows.
- `upsert<T>(table, values, onConflict?)` returns inserted/updated rows.
- `delete<T>(table, filters)` returns deleted rows.

Filters have `column`, `operator`, `value`. Supported operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, `contains`, `containedBy`, `overlaps`. The `in` operator requires an array value. Ordering accepts one order object or an array; each object has `column`, optional `ascending`, `nullsFirst` and `referencedTable`.

Pagination validates non-negative safe integers. For `getMany`, an offset without a limit uses the default page size of 1000. For `getOne`, an offset without a limit selects one row at that offset.

**Safety guard:** `update` and `delete` require at least one filter. This prevents accidental unfiltered full-table mutations through this facade. Do not bypass the guard by importing the raw client. This guard is not a substitute for RLS or server-side authorization.

The generic CRUD layer accepts table names as strings and record values as generic records. It does not provide compile-time verification of table names or column names in the current implementation.

### RPC and Edge Functions

- `database.rpc<T>(functionName, args = {})` invokes a PostgreSQL function through the browser Supabase client.
- `database.invokeFunction<TResponse, TBody>(functionName, body, options?)` invokes a Supabase Edge Function. Optional `options.headers` are forwarded as invocation headers.

Both methods normalize Supabase failures to `DatabaseError`. Their generic return types are compile-time declarations only; they do not validate the response payload. Validate untrusted or security-critical response data at the feature adapter boundary, as Multiplayer does.

Calling an RPC from the browser does not make it safe. Before using one, inspect its execute grants, RLS interaction, SECURITY DEFINER status, owner, `search_path`, and whether it trusts client-supplied identity or authorization fields. Privileged actions should be exposed through a trusted server boundary.

### Repositories

`createRepository<TRecord>(tableName, idColumn = 'id')` creates a typed wrapper for the CRUD methods. It does not create a table, infer a schema, add authorization or enforce business rules. Feature-specific repositories should be added only for real domain use cases and should use the agreed actual table contract.

The current `repositories/common/index.ts` and `repositories/games/index.ts` are intentionally empty placeholders. Do not invent repositories or legacy schema assumptions to fill them.

## 4. Errors

Remote CRUD, RPC, Edge Function and Storage failures are normalized by `normalizeDatabaseError` into `DatabaseError`, which carries:
- `message`;
- `code` (fallback `DATABASE_ERROR`);
- optional `details`, `hint`, `operation`, `status`;
- original `cause`.

The operation field identifies the call context, e.g. `getMany:<table>`, `rpc:<function>`, `edge-function:<name>` or `storage.upload:<bucket>/<path>`.

Local argument validation may throw native `TypeError` or `RangeError` before a Supabase request is made. Do not assume every thrown error is a `DatabaseError`. The normalizer returns an existing `DatabaseError` unchanged.

Do not display raw database details or privileged server errors to end users without deliberate mapping. Feature layers should translate known expected failures into domain-appropriate messages while retaining diagnostic causes for logs.

## 5. Storage API

`database.storage` exposes:
- `upload(bucket, path, file, options?)` → stored path;
- `download(bucket, path)` → `Blob`;
- `getPublicUrl(bucket, path)` → public URL string;
- `createSignedUrl(bucket, path, expiresInSeconds)` → signed URL;
- `remove(bucket, paths)`;
- `list(bucket, folder?, options?)` → normalized file entries.

Upload options include `cacheControl`, `contentType`, `upsert`. List options include `limit`, `offset`, `search`, `sortBy`. Paths/buckets and signed URL expiry are validated.

The module does not create buckets or configure bucket visibility/policies. `getPublicUrl` constructs a public URL; it does not make a private bucket public or bypass its access policy. Use signed URLs for private assets and configure Storage policies separately. Do not store sensitive data in public buckets.

## 6. Realtime API

Two distinct Realtime mechanisms are available.

### Postgres Changes

`realtime.subscribe(table, callback, options?)` subscribes to Postgres Changes. Options include `schema` (default `public`), `event` (default `*`), `filter` and `onStatus`.

The callback receives a Supabase Postgres Changes payload. Subscription statuses are `SUBSCRIBED`, `TIMED_OUT`, `CLOSED`, `CHANNEL_ERROR`.

### Broadcast

- `realtime.setAuth(token)` installs a non-empty Realtime access token on the shared client.
- `realtime.subscribeBroadcast(topic, events, callback, options?)` subscribes to the named Broadcast events. Private mode defaults to `true`.
- `realtime.unsubscribe(channel)` removes a channel and reports removal failures as `DatabaseError`.

Broadcast callback payloads are generic records. This layer does not validate application payload schemas or determine whether a user is authorized for a topic. Those responsibilities belong to the server-issued token and Supabase Realtime authorization policies.

For Multiplayer, install the room-scoped JWT before joining private topic `room:<roomId>`. Treat Broadcast as an invalidation signal and fetch canonical state from the trusted Multiplayer API; do not treat an event payload as the source of truth.

The Database README describes the private Broadcast path as requiring the signing key, server token issuer and matching Realtime RLS policies to be configured. Multiplayer's README separately records that a key rotation was performed but live end-to-end acceptance of a newly issued JWT had not yet been verified. Therefore do not claim that private Broadcast is fully verified merely because the client methods exist or a key was rotated. Confirm the actual target environment and run the real integration smoke test.

## 7. Types and schema status

Current schema types in `types/database.types.ts` are placeholders:
- `DatabaseTableName = string`;
- `DatabaseRecord = Record<string, unknown>`;
- `DatabaseId = string | number`.

Query, storage and Realtime option types are explicitly declared, but table/column contracts are not generated or enforced by the generic core. The source comment describes replacing the placeholder with Supabase-generated types once the target PostgreSQL schema is finalized.

Do not invent generated types or present the placeholder types as a verified database schema. When the actual schema is agreed and available, generate types from the intended Supabase project and integrate them deliberately.

## 8. Security and architecture rules

- Browser code uses only the publishable key. Never expose `service_role`, signing keys, bot tokens or per-game server secrets.
- RLS and Storage policies are the authorization boundary for browser-accessible data. The Database facade is not an authorization system.
- Never trust client-supplied user IDs, host flags, room membership, status, readiness, scores or winners.
- Keep critical multi-step or atomic operations in SQL RPC/Edge Functions, not a sequence of browser CRUD calls.
- Do not loosen RLS, grants, constraints or triggers to make a client request succeed.
- Do not export or import the raw Supabase client through the public Database API for new code.
- Do not build a universal query-builder or duplicate the Supabase client inside feature modules.
- Do not change live Supabase schema, policies, functions, secrets or buckets without explicit task approval and a clearly agreed scope.
- Database code does not imply that the corresponding table/function/bucket exists in the live project. Verify the deployed schema before relying on it.

## 9. Working on this module

Before changing Database:
1. read this document and `README.md`;
2. inspect the current implementation and all affected feature call sites;
3. distinguish browser client behavior from actual Supabase schema, RLS and deployed function behavior;
4. keep the public API narrow and avoid unrelated legacy migration;
5. update this document in the same task when public API, behavior, security constraints or integration guidance changes;
6. update affected module AI docs when the Database contract they rely on changes.

Report source changes, build/lint, SQL/deployment and real integration tests separately. Never claim a database change is deployed or verified from a successful TypeScript build alone.


## 10. Shared game availability catalog

`public.common_game_availability` is the public read-only catalog used by
both Solo and Multiplayer menus. Browser code reads it only through
`database.getMany` from this module; menus must not import the raw Supabase
client.

The table is deliberately readable by `anon` and `authenticated` with RLS
enabled and a SELECT-only policy. Do not grant browser roles INSERT, UPDATE
or DELETE. Changes to game availability are configuration/deployment
operations performed through approved SQL.

The row contract is:
- `game_id` (primary key);
- `is_solo_enabled`, `is_multiplayer_enabled`;
- `min_players`, `max_players`;
- `is_enabled` (global switch);
- `sort_order`;
- `updated_at`.

A game appears in a menu only when the global flag and that mode's flag are
both true. The menu orders results by `sort_order`. The table is the
availability source of truth; it does not imply that a corresponding game
component or trusted server implementation is present in the current build.

When adding a game, add its row to this table through the approved SQL
workflow and update the menus' presentation/routing registry. The legacy
`common_multiplayer_game_rules` table is not the source of truth for new
features and must not be used for new game registration.

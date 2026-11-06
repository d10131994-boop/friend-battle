# Friend Battle technical audit

Audit snapshot: 2026-11-06. This document records observed state and remaining verification gaps; it is not a claim that the current AI branch has been merged or deployed.

## Security

- All nine application tables in the Production `public` schema have RLS enabled.
- `anon` and `authenticated` have no direct table privileges on those tables; `service_role` has the required server privileges.
- The eleven reviewed Multiplayer/game `SECURITY DEFINER` functions use an empty `search_path`; execution is denied to `PUBLIC`, `anon` and `authenticated`, and granted to `service_role`.
- Security Advisor reports nine INFO findings for RLS-enabled tables without policies. This is intentional for the current server-only table access model and is backed by the explicit table grants above.
- No Critical or High Security Advisor finding was identified in this review.
- Existing room JWTs remain valid until their one-hour expiry after a member leaves. This is an explicitly accepted limitation; no immediate revocation mechanism was added.

## Performance

The current `pg_stat_statements` snapshot shows low observed latency at the current traffic level:

| Operation | Calls | Mean execution |
| --- | ---: | ---: |
| Idle room cleanup | 3,128 | 2.29 ms |
| Shared room action RPC (sampled PostgREST query) | 75 | 1.67 ms |
| Reaction Rush tap RPC | 158 | 0.36 ms |
| Reaction Rush match snapshot RPC | 87 | 0.87 ms |

These are database execution times, not end-to-end request latency, and the sample includes development/integration tests. No database bottleneck justified a SQL/index change.

The Performance Advisor still reports:
- one Realtime RLS initialization-plan warning;
- three unused indexes.

The Realtime policy already uses scalar subqueries for its JWT claim lookups; no additional change was made without a proven improvement. The three indexes remain by decision.

Frontend changes in this audit:
- the common room menu now uses its four-second polling fallback only while private Realtime is not subscribed;
- the solo Reaction Rush timer is cleared on unmount and before a replacement timer starts.

## Error handling and tests

- Added a shared Edge Function SQL error mapper. Expected PostgreSQL business errors return stable HTTP statuses/messages; raw database messages are no longer sent to clients.
- Added Deno unit tests for the shared error mapper and included them in CI.
- Added a transactional Multiplayer Core SQL integration script covering room creation, membership, host-only game selection, start/finish, stale-session rejection, idempotent finish and leave-during-match reset. It now also asserts that the Reaction Rush-owned cleanup hook removes an interrupted match. CI parses this SQL but does not execute it.
- Removed direct Reaction Rush match-table deletion from the shared Multiplayer action RPC. Reaction Rush now owns its room-reset cleanup trigger, matching Brain Battle's game-owned cleanup hook.
- The development Realtime smoke test remains manual and does not verify multi-device match lifecycle or network-failure reconnects.
- No isolated disposable Supabase database is currently wired into CI, so database integration and concurrency tests remain unexecuted automatically.

## Backups

- Added a weekly Sunday 04:00 UTC logical database backup workflow.
- Dumps are encrypted with GPG AES-256 before upload because this repository is public.
- The workflow retains only the latest two matching artifacts.
- The repository owner has configured the required GitHub Actions secrets `SUPABASE_DB_URL` and `BACKUP_ENCRYPTION_PASSPHRASE`.
- The workflow has not yet completed its first backup run. Restore testing is deferred to the repository owner and is outside this audit task. GitHub artifact storage quota was not available through the repository connector and must be checked in repository/account settings.
- The Supabase CLI excludes managed schemas such as `realtime`; the backup workflow separately exports custom `realtime` RLS policies to `realtime-policies.sql` so the room broadcast policy is retained.
- Supabase database dumps do not include Storage API binary objects; other project-level secrets/settings also require separate secure handling.

## Migration architecture

- Production has a central Supabase migration history; Brain Battle is registered there as `20261105180005_brain_battle_multiplayer`.
- Repository SQL patches are not yet a complete timestamped `supabase/migrations` chain.
- A fresh live-schema baseline is still pending. It must be generated from a real dump, reviewed and committed as a baseline only; it must not be applied to Production or used to recreate old migration history.
- See `supabase/MIGRATIONS.md`.

## Session lifecycle architecture

The three agreed modes (`default`, `custom`, `disabled`) and standard unanimous 60-second rematch vote are documented as the target contract in `src/multiplayer/ai-readme.md`. They are not yet implemented in the Production API/schema. Do not treat them as available features until the lifecycle migration, server hooks and tests are delivered.

## Release status

All code/documentation changes described here are on the aggregate `*-AI` branch. The latest build/lint, Deno and SQL parser checks must pass before the task branch is considered ready. No PR or merge was created by this audit.

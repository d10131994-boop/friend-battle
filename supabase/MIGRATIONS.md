# Supabase migration and baseline policy

## Central Production migration history

Production uses Supabase's central migration history, `supabase_migrations.schema_migrations`. Brain Battle and the shared Multiplayer features are part of this same system; there is no separate per-game migration history.

The Production history inspected for the 2026-11-06 release contains these 12 entries:

| Version | Migration |
| --- | --- |
| 20261105124340 | reaction_rush_multiplayer_foundation |
| 20261105124559 | multiplayer_reset_ready_after_start |
| 20261105172439 | universal_lobby_reaction_rush |
| 20261105173225 | add_reaction_rush_scores_room_id_index |
| 20261105180005 | brain_battle_multiplayer |
| 20261106111607 | reaction_rush_finish_round_membership_auth |
| 20261106111617 | remove_legacy_reaction_rush_finish_round_signature |
| 20261106163934 | multiplayer_rematch_lifecycle |
| 20261106164111 | multiplayer_rematch_unanimous_guard |
| 20261106164857 | brain_battle_room_first_lock_order |
| 20261106165641 | reaction_rush_room_reset_cleanup |
| 20261106170102 | multiplayer_realtime_membership_auth |

The central Production history is authoritative for which migrations have been recorded as applied.

## Why repository files do not reproduce the entire history

Supabase migration tracking was introduced after the project already had a live schema and deployed SQL changes. The project deliberately did not reconstruct a fictional migration history from the beginning. That was the correct decision: historical state should not be invented merely to make a new local migration directory look complete.

The repository therefore contains reviewed SQL sources, patches and newer timestamped migrations, but it is not a full replayable history of every schema change ever made to Production. This is a known architectural distinction, not a current deployment defect.

One example is `supabase/migrations/20261106152000_multiplayer_rematch_lifecycle.sql`: the source file retains its original filename, while Production records the deployed migration under version `20261106163934`. Do not rename or reapply it merely to force the timestamps to match. Always inspect the actual Production migration history and deployed database object before deciding whether a migration is pending.

## Canonical SQL sources

The current reviewed sources include:
- `supabase/sql/universal_lobby_reaction_rush.sql` — shared Multiplayer lifecycle and canonical Reaction Rush implementation;
- `supabase/sql/reaction_rush_room_lifecycle.sql` — Reaction Rush-owned cleanup hook for room reset/cancellation;
- `supabase/sql/multiplayer_room_maintenance.sql` — idle-room maintenance helpers;
- `supabase/sql/brain_battle_multiplayer.sql` — Brain Battle schema and server-side functions;
- `supabase/sql/add_reaction_rush_scores_room_id_index.sql` — standalone index patch;
- `supabase/sql/brain_battle_room_first_lock_order.sql` — Brain Battle room-first lock ordering;
- `supabase/sql/reaction_rush_room_reset_cleanup.sql` — Reaction Rush room-reset cleanup;
- `supabase/sql/multiplayer_realtime_membership_auth.sql` — Realtime room-membership authorization.

The historical migrations that introduced rematch remain in the central migration history and must not be edited or replayed. The removal migration `20261107090000_remove_multiplayer_rematch.sql` has been applied to Production. The central Production migration history records it as version `20261107143017` (`20261107090000_remove_multiplayer_rematch`). The historical migrations that introduced rematch remain in migration history; the removal migration drops their deployed schema effects. Do not reapply either historical migration or the removal migration.

## Pending lifecycle removal

The removal migration `20261107090000_remove_multiplayer_rematch` is recorded as applied in Production under version `20261107143017`. It deliberately preserves the historical migration records `20261106163934_multiplayer_rematch_lifecycle` and `20261106164111_multiplayer_rematch_unanimous_guard`; it removes their live schema effects instead of rewriting migration history. The currently inspected Production migration history also includes subsequent NoCountIt lifecycle/storage migrations and `rock_paper_scissors_multiplayer` (`20261107225206`). Always query the live migration history rather than relying on this historical table.

The task branch adds `20261108100000_multiplayer_active_match_departure.sql`. It extends the canonical shared action RPC with a trusted, Democracy Merge-only `leave_active_match` action, prevents generic `leave_room`/`close_room` from resetting an active Democracy Merge match, and checks the five-minute reconnect cutoff before refreshing presence. A valid pending game action started before the cutoff prevents heartbeat/expiry processing from interrupting it. This migration is pending and has not been applied to Production.

The task branch also adds `20261108113000_democracy_merge_multiplayer.sql` with canonical source `supabase/sql/democracy_merge_multiplayer.sql`. It creates private match/player/action/history/statistics tables; trusted start, snapshot, reserve, commit, release, history and deletion RPCs; game-owned departure/room-cancellation triggers; and five-minute disconnect plus 30-minute deadline Cron jobs. It replaces the shared heartbeat guard hook with the Democracy Merge-specific five-minute departure policy. The reserve/commit flow allows an action already accepted before the deadline to finish while preventing new actions after it; the disconnect Cron also waits for valid actions reserved before the five-minute cutoff. This migration depends on `leave_active_match` and the no-op hook from the preceding Multiplayer migration. Both migrations must be applied together before deploying the updated Edge Functions and frontend; they are pending and have not been applied to Production. Test them on an isolated Supabase database first.

## Applied NoCountIt round palette migration

Production records the NoCountIt palette migration as `no_count_it_round_palette` (version `20261112001255`). It replaces the public match snapshot so it returns the distinct candy-color list and jar-interior background color without exposing the private scene seed, object coordinates or correct count. The matching NoCountIt Edge Function is deployed. Continue to preserve this privacy boundary when changing scene generation or rendering.

## Pending NoCountIt early-exit migration

The current Production audit found no `public.no_count_it_exit_early` function, while `public.no_count_it_prepare_next_round` still uses a four-second reveal guard. The task adds `20261112120000_no_count_it_early_exit.sql`, which installs the atomic early-exit RPC and updates the SQL reveal guard to six seconds. Apply and verify this migration before relying on the already-present Edge Function `early_exit` action. A source-code PR does not apply this migration or deploy an Edge Function.

## Baseline decision

A fresh live-schema baseline is optional future work, not a prerequisite for the current release. Do not recreate or backfill old migration history. If a baseline is later needed for a specific workflow, capture it from a real Production dump, review managed-schema exclusions and custom Realtime policies, and commit it as a baseline for future environments only.

Never apply a baseline snapshot to the live Production database. Do not synthesize a purported live baseline from partial SQL patches. The Supabase CLI excludes managed schemas such as `realtime`; the backup workflow separately exports custom `realtime` RLS policies to `realtime-policies.sql`, which must be reviewed when assembling a future baseline.

## Future database change procedure

1. Inspect the deployed object and Production migration history before changing SQL.
2. Create a new timestamped migration using `supabase migration new <name>`.
3. Put the reviewed SQL in `supabase/migrations/` and keep a matching canonical explanation/source where appropriate.
4. Test against an isolated local/test database before Production when practical.
5. Apply the new change through the central Supabase migration system and verify the resulting object, grants, RLS and migration history.
6. Run Supabase security/performance advisors after schema changes.
7. Never invent historical migration entries or reapply a patch that is already deployed.

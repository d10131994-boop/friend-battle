# Supabase migration and baseline policy

## Central migration history

Production uses Supabase's central migration history (`supabase_migrations.schema_migrations`). Brain Battle is part of this same system; its Production migration is `20261105180005_brain_battle_multiplayer`. It must not be managed through a separate per-game migration mechanism.

The Production history inspected during this audit contains:

| Version | Migration |
| --- | --- |
| 20261105124340 | reaction_rush_multiplayer_foundation |
| 20261105124559 | multiplayer_reset_ready_after_start |
| 20261105172439 | universal_lobby_reaction_rush |
| 20261105173225 | add_reaction_rush_scores_room_id_index |
| 20261105180005 | brain_battle_multiplayer |
| 20261106111607 | reaction_rush_finish_round_membership_auth |
| 20261106111617 | remove_legacy_reaction_rush_finish_round_signature |

## Repository state

The current repository stores reviewed SQL sources and patches under `supabase/sql/`. These files are not yet a complete, timestamped, reproducible `supabase/migrations/` chain. A filename in `supabase/sql/` does not prove that a patch is applied to Production.

The current canonical sources are:
- `supabase/sql/universal_lobby_reaction_rush.sql` — shared Multiplayer lifecycle and canonical Reaction Rush implementation;
- `supabase/sql/reaction_rush_room_lifecycle.sql` — Reaction Rush-owned cleanup hook for room reset/cancellation;
- `supabase/sql/multiplayer_room_maintenance.sql` — idle-room maintenance helpers;
- `supabase/sql/brain_battle_multiplayer.sql` — Brain Battle schema and server-side functions;
- `supabase/sql/add_reaction_rush_scores_room_id_index.sql` — standalone index patch.

Do not reapply an already-deployed patch or restore the retired conflicting lifecycle SQL file.

## Baseline decision

The agreed approach is to capture a fresh baseline snapshot from the current live Production schema. Do not recreate or backfill the old migration history, and do not apply the baseline snapshot to the live database. The baseline must be generated from a real database dump, reviewed for managed-schema exclusions and custom Realtime policies, then committed as the starting point for future reproducible migrations. The Supabase CLI excludes managed schemas such as `realtime`; the backup workflow separately exports the live custom `realtime` RLS policies to `realtime-policies.sql`. Include and review that file when assembling the baseline; do not assume `schema.sql` alone captures the Realtime security configuration.

**Current status:** the live migration history has been inspected and both required GitHub Actions secrets (`SUPABASE_DB_URL` and `BACKUP_ENCRYPTION_PASSPHRASE`) have been configured by the repository owner. The first backup workflow run and baseline extraction are still pending. Do not synthesize a purported live baseline from partial SQL patches.

## Future change procedure

1. Inspect the deployed object and migration history before changing SQL.
2. Create a timestamped migration using `supabase migration new <name>`.
3. Put the reviewed SQL in `supabase/migrations/` and keep a matching canonical explanation/source where appropriate.
4. Test against an isolated local/test database before Production.
5. Apply through the central Supabase migration system and verify the resulting object, grants, RLS and migration history.
6. Run Supabase security/performance advisors after schema changes.
7. Never apply a baseline snapshot to Production or invent migration history entries to make local files appear synchronized.

# Friend Battle technical audit

Audit snapshot: 2026-11-06. This document describes the integrated release branch and the observed Production state before task GAMES/COMMON issue-011. It is a historical snapshot, not a live audit of the 2026-11-08 working branch.

Since that snapshot, the app-wide rematch removal was applied to Production. The Democracy Merge work in release 04 is branch-only: its two SQL migrations, catalog registration and updated Edge Functions have not been applied to Production. Recheck the live schema and migration history before treating any finding below as current.

## Release state

- The task branch `friend-battle-03/common/issue-009` was merged into `friend-battle-03-release` through PR #51 after the AI branch was first merged into the task branch through PR #50.
- Release commit: `0c9608c762fece3fe657465387db1a6ac8be5595`.
- The release commit's GitHub CI completed successfully: production build and full source lint, Supabase Edge Function checks, and PostgreSQL SQL parsing.
- Vercel reported a successful deployment/check for the release commit.
- Production Edge Functions match the release source for Multiplayer v10, Reaction Rush v8 and Brain Battle v13.
- This does not mean every multiplayer scenario has been exercised end-to-end on multiple real devices. Those checks remain a manual smoke-test responsibility.

## Security

- Application tables use RLS and the current server-only access model: direct table access is not granted to `anon` or `authenticated`; server operations use `service_role`.
- Reviewed Multiplayer/game `SECURITY DEFINER` functions use an empty `search_path` and restricted execution grants.
- Security Advisor reports INFO findings for RLS-enabled tables without policies. These are consistent with the server-only access model and are not, by themselves, evidence of public table access.
- No Critical or High Security Advisor finding was identified in the review.
- Realtime broadcast authorization checks that the caller is a member of the target room. Room JWTs have a bounded lifetime; immediate revocation of an already-issued token is not implemented.
- The release does not add a global cross-game rating or leaderboard. Ratings/leaderboards remain game-specific where implemented.

## Performance

The previously captured `pg_stat_statements` snapshot showed low database execution latency at the then-current traffic level:

| Operation | Calls | Mean execution |
| --- | ---: | ---: |
| Idle room cleanup | 3,128 | 2.29 ms |
| Shared room action RPC (sampled PostgREST query) | 75 | 1.67 ms |
| Reaction Rush tap RPC | 158 | 0.36 ms |
| Reaction Rush match snapshot RPC | 87 | 0.87 ms |

These are database execution times, not end-to-end request latency, and the sample includes development/integration tests. They should not be treated as a current performance benchmark.

The Performance Advisor has reported:
- one Realtime RLS initialization-plan warning;
- three unused indexes.

The Realtime policy uses scalar subqueries for JWT claim lookups. The indexes remain by decision; no additional performance change was justified by the available evidence.

Frontend changes in this audit:
- the common room menu uses its four-second polling fallback only while private Realtime is not subscribed;
- the solo Reaction Rush timer is cleared on unmount and before a replacement timer starts.

## Error handling and tests

- A shared Edge Function SQL error mapper converts expected PostgreSQL business errors to stable HTTP statuses/messages; raw database messages are not sent to clients.
- Expected stale/finished-round conflicts in Reaction Rush are represented as conflict responses rather than unexpected server failures in the current implementation.
- Deno unit tests cover the shared error mapper and run in CI.
- A transactional Multiplayer Core SQL integration script covers room creation, membership, host-only game selection, start/finish, stale-session rejection, idempotent finish and leave-during-match reset. It also asserts that the Reaction Rush-owned cleanup hook removes an interrupted match and the Brain Battle-owned hook cancels its interrupted match.
- CI parses SQL files but does not execute these integration scripts. They must not be described as having passed against a live or disposable database.
- The development Realtime smoke test remains manual and does not fully verify multi-device match lifecycle or network-failure reconnects.
- No isolated disposable Supabase database is wired into CI, so database integration and concurrency tests are not executed automatically.

## Multiplayer lifecycle and game-owned cleanup

The following changes are integrated into the release and applied to Production:
- shared lifecycle modes: `default`, `custom`, `disabled`;
- session-scoped rematch votes and a 60-second unanimous default vote;
- automatic host-side restart after approval and rematch-aware game start hooks;
- Brain Battle draws a fresh set of ten questions from its server bank while excluding the immediately previous set;
- Reaction Rush creates a new match row for a rematch;
- Reaction Rush owns its room-reset/cancellation cleanup through its game-specific hook, rather than the shared Multiplayer RPC deleting game-owned rows;
- Brain Battle owns cancellation of its interrupted match through its game-specific cleanup hook;
- room-first lock ordering in Brain Battle reduces the risk of lock inversion;
- the shared Realtime broadcast policy validates room membership.

Production migration history records these changes as:
- `20261106163934_multiplayer_rematch_lifecycle`;
- `20261106164111_multiplayer_rematch_unanimous_guard`;
- `20261106164857_brain_battle_room_first_lock_order`;
- `20261106165641_reaction_rush_room_reset_cleanup`;
- `20261106170102_multiplayer_realtime_membership_auth`.

The repository's source migration file `20261106152000_multiplayer_rematch_lifecycle.sql` retains its original filename. Its timestamp is not the Production migration-history version. This is a historical source/deployment distinction, not a request to recreate or backfill the migration history.

The repository owner has also confirmed that scheduled room cleanup (cron) has been configured. Its ongoing execution can be reviewed later; this audit did not change its schedule.

## Leaderboards

- The product has no global cross-game leaderboard. Leaderboards are game-specific features only.
- The obsolete global rating screen/navigation and the client call that attempted to write solo scores to the legacy `leaderboard` table have been removed.
- Solo Reaction Rush personal best and rounds remain local to the player's device; they are not submitted to a global ranking.
- Reaction Rush multiplayer keeps its own `games_reaction_rush_leaderboard`, populated by its game-specific server logic.
- Production had no legacy `public.leaderboard` table, while the old `save-score` Edge Function still attempted to access it. The client no longer calls this endpoint; Production `save-score` was deployed as a retirement response (HTTP 410, version 21).
- No global leaderboard table was created and no player ranking data was migrated or deleted.

## Backups

- A weekly Sunday 04:00 UTC logical database backup workflow is present.
- Dumps are encrypted with GPG AES-256 before upload because this repository is public.
- The workflow retains only the latest two matching artifacts.
- The repository owner has configured the required GitHub Actions secrets `SUPABASE_DB_URL` and `BACKUP_ENCRYPTION_PASSPHRASE`.
- The first successful backup run has not yet been confirmed. Restore testing is deferred. This is intentionally left for later and is not a release blocker in this audit.
- The Supabase CLI excludes managed schemas such as `realtime`; the backup workflow separately exports custom `realtime` RLS policies to `realtime-policies.sql`.
- Supabase database dumps do not include Storage API binary objects; other project-level secrets/settings require separate secure handling.

## Migration architecture

- Production uses Supabase's central migration history, `supabase_migrations.schema_migrations`.
- The Production history currently contains the 12 entries listed in `supabase/MIGRATIONS.md`.
- The repository's SQL sources and patches are not a complete timestamped replay of the database's entire historical evolution. This is intentional: the migration system was introduced after the project already had a live schema, and the old history was not reconstructed from scratch.
- Do not fabricate historical migration entries, rename deployed migrations to force timestamp equality, or replay old patches just to make repository filenames resemble Production history.
- The live Production schema and central migration history are authoritative for already-deployed state. New database changes should use new timestamped migrations and be recorded normally.
- A fresh baseline may be considered separately if it becomes useful for a future workflow. It is not required to validate or operate the current release, and no baseline should be applied to Production.

## Release scope

- The active integration target for this work is `friend-battle-03-release`.
- The release branch is not protected by mandatory PR checks; the repository owner explicitly chose to leave this arrangement unchanged.
- No change to `main` or Telegram publication is included in this audit.

## 2026-11-08 working-branch audit (not Production)

**Scope:** source review of `friend-battle-04/democracy-merge/issue-001-AI`, including app routing, game modules, database facade, Multiplayer Core, Supabase Edge Functions/SQL, GitHub Actions and backup workflow. This is not a live inspection of the deployed Supabase schema or Vercel runtime.

### Verification

- AI branch build: passed.
- CI full source lint and production build: passed.
- PostgreSQL SQL parser: passed, including the new shared-lifecycle boundary check.
- Edge Function/Deno checks: passed on retry. The first attempt failed because GitHub Actions received HTTP 504 while downloading the Deno binary; the rerun completed successfully.
- `supabase/tests/democracy_merge_lifecycle.sql` is present and covers countdown enforcement, action reservations, disconnect/deadline ordering, final departure, result history and aggregate preservation. It has **not** been executed against an isolated Supabase database.
- No Production migration, Supabase Cron change, Vercel deployment, `main` update or PR merge was performed by this task.

### Findings and remaining risks

1. **Deployment blocker — database verification:** migrations `20261108100000_multiplayer_active_match_departure.sql` and `20261108113000_democracy_merge_multiplayer.sql` are branch-only. They must be applied in order to an isolated database and the lifecycle SQL test must pass before Production deployment. The frontend/Edge Functions must not be deployed ahead of those migrations.
2. **Manual integration still required:** real Telegram testing on multiple devices is still needed for synchronized start, concurrent actions, reconnect cutoff, final departure, host transfer, history privacy and results return.
3. **Legacy client debt:** `src/supabase.ts` remains as a second browser-side Supabase client alongside the `src/database` facade. New Democracy Merge and Multiplayer work uses the facade; continue migrating any remaining legacy consumers before removing the old client.
4. **Error-mapping consistency:** NoCountIt still uses local fixed-message SQL error handling and maps several distinct database failures to HTTP 409. It does not expose raw SQL details, but should eventually use the shared `sqlErrorResponse` mapper.
5. **Backup assurance:** the backup workflow encrypts artifacts and retains recent backups, but the earlier audit did not confirm a successful first artifact or a restore drill. Verify both operationally; an encrypted backup is not proven until it has been restored.
6. **Accepted process risk:** release-branch protection/required status checks remain unchanged, as previously agreed. CI now targets current `friend-battle-*-release` and task branches, but branch protection is a separate GitHub setting.
7. **Known historical operational debt:** Realtime policy initialization/performance warnings and unused-index recommendations from the 2026-11-06 Production snapshot have not been re-audited against live Production in this task.

No critical or high-severity issue was identified in the reviewed branch source. That statement is limited to this source review and is not a Production security sign-off.

### Integration state

PR [#90](https://github.com/d10131994-boop/friend-battle/pull/90) proposes the AI branch into task branch `friend-battle-04/democracy-merge/issue-001`. The task branch is based on `friend-battle-03-release`, in accordance with the release workflow. After the PR is merged into the task branch, synchronize that task branch with the active `friend-battle-04-release` before opening the release integration PR and resolve any cross-task conflicts there.

# Supabase test strategy

This directory is reserved for database-level integration tests. Tests here must run only against an isolated local/test database, never against Production as part of CI or deployment.

## Layers

1. **Edge Function unit tests** — Deno's built-in test runner for pure helpers that do not need Supabase credentials or network access. These run in CI. The first suite covers shared PostgreSQL-to-HTTP error mapping in `supabase/functions/_shared/errors_test.ts`.
2. **Database integration tests** — `multiplayer_core.sql` is a transactional test script for room creation without game selection, membership and host authorization, server-side start/finish, stale-session rejection, idempotent finish, leave-during-match reset, and active-room closure. It ends with `ROLLBACK`, but must still be run only against a disposable/local Supabase database. The script checks that leaving during a match removes the interrupted Reaction Rush match through its game-owned hook and marks an interrupted Brain Battle match as cancelled through its own hook. CI currently parses the SQL syntax; it does not execute this script. The question-selector unit test does run in CI. `brain_battle_rematch.sql` verifies two consecutive Brain Battle matches in one room, winner/statistics accumulation across both matches, and idempotent repeated completion. Its synthetic final-question deadlines are moved into the past so the server-side advancement function can complete synchronously. `multiplayer_rematch.sql` separately verifies the default 60-second window, unanimous acceptance, non-host rematch start after approval, one-no decline, lazy expiry, minimum-player cancellation after a leave, host transfer while voting is open, and both disabled and custom lifecycle modes. `multiplayer_rematch_guard.sql` verifies that an open default-mode vote cannot be bypassed through the legacy all-ready start path. The Brain Battle question selector has a Deno unit test that verifies a rematch selects ten unique questions without reusing IDs from the immediately previous match. `multiplayer_realtime_auth.sql` verifies that current room membership is required for Realtime authorization and that a former member loses authorization. Realtime channel authorization is cached for the connection, so room JWTs now expire after 10 minutes and the client refreshes them within the final 5 minutes; broadcasts carry invalidation metadata only, while authoritative game state is fetched from the server. Do not run any database integration script against Production. Extend isolated coverage for custom game-owned hooks and concurrent transactions as those test environments are established.
3. **Frontend unit tests** — add when the relevant pure logic can be tested independently of browser/Telegram state. Avoid introducing a second test framework until the initial Deno and database test layers are established.
4. **End-to-end smoke tests** — the development-only `?multiplayer-smoke=1` surface currently covers room creation, room JWT issuance, private Realtime subscription, initial snapshot and a readiness Broadcast. It is a manual environment test, not a substitute for automated tests or a multi-device match test.

## Required invariants for database integration coverage

- Only a current room member can read or mutate member-scoped state.
- Only the host can select a game, close a room or start an initial match; any current member may trigger a rematch only after unanimous server-validated approval.
- Room membership and game lifecycle transitions are serialized with a consistent room-first lock order. Brain Battle answer submission and question advancement lock the shared room before the game-owned match row, matching room-leave cleanup.
- A stale match/session identifier cannot finish or mutate a newer room session.
- Leaving during a match follows the shared room lifecycle contract; each game module's own database hook cancels or cleans its active match state without direct game-table access from Multiplayer.
- A finished/cancelled room cleanup cascades to game-specific rows.
- Rematch votes are scoped to the exact completed session; all remaining members must vote yes within 60 seconds, a no vote declines, and an unanswered vote expires.
- Repeated requests are idempotent where the public API promises retry safety.
- Game-specific match state remains owned by the game module; Multiplayer must not query game-specific tables directly.

## Execution policy

- CI may run parser/type/unit checks on every aggregate `*-AI` branch.
- Database integration tests must use an ephemeral/local database and synthetic test identities.
- Never place Production credentials or real Telegram initData in test fixtures.
- A passing build, SQL parser, or helper unit test does not prove that the deployed Production database or multi-device Telegram flow works.

# Supabase test strategy

This directory is reserved for database-level integration tests. Tests here must run only against an isolated local/test database, never against Production as part of CI or deployment.

## Layers

1. **Edge Function unit tests** — Deno's built-in test runner for pure helpers that do not need Supabase credentials or network access. These run in CI. The first suite covers shared PostgreSQL-to-HTTP error mapping in `supabase/functions/_shared/errors_test.ts`.
2. **Database integration tests** — `multiplayer_core.sql` is a transactional test script for room creation without game selection, membership and host authorization, server-side start/finish, stale-session rejection, idempotent finish and leave-during-match reset. It ends with `ROLLBACK`, but must still be run only against a disposable/local Supabase database. CI currently parses the SQL syntax; it does not execute this script. Do not run it against Production. Extend it with isolated tests for game-specific match behavior and concurrent transactions as those test environments are established.
3. **Frontend unit tests** — add when the relevant pure logic can be tested independently of browser/Telegram state. Avoid introducing a second test framework until the initial Deno and database test layers are established.
4. **End-to-end smoke tests** — the development-only `?multiplayer-smoke=1` surface currently covers room creation, room JWT issuance, private Realtime subscription, initial snapshot and a readiness Broadcast. It is a manual environment test, not a substitute for automated tests or a multi-device match test.

## Required invariants for database integration coverage

- Only a current room member can read or mutate member-scoped state.
- Only the host can select a game, close a room or start a match.
- Room membership and game lifecycle transitions are serialized with a consistent room-first lock order.
- A stale match/session identifier cannot finish or mutate a newer room session.
- Leaving during a match follows the shared room lifecycle contract and cancels game-specific active state.
- A finished/cancelled room cleanup cascades to game-specific rows.
- Repeated requests are idempotent where the public API promises retry safety.
- Game-specific match state remains owned by the game module; Multiplayer must not query game-specific tables directly.

## Execution policy

- CI may run parser/type/unit checks on every aggregate `*-AI` branch.
- Database integration tests must use an ephemeral/local database and synthetic test identities.
- Never place Production credentials or real Telegram initData in test fixtures.
- A passing build, SQL parser, or helper unit test does not prove that the deployed Production database or multi-device Telegram flow works.

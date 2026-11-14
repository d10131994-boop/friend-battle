# Democracy Merge — AI development guide

This document describes the agreed V1 design and the implementation constraints for this game. It must be kept aligned with the code, server functions and SQL as implementation progresses.

## 1. Source of truth and current status

- `V1-SPEC.md` is the detailed, agreed product specification.
- The game is under development. Do not describe a specified feature as implemented until the corresponding client, server and persistence behavior exists and has been verified.
- Temporary character icons are numbered placeholders for levels 1–6. Do not invent final character names or artwork.
- There is no rematch feature. A subsequent match, if players choose to play again, uses the ordinary main-menu/room flow.

## 2. Game ownership

Democracy Merge owns:
- solo and game-specific multiplayer screens;
- board state, merge rules, character and obstacle sequences;
- tools, inventory, coins, shop and rewards;
- scoring, player completion, ranking and results;
- personal history, records and aggregates;
- game-specific persistence and trusted server operations.

The shared modules own their existing responsibilities:
- `src/database`: browser database transport and shared Supabase client;
- `src/multiplayer`: room, invitation, common membership, host, readiness, heartbeat and room-scoped Realtime session;
- `src/menus/MultiplayerRoomMenu.tsx`: common room creation/joining, game selection, readiness and navigation.

Do not create another Supabase client, room system, invite system or generic readiness/host implementation. Browser components must not write authoritative multiplayer state directly to game tables or common Multiplayer tables.

## 3. Existing application integration points

Current application routing is in `src/App.tsx`:
- solo game selection is in `src/menus/SoloRoomMenu.tsx`;
- multiplayer room selection and dispatch are in `src/menus/MultiplayerRoomMenu.tsx`;
- current multiplayer dispatch explicitly lists each game component.

To integrate Democracy Merge, update these shared navigation points deliberately. Add the game to the multiplayer selection only after its game-specific match screen and server contract are ready. Solo entry must route to the Democracy Merge solo screen. Update `src/menus/ai-readme.md` when these shared menu integration rules change.

The current multiplayer room menu has explicit branches for Reaction Rush, Brain Battle and NoCountIt. The shared room is passed into the game component; the game must not create or join a second room.

## 4. Multiplayer Core constraints and known behavior

Read `src/multiplayer/ai-readme.md`, `src/multiplayer/README.md`, `src/database/ai-readme.md` and `src/menus/ai-readme.md` before changing integration code.

The current public Multiplayer client service exposes room creation/selection/join/readiness/leave/close, heartbeat and room-token operations. Trusted game-server actions are invoked server-side with the per-game secret; never expose that secret to the browser.

The current canonical SQL implementation of `multiplayer_execute_action` has important leave semantics:
- `leave_room` deletes the current member;
- if the room is `playing`, it resets the room to `waiting`, clears the selected game and match timestamps, and marks remaining players not-ready;
- host transfer is already performed using earliest `joined_at` (then stable player ID);
- an empty room becomes `cancelled`.

Do not globally change this behavior without preserving existing games. Reaction Rush and Brain Battle rely on room-reset cleanup hooks. NoCountIt has a game-owned player-delete hook, but its current rule completes the match only when one active participant remains and otherwise cancels it. That is not Democracy Merge's agreed behavior, where multiple remaining players continue independently.

Democracy Merge therefore requires a narrowly scoped, server-authoritative leave/expiry contract that:
- preserves the active shared room and other players' match when one participant definitively leaves;
- removes the departed player from common room membership and transfers host if necessary;
- records the departed participant as excluded from the competition in Democracy Merge-owned match data;
- prevents the departed player from rejoining that match;
- terminates the room/match safely when no active participants remain;
- keeps the existing default leave behavior unchanged for games that do not opt into the new contract.

Do not implement this by direct browser writes or by letting the browser choose a trusted leave policy. Determine the policy from trusted server-side game configuration/authorization. Preserve the project lock order: shared room first, then game match/player rows. Keep membership changes and game-specific departure processing atomic or otherwise protected against races.

The five-minute disconnect expiry is game-specific. The shared heartbeat RPC delegates to a game-specific guard hook; the Democracy Merge migration installs the guard after creating its own tables. A late heartbeat for an active player invokes trusted final departure rather than extending the return window. A separate 30-second server Cron removes stale active players and waits for valid actions reserved before the five-minute cutoff. Completed/surrendered players keep their membership and immutable result. The common ten-minute idle-room cleanup remains unchanged.

## 5. Server authority and persistence

All multiplayer-critical behavior must be server-authoritative:
- validate Telegram initData and derive the acting user on the server;
- validate current membership, selected game, match/session identity and legal action;
- generate shared character and obstacle sequences on the server;
- calculate merges, cascades, score, tools, coins, rewards, completion and ranking on the server;
- use database/server time for the 30-minute deadline and five-minute disconnect window;
- make mutations atomic and retry-safe;
- bind every action to the exact room and match/session ID so stale requests cannot mutate a later match.

The server returns only permitted opponent summary fields. Detailed statistics and history are private to the requesting player.

Solo gameplay uses game-owned local persistence and versioned state. The solo timer is based on an absolute deadline so it continues while the app is closed or in the background. Follow the detailed save/restore rules in `V1-SPEC.md`.

Use the shared `src/database` facade for browser transport. Do not import the raw Supabase client into client game code. Trusted Edge Functions may use their server-side Supabase client as required by the established project pattern.

## 6. Database and infrastructure discipline

Before writing SQL, inspect the current game-owned SQL patterns, `supabase/MIGRATIONS.md`, the actual deployed schema and the current migration history. The repository's SQL directory is a set of implementation patches/snapshots, not a fully reproducible migration chain.

Any SQL or Supabase infrastructure change requires explicit user approval before applying it to an external/Production environment. It is acceptable to prepare code, SQL and isolated-database tests in the repository without changing Production. Never reconstruct historical migrations or apply a competing definition of `public.multiplayer_execute_action`.

Register the game in `public.common_multiplayer_game_rules` with min/max player limits 2 and 4 and enabled status through the approved database workflow. Do not claim the game is available in the live catalog until the registration is actually deployed.

The first multiplayer schema patch is `supabase/sql/democracy_merge_multiplayer.sql` with matching migration `20261108113000_democracy_merge_multiplayer.sql`. It creates private match/player state, player history and independent aggregate tables, trusted start/snapshot/action/history RPCs, game-owned departure and room-cancellation triggers, five-minute disconnect expiry and 30-minute deadline finalization jobs. The matching shared Multiplayer patch is `20261108100000_multiplayer_active_match_departure.sql`; apply both migrations together before deploying the updated Edge Functions. The trusted `democracy_merge_reserve_action` operation records a short-lived server-side reservation before state calculation; commit consumes the reservation, and the deadline/disconnect finalizers wait for eligible in-flight actions. The Edge Function verifies Telegram identity, generates shared sequences, processes placements/tools/purchases/surrender, records history and aggregates, and handles final departure/results return. The client has solo and multiplayer screens, history/detail/delete flows, aggregate stats, shared animation settings and basic placement/merge/obstacle animations. Both migrations are pending; no Production schema, Cron or live catalog changes have been made. Isolated database execution and real multi-device verification remain mandatory.

## 7. Pure game logic currently implemented

- `logic/gameEngine.ts` contains the pure 6×6 board model, orthogonal connected-group detection, 3+ merge and chain resolution, score calculation, level-6 repeat scoring, and injectable weighted character generation.
- `logic/tools.ts` contains pure saw, storage, swap, replace-current-character, inventory-cap and board-cell escape checks.
- `logic/events.ts` contains shop pricing, per-merge independent money-bag/tool reward rolls, shared 5% obstacle event generation, player-specific free-cell obstacle placement and silent reward-cap handling. V1 currently has one numbered placeholder character per level, so replace-current-character consumes the tool but keeps the same level identity until level-specific character variants are supplied.
- Deno unit tests for these modules live in `supabase/functions/_shared/democracy_merge_engine_test.ts`, `democracy_merge_tools_test.ts` and `democracy_merge_events_test.ts`; the application build does not include Deno test files.

The pure rules modules are used by both the solo engine and trusted Democracy Merge Edge Function. Solo checkpoints are stored locally; multiplayer state, actions, rewards, deadlines, history and aggregates are persisted through trusted server-side SQL transactions. The SQL migration remains pending and database integration tests are not executed by CI.

## 8. Verification requirements

Test independently:
- pure game engine rules, merge groups, cascades, scoring and max-level behavior;
- tool effects, inventory caps, shop, coin changes and rewards;
- deterministic/shared sequence generation and obstacle placement;
- solo save/restore, absolute timer and unfinished-game handling;
- multiplayer authentication, membership and server-authoritative actions;
- 2–4 players, readiness, synchronized start and concurrent independent boards;
- reconnect within five minutes, expiry after five minutes, stale requests and final departure;
- 30-minute deadline, surrender, completion, ranking and result privacy;
- history, records, aggregates and deletion behavior.

Use only an isolated local/test database for SQL integration scripts. Report source checks, unit tests, build/lint, SQL parsing, isolated database tests, deployment and real multi-device Telegram tests separately. A successful build does not prove live multiplayer behavior.

## 9. V2 changes (override V1 rules where they conflict)

- A swap can trigger merges at either swapped destination; resolve cascades and award score through the same pure engine on client and server.
- Award the established per-level merge score **for each disappearing character cell** (a merged group of N clears N-1 cells). A chain scores every stage.
- Solo merges may progress to level 10; multiplayer stays capped at level 6. Solo character generation still spawns only levels 1–6. Solo local save validation accepts levels up to 10.
- Multiplayer match deadline is five minutes after the five-second countdown. The separate five-minute disconnect grace period is unchanged.
- Final ranking includes every original match participant, including departed players, using last committed score and then highest level; tied scores and levels share a rank. Leaving does not award an automatic loss or remaining-player win. Results, personal history and aggregates must include departed players.
- Once at most one active participant remains, the match completes and saves all results; a remaining active player is marked completed with their current score.
- The multiplayer personal-results screen offers return to the room menu. Solo results return to the application menu because solo has no multiplayer room.
- The migration `supabase/migrations/20261108160000_democracy_merge_v2.sql` is a **staged, not deployed** change. Do not apply it or deploy updated Edge Functions to Production without explicit approval. Verify schema, SQL tests and behavior in an isolated environment first.

The earlier sections document the original V1 architecture and may describe obsolete V1 values (30-minute multiplayer duration, excluded leavers, six solo levels); this section supersedes those values for V2.

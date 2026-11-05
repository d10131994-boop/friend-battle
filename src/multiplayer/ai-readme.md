# Multiplayer Core — AI integration guide

This document describes the Multiplayer module for AI-assisted development. It complements the human-oriented `README.md`; it does not replace it. The implementation and SQL currently selected for deployment remain the source of truth for what actually works. Where the repository contains conflicting SQL implementations, the conflict is called out explicitly below.

## 1. Responsibility boundaries

`src/multiplayer` is the game-agnostic client core for:
- room creation and lookup;
- invite-code joining;
- player membership, readiness and host state;
- room heartbeat and room-scoped Realtime session;
- normalized room snapshots and room lifecycle API.

A game module owns its UI, game rules, match-specific state, actions, scoring, winner calculation, results and game-specific persistence. Trusted game-server code may invoke Multiplayer's `start_game` / `finish_game` actions to coordinate the shared room lifecycle.

Database access from this module goes through `src/database`. Do not import the raw Supabase client into Multiplayer or a game module for these operations.

## 2. Public TypeScript surface

The module entrypoint is `src/multiplayer/index.ts`; it re-exports:
- `types.ts`
- `roomService.ts`
- `inviteService.ts`
- `playerService.ts`
- `databaseAdapter.ts`
- `roomWatcher.ts`
- `roomSession.ts`

Important types:
- `MultiplayerAuth`: `{ initData: string }`. The value is Telegram Web App initData and is forwarded unchanged to the server.
- `MultiplayerRoom`: `roomId`, nullable `gameId`, `inviteCode`, `status`, `players`, nullable `maxPlayers`, and lifecycle timestamps.
- `MultiplayerPlayer`: `userId`, `displayName`, `isReady`, `isHost`, `joinedAt`, `lastSeenAt`, `wins`, `matchesPlayed`.
- `MultiplayerRoomStatus`: `waiting | starting | playing | finished | cancelled`.
- `MultiplayerService`: `createRoom`, `selectGame`, `joinRoom`, `getRoom`, `setReady`, `leaveRoom`, `closeRoom`, `heartbeat`, `getRoomToken`.

The adapter is created with `createDatabaseMultiplayerAdapter({ functionName: 'multiplayer' })`. Its action names can be overridden through the optional `actions` map. Service factories wrap adapter failures in `MultiplayerError` with a user-facing message and retain the original error in `cause`.

The current client API does not expose `start_game` or `finish_game`. Those are trusted game-server operations, not player actions.

## 3. Player authentication and server boundary

The client sends `initData` to the `multiplayer` Supabase Edge Function. The function verifies Telegram's HMAC signature using the server-side bot token, checks the auth timestamp (up to one hour old; no more than 30 seconds in the future), and derives the acting Telegram user ID and display name from the verified payload.

Never accept a Telegram ID, host flag, membership, readiness, room status, score or winner supplied by the browser as authoritative. The server derives the player identity and the SQL action function checks membership and permissions.

The Edge Function calls `public.multiplayer_execute_action` through a Supabase client configured with the service-role key. The SQL function is revoked from `PUBLIC`, `anon` and `authenticated`, and executable by `service_role`. Do not expose the service-role key to a browser or Telegram client.

Trusted game-server actions use a separate per-game secret in the `x-multiplayer-game-server-secret` header. The Edge Function checks the supplied `gameId` against `MULTIPLAYER_GAME_SERVER_SECRETS` before calling SQL as the internal `__game_server__` identity. The secret belongs only in that game's trusted server environment. Do not add it to frontend code, client environment variables or source control.

## 4. Room and match lifecycle

### Status values in the implementation

The TypeScript parser accepts exactly:
- `waiting`: room is in its waiting/menu state;
- `starting`: accepted by the model and heartbeat/token checks, but no transition to this state was found in the reviewed lifecycle SQL;
- `playing`: a match is active;
- `finished`: the current match ended; the room can be reused;
- `cancelled`: terminal room state.

The agreed product vocabulary may call the waiting state “lobby”, but the current wire/database value is `waiting`. Do not send `lobby` to the existing API unless the implementation is deliberately changed.

### Current API operations

- `createRoom(auth, { maxPlayers? })`: creates a room and inserts the creator as host. The TypeScript params do not contain `gameId`.
- `selectGame(auth, { roomId, gameId })`: public client contract and Edge Function action exist. Intended permission is host-only; the earlier universal-lobby SQL implements host-only selection of an enabled game while the room is `waiting` or `finished`. **The later `multiplayer_game_lifecycle.sql` replacement of the action function does not implement `select_game`; against that function the request reaches “Unknown multiplayer action”.**
- `joinRoom(auth, { inviteCode })`: invite code is normalized client-side (whitespace removed, uppercase) and sent to the server. The SQL lowercases the code for lookup. Joining is intended for `waiting` or `finished` rooms; existing members can reconnect even if the room is full.
- `getRoom(auth, { roomId })`: returns the canonical room snapshot to an existing member.
- `setReady(auth, { roomId, isReady })`: updates the current member's readiness. The reviewed lifecycle SQL permits this in `waiting` or `finished`.
- `leaveRoom(auth, { roomId })`: removes the current member. The lifecycle SQL transfers host to the remaining member with the earliest `joined_at` (then player ID) when the host leaves. See the mid-match discrepancy below.
- `closeRoom(auth, { roomId })`: host-only cancellation in the reviewed lifecycle SQL.
- `heartbeat(auth, { roomId })`: updates server-side `last_seen_at` and returns the server timestamp.
- `getRoomToken(auth, { roomId })`: issues a room-scoped JWT for private Realtime.

### Trusted match operations

`start_game` and `finish_game` are accepted by the Edge Function only after per-game server-secret validation. SQL additionally checks the internal game-server identity and that the requested `gameId` matches the room's selected game.

The lifecycle SQL starts a match only from `waiting` or `finished`, requires every current player to be ready and to have a heartbeat within the preceding 90 seconds, sets `playing` and a server-generated `startedAt`, then consumes readiness. `finish_game` must pass that exact `startedAt`. This prevents an old delayed finish request from finishing a newer match in the same room. A repeated finish for the same already-finished session is idempotent.

Finishing a match sets the room to `finished`; it does not destroy the room. The game module owns result presentation and decides when to return its UI to the room menu. The same room can be used for another match after players ready again, provided the selected game's lifecycle integration supports it.

## 5. Realtime and room sessions

Use `createMultiplayerRoomSession` when a screen needs a managed room connection. It owns:
- the room JWT;
- a heartbeat immediately after startup and every 30 seconds;
- token expiry checks every 30 seconds, refreshing within five minutes of expiry;
- a `createRoomWatcher` subscription;
- cleanup of timers, visibility listener and watcher on stop.

Only one room session can be active at a time on the shared Realtime client. Tokens are cached in memory by room ID; they are not persisted to browser storage. Heartbeats are skipped while the document is hidden. On visibility return, the session sends a heartbeat and checks the token. A `cancelled` room snapshot stops the session. A `finished` snapshot does not stop it, because the room can be reused.

The Edge Function issues an ES256 JWT with `role: authenticated`, `sub`, `telegram_id` and `room_id` claims, a one-hour lifetime and a configured key ID. Install it using `database.realtime.setAuth(accessToken)` before subscribing to the private topic `room:<roomId>`.

`createRoomWatcher` listens for private Broadcast invalidation events. It does not merge event payloads into local room state: it calls the supplied `getRoom(roomId)` and delivers the canonical snapshot. A successful subscription triggers an initial fetch. Bursts are coalesced; a stopped watcher ignores late results.

The watcher currently subscribes to:
`room_updated`, `player_joined`, `player_updated`, `player_left`, `room_finished`, `match_started`, `round_finished`, `match_finished`.
The reviewed Multiplayer Edge Function explicitly broadcasts only `room_updated`, `player_joined`, `player_updated`, `player_left` and `room_finished` for its public and game-server actions. Do not assume the additional game event names are emitted by this function; game-specific broadcasters may have their own behavior.

## 6. Error handling

The Edge Function maps known SQL error codes to HTTP responses:
- `P0002` → 404 room not found;
- `42501` → 403 permission/membership failure;
- `23505` → 409 duplicate membership;
- `55000` and `54000` → 409 lifecycle/capacity conflict;
- `22023` → 400 invalid input/action;
- other SQL errors → generic 500.

The database adapter validates the Edge Function response before exposing it as a `MultiplayerRoom`, heartbeat result or room token. It rejects unknown statuses, malformed timestamps, invalid player fields and malformed token responses. Do not bypass these parsers or cast untrusted function responses directly to domain types.

## 7. Intended architecture vs repository discrepancies

The following are known inconsistencies in the checked-in SQL/API. This documentation task does not fix them. Do not claim the affected flows work end-to-end until a separate implementation task resolves and verifies them.

### A. Create room without a selected game

**Intended contract:** create a room before selecting a game; the room's `gameId` is initially `null`. The host selects a supported game later through `select_game`.

**Repository evidence:**
- `CreateRoomParams` exposes only optional `maxPlayers`.
- `databaseAdapter.ts` sends `create_room` without `gameId`.
- `multiplayer/index.ts` and the Edge Function expose `select_game`.
- `universal_lobby_reaction_rush.sql` implements no-game creation and later game selection.
- The later `multiplayer_game_lifecycle.sql` implementation requires non-empty `gameId` during `create_room`, and does not implement `select_game`.

Therefore the public TypeScript flow does not match that later SQL function and cannot be assumed to work end-to-end against it.

### B. Room capacity and game rules

**Intended contract:** a room has a maximum capacity of four players; each enabled game registers its own minimum and maximum player counts in `common_multiplayer_game_rules`. Multiplayer should enforce the selected game's registered limits when starting a match.

**Repository evidence:**
- `universal_lobby_reaction_rush.sql` sets the room capacity constraint to 2–4, defaults capacity to 4, creates `common_multiplayer_game_rules`, and checks registered min/max values when starting a match.
- Game SQL files register their game-specific player limits in that table.
- The later `multiplayer_game_lifecycle.sql` checks `maxPlayers` only against 1–100 at room creation and does not consult `common_multiplayer_game_rules` in its `start_game` branch.

Do not describe the 1–100 validation as the intended product rule. Equally, do not claim the four-player/game-specific constraints are enforced by the later replacement RPC without checking which SQL implementation is actually deployed.

### C. Leaving during a match

**Intended product behavior:** if a player leaves during a match, the current match is interrupted, the player is removed, and remaining players return to the waiting/lobby state; if no players remain, the room is cancelled.

**Repository evidence:**
- `universal_lobby_reaction_rush.sql` resets a playing room to `waiting`, clears `game_id` and match timestamps, and resets remaining players' readiness.
- The later `multiplayer_game_lifecycle.sql` `leave_room` branch removes the player and may transfer host, but does not reset a playing room to `waiting` or cancel the active game-specific match. It only cancels the room when no players remain.

This later implementation does not satisfy the agreed mid-match leave behavior. Do not work around it inside a game module; it needs a dedicated Multiplayer/SQL task.

### D. Conflicting SQL files

`universal_lobby_reaction_rush.sql` and `multiplayer_game_lifecycle.sql` both define `public.multiplayer_execute_action` with materially different behavior. SQL execution order determines which definition is active. The repository states that `supabase/sql` is currently a set of explicit SQL patches rather than a reproducible migration history. Before changing or applying Multiplayer SQL, inspect the actual deployed database definition and confirm the intended patch order. Do not infer the live Supabase state from repository file names alone.

## 8. Development and verification guidance

- Read this document, `README.md`, the exported TypeScript API and the SQL/Edge Function implementation before changing Multiplayer integrations.
- For a new game, keep game-specific rules and match state in that game. Use Multiplayer for room membership, readiness, host and shared room lifecycle.
- Use server-side game operations for critical match transitions. Never ship game-server secrets to clients.
- Use the room snapshot as canonical state. Treat Realtime messages as invalidation signals and fetch a fresh snapshot after subscription/reconnect.
- Keep operations retry-safe and do not assume a Broadcast was delivered just because a database mutation succeeded.
- `src/multiplayer/DevSmokeTest.tsx` is a temporary development-only smoke surface gated by Vite development mode and `?multiplayer-smoke=1`. It exercises room creation, token issuance, private Realtime subscription, initial snapshot and a readiness Broadcast. It is not a complete multiplayer integration test and does not verify multi-device joining, match start/finish, leave semantics or reconnect under real network failure.
- Do not claim live Supabase integration, deployment, or end-to-end behavior has been verified unless the corresponding test was actually run against the target environment.

## 9. Change discipline

When changing Multiplayer's public API, lifecycle, auth, Realtime, token format, SQL contract or integration requirements:
1. inspect the current implementation and the deployed SQL/function state where relevant;
2. identify affected game modules and their integration assumptions;
3. update this `ai-readme.md` in the same task;
4. update the human README when its user-facing guidance becomes stale;
5. report source-level checks separately from build/lint, database deployment and real integration tests.

Do not silently reconcile conflicting SQL by choosing whichever version appears more convenient. Record the discrepancy and resolve it in a separately scoped change.

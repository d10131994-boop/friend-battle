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
- `selectGame(auth, { roomId, gameId })`: public client contract and Edge Function action exist. The canonical deployed `multiplayer_execute_action` in `universal_lobby_reaction_rush.sql` implements host-only selection of an enabled game while the room is `waiting` or `finished`.
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

## 7. Canonical SQL implementation and maintenance functions

The canonical shared room lifecycle implementation is `supabase/sql/universal_lobby_reaction_rush.sql`. It defines `public.multiplayer_execute_action` and the shared room snapshot, including:
- creating a room before a game is selected and later selecting an enabled game;
- room capacity of 2–4 and game-specific min/max player rules;
- host/readiness checks when starting a match;
- returning remaining players to the waiting room and clearing the interrupted Reaction Rush match when someone leaves during play;
- room membership checks for member actions and server-only game lifecycle actions.

The deployed Production definition of `public.multiplayer_execute_action` was inspected and matches this canonical implementation. Do not apply an alternate definition of this RPC over it.

`supabase/sql/multiplayer_room_maintenance.sql` contains separate room-maintenance helpers and deliberately does not redefine `multiplayer_execute_action`:
- `multiplayer_cancel_idle_rooms()` is used by the active Production Cron job `multiplayer-room-idle-cleanup`, which runs every 30 seconds and cancels rooms with no player heartbeat for 10 minutes. Keep this function and its Cron dependency in sync.
- `multiplayer_record_heartbeat(room_id, user_id)` is a legacy standalone helper. The current application heartbeat flow uses the `heartbeat` action of `multiplayer_execute_action`; no current repository call site invokes the standalone helper. Do not introduce a new caller without reviewing its membership and locking behavior.

The former `multiplayer_game_lifecycle.sql` file was removed because its alternate `multiplayer_execute_action` definition conflicted with the canonical deployed RPC. Its two maintenance functions were preserved in `multiplayer_room_maintenance.sql`. Never restore the old file or apply a competing definition of the shared action RPC.

The SQL directory contains explicit SQL patches and snapshots, not a fully reproducible migration chain. For any SQL change, inspect the actual deployed database definition and migration history first; repository filenames alone do not prove what is live.

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


## 10. Shared room UI ownership

The application-level room experience is implemented in `src/menus/MultiplayerRoomMenu.tsx`, not inside individual game modules. The menus layer owns room creation/joining, invite links, game selection, common readiness, host-only start controls, the room session, player roster and shared room statistics. It uses the public Multiplayer adapter and room-session APIs described above.

Game modules receive an already-created `MultiplayerRoom` and own only their match-specific UI/actions/results. Do not reintroduce room creation, invite-code parsing, common readiness, host transfer or generic room navigation inside a game screen.

The menu automatically marks the host ready when a newly created room or a finished room returns to the waiting state, because the agreed UI does not show the host a Ready button while the lifecycle start operation still requires every member to be ready. This is client orchestration only; the server remains authoritative.

The current Telegram Mini App share flow uses a single invite URL through `https://t.me/share/url`. Telegram's share sheet does not return a list of chosen recipients to the Mini App, so the client cannot show a truthful live count of selected contacts. The room snapshot and server-side capacity remain the source for actual participant counts. The shared invite deep-link prefix is `fb_`; the application continues to accept legacy `rr_` and `bb_` prefixes for existing links.

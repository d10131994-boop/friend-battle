# Multiplayer module

The Multiplayer Core contains game-agnostic room, invite, and player contracts.
It does not depend on a particular game's UI or game logic. Database access
goes through the public `src/database` API.

## Core room contract

A room is the shared multiplayer session for one game. It contains a stable
room UUID, game identifier, invitation code, lifecycle status, player
snapshots, capacity, and lifecycle timestamps. The public TypeScript model
uses camelCase. The server maps its storage representation to this normalized
contract. A room snapshot returned by the trusted Multiplayer API is the
source of truth.

## Server API contract

The `multiplayer` Supabase Edge Function is deployed. Public player actions
authenticate Telegram `initData`; the trusted game-server actions use a
separate per-game secret. Supabase gateway JWT verification is disabled for
this function because it performs these checks itself. The server derives
the acting Telegram user for player actions and enforces membership and
lifecycle rules; it never trusts a client-supplied Telegram ID.

Public client actions:

| Action | Input | Result |
| --- | --- | --- |
| `create_room` | optional `maxPlayers` | Room snapshot with `gameId: null` |
| `select_game` | `roomId`, `gameId` | Room snapshot; host-only |
| `join_room` | `inviteCode` | Room snapshot |
| `get_room` | `roomId` | Room snapshot |
| `set_ready` | `roomId`, `isReady` | Room snapshot |
| `leave_room` | `roomId` | Room snapshot after leaving; cancelled state if last member |
| `close_room` | `roomId` | Room snapshot; host-only |
| `heartbeat` | `roomId` | Acknowledgement and server time |
| `get_room_token` | `roomId` | `roomId`, `accessToken`, `expiresAt` |

The server returns normalized room snapshots with `roomId`, `gameId`,
`inviteCode`, `status`, `players`, `maxPlayers`, `createdAt`,
`startedAt`, and `finishedAt`. Each player includes `userId`,
`displayName`, `isReady`, `isHost`, `joinedAt`, and `lastSeenAt`.

### Trusted game-server actions

`start_game` and `finish_game` are deliberately not part of the
Telegram-authenticated client API and are not exposed by
`MultiplayerService`. A game module must call them from its trusted
server-side component. A browser or Telegram client must never receive the
game-server secret.

The server calls the same Edge Function endpoint
`POST /functions/v1/multiplayer` with the
`x-multiplayer-game-server-secret` header. For example, a server-side
Deno game module can start a session and later finish that exact session:

```ts
const endpoint = `${Deno.env.get('SUPABASE_URL')}/functions/v1/multiplayer`
const secrets = JSON.parse(Deno.env.get('MULTIPLAYER_GAME_SERVER_SECRETS')!)
const gameId = 'brain-battle'
const secret = secrets[gameId] as string

const startResponse = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
    'x-multiplayer-game-server-secret': secret,
  },
  body: JSON.stringify({ action: 'start_game', roomId, gameId }),
})
if (!startResponse.ok) throw new Error('Could not start the game')
const startedRoom = await startResponse.json()

// After game-specific result presentation (for example, 10 seconds):
const finishResponse = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
    'x-multiplayer-game-server-secret': secret,
  },
  body: JSON.stringify({
    action: 'finish_game',
    roomId,
    gameId,
    startedAt: startedRoom.startedAt,
  }),
})
if (!finishResponse.ok) throw new Error('Could not finish the game')
```


| Action | Input | Result |
| --- | --- | --- |
| `start_game` | `roomId`, `gameId` | Room snapshot with `status: playing` and a new `startedAt` |
| `finish_game` | `roomId`, `gameId`, `startedAt` from the matching `start_game` response | Room snapshot with `status: finished` and `finishedAt` |

Secrets are configured as a JSON object in
`MULTIPLAYER_GAME_SERVER_SECRETS` in the Multiplayer Edge Function, keyed by
game ID (for example, `{"brain-battle":"<secret>" }`). Each trusted
game-server environment receives only its own game's secret. Every secret
must be a high-entropy value of at least 32 characters, kept out of source
control and all client bundles. The request's `gameId` must match the room's
stored `game_id`; a game server cannot start or finish another game's room.
These actions are also protected by the database function's
`service_role`-only execute permission.

`start_game` succeeds only while the room is `waiting` or `finished`, and
only when every current player is ready and has sent a heartbeat within the
last 90 seconds. The returned `startedAt` identifies that particular game
session. The game server must pass that exact value to `finish_game`; this
prevents a delayed finish request from an older game from ending a newer game
in the same room. Repeating `finish_game` for the same already-finished
session is safe and idempotent.

The game module owns game rules and result presentation. For example, it can
show the final result for 10 seconds and then call `finish_game` from its
server-side component. Multiplayer only changes the room lifecycle and
notifies participants; it does not decide who won or when the result screen
should disappear. The host has no special permission to finish a game.

`finished` means the current game session ended, not that the room was
destroyed. Players can return to the room menu, change readiness, invite
players, and start another session in the same room. `cancelled` is the
terminal room state. Leaving by the last player, host closure, or idle
cleanup can cancel a room even after a game session has finished.

## Room lifecycle and reconnect

- Creating a room inserts the creator as its first player and host.
- Joining by invite code is allowed while the room is `waiting` or
  `finished` and has capacity. Existing members can reconnect in either
  state even when the room is at capacity.
- A player who explicitly calls `leave_room` is removed immediately. If the room is in `playing`, the room returns to `waiting`, the selected game and match timestamps are cleared, and remaining players become not-ready. Each game module owns cleanup of its interrupted match state through its own database lifecycle hook; Multiplayer does not directly access game match tables.
- If the host explicitly leaves and other players remain, the host role is
  transferred to the remaining player with the earliest `joined_at`. A stable
  player ID breaks timestamp ties.
- If the last player explicitly leaves, the room becomes `cancelled`,
  including when the last game session had finished.
- The host may call `close_room` to cancel the room, including after a game
  session has finished. The host cannot call `finish_game`.
- A network disconnect is not an explicit leave. The player row remains, and
  the host role is not transferred merely because the host lost connectivity.
- The client sends a heartbeat every 30 seconds while the room is in
  `waiting`, `starting`, `playing`, or `finished` and the app is in the
  foreground. The server updates that member's
  `last_seen_at`; clients never write this field directly.
- A player is considered disconnected for presence display after 90 seconds
  without a heartbeat. The player row is retained so that the same player can
  reconnect.
- If no room member has sent a heartbeat for 10 minutes, a server-side cleanup
  task changes an active room (`waiting`, `starting`, `playing`, or
  `finished`) to `cancelled`. The cleanup runs every 30 seconds, so the effective timeout
  may exceed 10 minutes by at most 30 seconds. A heartbeat received before
  cleanup prevents cancellation.
- Reconnection is allowed only for an existing member while the room is in
  `waiting`, `starting`, `playing`, or `finished`. The server checks membership and
  room status; it does not inspect whether other players' JWTs are active.

The heartbeat timestamp is stored per player as `last_seen_at`. The cleanup
must serialize with heartbeat updates for the same room so a concurrent
heartbeat cannot be lost at the cancellation boundary. An empty room left by
an explicit `leave_room` is cancelled immediately; the 10-minute timeout is
for rooms whose players disappeared without explicitly leaving.

## Database integration

Use `createDatabaseMultiplayerAdapter` to connect the core services to the
shared server endpoint through `database.invokeFunction`:

```ts
import {
  createDatabaseMultiplayerAdapter,
  createRoomService,
  createInviteService,
  createPlayerService,
} from './multiplayer'

const adapter = createDatabaseMultiplayerAdapter({
  functionName: 'multiplayer',
})

export const rooms = createRoomService(adapter)
export const invites = createInviteService(adapter)
export const players = createPlayerService(adapter)
```

## Realtime: private Broadcast

Multiplayer uses Supabase Realtime Broadcast, not Postgres Changes, for room
notifications. Each room has one private topic: `room:<roomId>`.

The trusted server authorizes a member and issues a short-lived ES256 JWT
containing `role: authenticated`, `telegram_id`, and `room_id`. Its lifetime
is one hour. The JWT header's `kid` identifies the imported ES256 signing key.
The client refreshes five minutes before expiry only while the room session is
active. Tokens are cached in memory by room ID and verified Telegram user ID,
and the cache entry is cleared when the room session stops. Only
one room is active at a time on the shared Supabase client. Pausing or closing
the app stops refresh; on resume, the client checks expiry.

The server issues or refreshes a token only if the caller's Telegram identity
matches an existing room member and the room status is `waiting`,
`starting`, `playing`, or `finished`. It does not need to inspect other members' token
states. An already-issued token may remain usable until its one-hour expiry
after a player leaves or a room closes; immediate JWT revocation is not part
of this design.

Install the token before opening the private channel:

```ts
import { database } from '../database'

database.realtime.setAuth(roomAccessToken)
```

The room watcher subscribes to server-published invalidation events and
reloads the complete room snapshot through the trusted Multiplayer API:

```ts
import { createRoomWatcher } from './multiplayer'

const watcher = createRoomWatcher({
  roomId,
  getRoom: (id) => rooms.get({ initData }, { roomId: id }),
  onRoom: setRoom,
  onStatus: setRealtimeStatus,
  onError: reportRoomError,
})

// When leaving the room:
await watcher.stop()
```

Supported events: `room_updated`, `player_joined`, `player_updated`,
`player_left`, and `room_finished`. A successful `start_game` broadcasts
`room_updated`; a successful `finish_game` broadcasts `room_finished`. Payloads are invalidation signals only;
the client never merges them into the canonical room model. The deployed
function sends invalidation events after successful room mutations. A
successful subscription triggers an initial snapshot fetch and a fresh fetch
after each reconnect. Concurrent event bursts are coalesced, and late
responses cannot update a stopped watcher.

## Server and Supabase prerequisites

The canonical shared room lifecycle SQL is
`supabase/sql/universal_lobby_reaction_rush.sql`. The AI branch now moves
Reaction Rush interrupted-match cleanup into its own hook in
`supabase/sql/reaction_rush_room_lifecycle.sql`; Brain Battle already owns its
cleanup hook in `supabase/sql/brain_battle_multiplayer.sql`. The updated shared
Multiplayer action RPC no longer directly accesses game-specific match tables.
This refactor is not yet deployed: Production still runs the previous RPC until
the AI-branch SQL changes are promoted and applied together. The Production
`public.multiplayer_execute_action` remains authoritative for room creation,
game selection, readiness, membership, heartbeat and shared room transitions.

Room-maintenance helpers are kept separately in
`supabase/sql/multiplayer_room_maintenance.sql`. In particular,
`multiplayer_cancel_idle_rooms()` is called by the active Production Cron
job `multiplayer-room-idle-cleanup` every 30 seconds. Do not remove or rename
that function without updating the Cron job. The old
`multiplayer_game_lifecycle.sql` patch was removed because it redefined the
shared action RPC with incompatible behavior; do not restore or apply it.

The Edge Function validates Telegram `initData` for player actions and the
separate game-server secret for `start_game` / `finish_game`. It calls a
single server-only PostgreSQL action function. The RPC execute permission is
restricted to `service_role`; browser roles cannot call it directly. Room mutations are serialized by
locking the room row, including heartbeat updates, explicit leave, host
transfer, and idle cleanup. The browser has no direct table privileges and
cannot publish authoritative room events.

The private JWK in the Edge Function secret
`MULTIPLAYER_JWT_PRIVATE_JWK` was manually checked against the public
parameters of the imported Supabase ES256 key. That key has since been
rotated to `Current`; the previous key remains `Previously used` and has
not been revoked. The deployed token issuer uses that key's `kid`.

The key rotation is complete, but end-to-end acceptance of a freshly issued
JWT by Supabase Realtime has not yet been verified with a live Telegram
session. Treat that as an outstanding integration smoke test, not as a
confirmed working path.

The JWT `room_id` claim must match the UUID in `room:<roomId>`. Realtime RLS
policies authorize receipt only for the matching room topic and require a
`telegram_id` claim. The client joins with a private channel. Never grant
broad access to all `realtime.messages` rows.

## Scope

This module remains game-agnostic and contains no game-specific scoring
rules. Legacy game integrations and old tables will be replaced during the
later Games rework; data migration is not required for this release.

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

The shared `multiplayer` Edge Function accepts an action and Telegram
`initData`. The server validates the Telegram signature, derives the acting
Telegram user, and enforces membership and lifecycle rules. It must never
trust a client-supplied Telegram ID.

Public client actions:

| Action | Input | Result |
| --- | --- | --- |
| `create_room` | `gameId`, optional `maxPlayers` | Room snapshot |
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

Normal game completion changes the room to `finished` through trusted
game-server code, not a client-authorized action. `finished` is terminal:
leaving or inactivity must never change it to `cancelled`.

## Room lifecycle and reconnect

- Creating a room inserts the creator as its first player and host.
- Joining by invite code is allowed only while the room is `waiting` and has
  capacity.
- A player who explicitly calls `leave_room` is removed immediately.
- If the host explicitly leaves and other players remain, the host role is
  transferred to the remaining player with the earliest `joined_at`. A stable
  player ID breaks timestamp ties.
- If the last player explicitly leaves, the room becomes `cancelled`.
- The host may call `close_room` to cancel an active room. A finished room
  remains `finished`.
- A network disconnect is not an explicit leave. The player row remains, and
  the host role is not transferred merely because the host lost connectivity.
- The client sends a heartbeat every 30 seconds while the room is active and
  the app is in the foreground. The server updates that member's
  `last_seen_at`; clients never write this field directly.
- A player is considered disconnected for presence display after 90 seconds
  without a heartbeat. The player row is retained so that the same player can
  reconnect.
- If no room member has sent a heartbeat for 10 minutes, a server-side cleanup
  task changes an active room (`waiting`, `starting`, or `playing`) to
  `cancelled`. The cleanup runs every 30 seconds, so the effective timeout
  may exceed 10 minutes by at most 30 seconds. A heartbeat received before
  cleanup prevents cancellation.
- Reconnection is allowed only for an existing member while the room is in
  `waiting`, `starting`, or `playing`. The server checks membership and
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
is one hour. The client refreshes five minutes before expiry only while the
room session is active. Tokens are cached in memory by room ID: returning to
a room reuses its token if it is still valid; otherwise the client requests a
new token. Only one room is active at a time on the shared Supabase client.
Pausing or closing the app stops refresh; on resume, the client checks expiry.

The server issues or refreshes a token only if the caller's Telegram identity
matches an existing room member and the room status is `waiting`,
`starting`, or `playing`. It does not need to inspect other members' token
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
`player_left`, and `room_finished`. Payloads are invalidation signals only;
the client never merges them into the canonical room model. A successful
subscription triggers an initial snapshot fetch and a fresh fetch after each
reconnect. Concurrent event bursts are coalesced, and late responses cannot
update a stopped watcher.

## Server and Supabase prerequisites

The browser must not publish authoritative room events. Trusted server code
publishes events only after a successful state change. The server verifies
Telegram `initData` and room membership before issuing a token, and does not
issue tokens for finished or cancelled rooms.

The signing key is prepared as a Standby key and the matching private JWK is
stored in the Edge Function secret `MULTIPLAYER_JWT_PRIVATE_JWK`; it has not
been activated. Until the key is Current, the token issuer is deployed, and
private-channel RLS policies are installed, private Broadcast authorization
is not operational. Do not activate or deploy these Supabase changes without
the agreed rollout step.

The JWT `room_id` claim must match the UUID in `room:<roomId>`. Realtime RLS
policies must authorize only the corresponding room member. Never grant broad
access to all `realtime.messages` rows.

## Scope

This module remains game-agnostic and contains no game-specific scoring
rules. Legacy game integrations and old tables will be replaced during the
later Games rework; data migration is not required for this release.

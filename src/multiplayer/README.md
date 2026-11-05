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

The server validates Telegram `initData`, derives the acting Telegram user,
and enforces room membership and lifecycle rules. It must never trust a
client-supplied Telegram ID.

## Realtime: private Broadcast

Multiplayer uses Supabase Realtime Broadcast, not Postgres Changes, for room
notifications. Each room has one private topic: `room:<roomId>`.

The trusted server authorizes a member and issues a short-lived ES256 JWT
containing `role: authenticated`, `telegram_id`, and `room_id`. Its lifetime
is one hour. The client refreshes five minutes before expiry only while the
room session is active. A reconnect to the same room reuses a valid token;
switching rooms requests a new room-scoped token. Pausing or closing the app
stops refresh; on resume, the client checks expiry.

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

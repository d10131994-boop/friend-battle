# Multiplayer module

The Multiplayer Core contains game-agnostic room, invite, and player contracts.
It does not import the Supabase client and does not define PostgreSQL tables.

## Database integration

Use `createDatabaseMultiplayerAdapter` to connect the core service adapters to
the public `src/database` API:

```ts
import {
  createDatabaseMultiplayerAdapter,
  createRoomService,
  createInviteService,
  createPlayerService,
} from './multiplayer'

const adapter = createDatabaseMultiplayerAdapter({
  functionName: 'YOUR_SHARED_MULTIPLAYER_EDGE_FUNCTION',
})

export const rooms = createRoomService(adapter)
export const invites = createInviteService(adapter)
export const players = createPlayerService(adapter)
```

The function name is explicit because this repository does not yet contain an
agreed, deployed shared Multiplayer Edge Function. The adapter uses
`database.invokeFunction`; it does not call Supabase directly.

By default, requests send the following action names:

- `create_room`
- `join_room`
- `get_room`
- `set_ready`

The action names can be overridden in the adapter options. The server
contract must accept `action`, `initData`, and the operation parameters, and
return a normalized `MultiplayerRoom`. The Edge Function must validate
Telegram `initData` and enforce authorization on the server.

This client adapter does not create or modify database tables, RLS policies,
Edge Functions, or Storage buckets. It intentionally does not assume table
names or schema. Realtime subscriptions should be added when the shared room
data contract and the corresponding table are agreed.

## Scope

This module is independent of game UI and game-specific services. Existing
game integrations are not migrated by this change.

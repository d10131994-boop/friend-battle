# Games — AI development guide

This document describes the shared rules for game modules in Friend Battle. It is intended for AI-assisted implementation and complements the game-specific human README files. The actual game code, Edge Functions and SQL are authoritative; do not assume every existing game has already been migrated to the same architecture.

## 1. Current game structure

The current game directories use PascalCase:
- `src/games/BrainBattle/`
- `src/games/ReactionRush/`

Each game currently owns its screens/components, game-specific state and logic, and (where implemented) its game-specific multiplayer UI and data contract. There is no shared generic game engine or game UI framework in `src/games` that a new game must extend. Do not invent a global registry, base class or generic game controller without a concrete requirement.

Existing games have separate solo and multiplayer flows:
- game menu components expose callbacks for solo play, multiplayer play and navigation;
- solo gameplay uses game-local state/logic;
- multiplayer gameplay composes the shared Multiplayer Core for rooms and room presence with a game-specific Edge Function for match operations.

Read the target game's `ai-readme.md` (once created) and source before modifying it. A neighboring game is a reference for integration patterns, not proof that its implementation is fully correct or a template to copy without review.

## 2. Responsibility boundaries

### Game module owns

- game rules, rounds/questions, gameplay state and transitions;
- game-specific UI and user interaction;
- game-specific validation rules that are not shared room rules;
- score calculation, winner/tie calculation and final results;
- game-specific persistence, history and leaderboards;
- game-specific trusted server operations and their SQL;
- solo-mode behavior and local solo state.

### Multiplayer Core owns

- room creation and lookup;
- invite codes and joining;
- room membership and player snapshots;
- host identity/transfer;
- common readiness;
- room heartbeat and presence timestamps;
- room lifecycle, shared Realtime room notifications and room-scoped token/session.

A game must not implement a second room system, invite-code system, generic host/ready mechanism, or duplicate room membership tables. Use `src/multiplayer` and its public contract.

### Database owns

- the shared browser Supabase client and public database facade;
- generic CRUD, RPC, Edge Function invocation, Storage and Realtime transport;
- common error normalization and repository factory.

Use `src/database`; do not create another Supabase client in a game. Game-specific repositories may be added for actual game tables, but must use the Database public API.

### Trusted backend owns

- Telegram identity verification;
- room/game membership and authorization checks;
- authoritative match state and server timestamps;
- accepting/rejecting game actions;
- score and winner calculation where competitive integrity matters;
- atomic match transitions and persistence.

The browser is not authoritative for competitive outcomes.

## 3. Shared multiplayer integration

For room operations, create the adapter against the shared Multiplayer Edge Function:

```ts
import {
  createDatabaseMultiplayerAdapter,
  createMultiplayerRoomSession,
} from '../../multiplayer'
import type { MultiplayerRoom } from '../../multiplayer'

const multiplayer = createDatabaseMultiplayerAdapter({
  functionName: 'multiplayer',
})
```

The actual import path depends on the game's directory depth; follow TypeScript resolution in the target file rather than copying a path blindly.

Use the public service methods for:
- `createRoom(auth, { maxPlayers? })`;
- `joinRoom(auth, { inviteCode })`;
- `selectGame(auth, { roomId, gameId })`;
- `getRoom(auth, { roomId })`;
- `setReady(auth, { roomId, isReady })`;
- `leaveRoom(auth, { roomId })`;
- `closeRoom(auth, { roomId })`;
- `heartbeat(auth, { roomId })`;
- `getRoomToken(auth, { roomId })`.

The room contract and known implementation discrepancies are documented in `src/multiplayer/ai-readme.md`. In particular, the intended flow is create an unselected room, then let the host select a game; the checked-in lifecycle SQL files currently disagree about this and about player capacity. Do not duplicate or locally work around those common lifecycle operations in a game. A fix belongs in a separately scoped Multiplayer/SQL task.

For a mounted room screen, use `createMultiplayerRoomSession` to own the shared room JWT, heartbeat and private Realtime watcher. Stop the session when the user leaves or the screen unmounts. The room snapshot is canonical; Broadcast is only an invalidation signal.

The shared Multiplayer client API does not expose `start_game` or `finish_game` as player operations. The trusted game backend invokes these actions after its own validation, using the per-game server secret on the server only. Never ship that secret to a client.

## 4. Game-specific multiplayer backend

A game uses its own Supabase Edge Function for game actions. Existing examples invoke it through `database.invokeFunction` and forward Telegram initData:

```ts
const invokeGame = async <T,>(
  body: Record<string, unknown>,
  initData: string,
): Promise<T> => database.invokeFunction<T, Record<string, unknown>>(
  'your-game-function',
  { ...body, initData },
)
```

This is only a shape example; use the actual function name, request schema and response types for the target game.

The game Edge Function must verify Telegram initData on the server, derive the acting user ID from verified data, validate room membership and selected game, and call narrowly granted server-side SQL functions. It must not trust a client-supplied user ID, score, winner, room status, readiness, timestamp or answer correctness.

Game-specific SQL/RPCs should own match-specific tables and operations. Common room/player data belongs to Multiplayer. Avoid writing common room membership, ready flags or host state from game SQL except through the agreed shared Multiplayer operations.

For competitive actions, keep validation and mutation atomic where possible. Use database time for deadlines. Design retries and duplicate requests deliberately (unique constraints/idempotency keys/session identifiers as appropriate). A delayed request from an older match must not mutate a newer match.

## 5. Match lifecycle and results

A room and a match are different entities:
- a room is the reusable multiplayer container;
- a match is one execution of a game's rules inside that room.

The shared room status `finished` means the current match has finished; it does not mean the room has been destroyed. The game owns its results screen, game-specific winner/tie display and rematch UI. The shared room layer owns common room readiness and room lifecycle.

Do not set a room to `cancelled` merely because a match ended. Do not invent a game-specific room status. Use the Multiplayer lifecycle contract and confirm its current implementation before depending on transitions such as player leave during an active match.

For a rematch, reuse the room and create a new game-specific match/session. Ensure stale requests from the previous match cannot affect the new one. Each player should confirm readiness through the shared Multiplayer service before the trusted backend starts another match, subject to the selected game's registered player-count rules.

## 6. Game rules and player limits

Each game must define its actual minimum and maximum player count. The current SQL convention registers these values in `public.common_multiplayer_game_rules` with:
- `game_id`;
- `min_players`;
- `max_players`;
- `is_enabled`;
- `updated_at`.

The current game SQL examples register their rules in this table. The intended shared room capacity is at most four players, while each game's own minimum may be higher than one. Multiplayer should enforce the selected game's registered limits when starting a match.

The current checked-in `multiplayer_game_lifecycle.sql` replacement does not consult the rules registry and validates `maxPlayers` as 1–100, unlike `universal_lobby_reaction_rush.sql`. This is a known implementation conflict, not a reason for a game to introduce its own room capacity enforcement. Document it and keep it out of unrelated game changes.

## 7. Solo mode

Solo mode is game-owned. A game may keep local state and game logic in its own hooks/modules, and may persist non-critical personal preferences or records through the agreed Database API. Do not route solo gameplay through Multiplayer unless the feature genuinely requires a shared room.

Do not assume local state is suitable for multiplayer competition. Local timers, localStorage, client-side answer checks and browser-calculated scores are not trusted for competitive multiplayer outcomes.

Existing examples:
- Brain Battle solo uses its local question selector, hook and scoring/game engine.
- Reaction Rush solo uses its local hook and browser storage for personal best/round counters.
These are solo-mode patterns only, not server-authoritative multiplayer patterns.

## 8. Existing implementation patterns to verify, not blindly copy

The current multiplayer screens for Brain Battle and Reaction Rush:
- compose `createDatabaseMultiplayerAdapter` and `createMultiplayerRoomSession`;
- call a game-specific Edge Function through `database.invokeFunction`;
- periodically fetch game-specific match snapshots (the reviewed screens poll at roughly 1.2-second intervals) in addition to the shared room Realtime session;
- display game-specific match results and common room/player information.

This reflects the current implementations, not a requirement that every future game must poll at the same interval. Choose a synchronization design deliberately, accounting for server snapshots, missed events, retries, disconnect/reconnect and load. Realtime events are not a replacement for canonical server snapshots.

Existing client-side `canStart` checks are useful for UI feedback only. The trusted backend must enforce player count, readiness, selected game and current room/match state again.

## 9. Recommended workflow for a new game

1. Audit the current project structure, Database API, Multiplayer API and existing game examples.
2. Define the game rules, solo flow, multiplayer flow, match state, request/response contracts, minimum/maximum players, deadlines, scoring and tie behavior.
3. Agree on which operations run in the browser and which run in trusted server code.
4. Register the game ID and player limits in `common_multiplayer_game_rules` through the approved SQL workflow.
5. Build game UI and game-specific logic inside `src/games/<GameName>/`.
6. Reuse Multiplayer for rooms, invitations, players, readiness, host, heartbeat and room session.
7. Use Database for browser-side transport; implement game-specific Edge Function and SQL for authoritative match operations.
8. Add `ai-readme.md` and human `README.md` for the game. Document only implemented behavior and known limitations.
9. Test solo and multiplayer separately, then test the full room/match lifecycle: create, join, select, capacity, ready, start, actions, synchronization, deadlines, finish, results, leave, cancellation, rematch, retries and reconnect.
10. Report source/build checks, SQL/deployment state and real multi-client integration tests separately.

## 10. Change discipline

When modifying a game, first read its own `ai-readme.md`, this shared guide, `src/multiplayer/ai-readme.md` and `src/database/ai-readme.md` as applicable. If the task changes shared Multiplayer or Database behavior, update the affected shared AI documentation and check every game integration that depends on that contract.

Do not change live Supabase schema, policies, functions or secrets without explicit approval. Do not silently migrate unrelated legacy code. Do not claim a server-side operation or multi-device flow works because the UI compiles.

When documenting behavior, distinguish:
- intended architecture;
- actual current client/server implementation;
- SQL patches that conflict or may not be deployed;
- tests that were actually run.


## 11. Shared room UI and match-only game screens

The shared application room experience is owned by `src/menus/MultiplayerRoomMenu.tsx`. It creates/joins the room, selects the game, manages common readiness and host-only start, and owns the room Realtime session and common player/stat display.

A multiplayer game screen is mounted with an existing `MultiplayerRoom` and receives:
- `initData`;
- `room`;
- `startRequested`;
- `onRoomUpdate(room)`;
- `onReturnToRoom()`;
- `onStartRequestHandled()`.

The game screen owns its game-specific match snapshot, gameplay actions, timer, scoring display and results. It must not recreate or leave the shared room, select a game, toggle common readiness, or build a second generic room UI. Keep these operations in the menus layer. The current implementation has match-only components `BrainBattleMatch` and `ReactionRushMatch`; the older room components remain in the tree as legacy code and are no longer routed by `App.tsx`.

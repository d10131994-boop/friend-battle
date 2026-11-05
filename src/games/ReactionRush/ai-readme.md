# Reaction Rush — AI development guide

This document describes the current Reaction Rush implementation audited in the repository. It complements `README.md`. Read `src/games/ai-readme.md`, `src/multiplayer/ai-readme.md` and `src/database/ai-readme.md` before changing its multiplayer architecture.

## 1. Scope and structure

Reaction Rush has separate solo and multiplayer flows.

Relevant client files:
- `ReactionRushMenu.tsx`: menu with solo, multiplayer and back callbacks.
- `ReactionRush.tsx`: reusable gameplay presentation component.
- `useReactionRush.ts`: solo game state, timer and local best/round counters.
- `ReactionRushMultiplayer.tsx`: multiplayer room, match, round, results and leaderboard UI.

Server files:
- `supabase/functions/reaction-rush/index.ts`: Telegram-authenticated game API.
- `supabase/sql/reaction_rush_multiplayer.sql`: game-specific match, score and leaderboard SQL.
- `supabase/sql/universal_lobby_reaction_rush.sql`: earlier universal lobby and game-rule/lifecycle SQL. It also defines a version of the shared Multiplayer action RPC.

## 2. Solo mode

The solo hook `useReactionRush` manages a 10-second local round, score and playing state. It persists personal `best` and `rounds` counters in browser `localStorage` under `friendBattleBest` and `friendBattleRounds`. The `onSaveScore` callback is supplied by its caller.

This local state is for solo play only. Do not use localStorage or browser-calculated scores as authoritative multiplayer results.

## 3. Multiplayer client integration

`ReactionRushMultiplayer.tsx` uses:
- `createDatabaseMultiplayerAdapter({ functionName: 'multiplayer' })` for shared room operations;
- `createMultiplayerRoomSession` for the room JWT, heartbeat and private Realtime watcher;
- `database.invokeFunction('reaction-rush', ...)` for game-specific actions.

The client flow is:
- create a room with `maxPlayers: 4`;
- join using an invite code;
- host selects `reaction-rush` using Multiplayer `selectGame`;
- players set common readiness;
- host starts the match through the game Edge Function;
- clients send taps and request round completion;
- clients refresh match snapshots and show round/final results;
- the room can be used for another match after readiness is set again.

The current screen refreshes game-specific match snapshots approximately every 1.2 seconds in addition to shared room Realtime. The browser countdown uses server-provided `roundStartedAt` to display remaining time; the SQL checks server time and decides whether a tap or finish request is still valid.

## 4. Game API and authentication

The `reaction-rush` Edge Function accepts POST actions:
- `start_match`
- `tap`
- `finish_round`
- `get_match`
- `leaderboard`

It verifies Telegram initData server-side with `TELEGRAM_BOT_TOKEN`, including HMAC and auth-date validation (maximum age one hour; future tolerance 30 seconds). The acting Telegram ID and display name are derived from the verified user. It uses a service-role Supabase client for game operations.

The client must not submit an authoritative user ID, score total, winner or timestamp. The Edge Function derives the player ID; PostgreSQL validates match state and records taps.

### start_match

The Edge Function obtains the canonical room through `multiplayer_execute_action(get_room)`, verifies that Reaction Rush is selected, verifies the caller is a member and host, then calls `reaction_rush_start_match`. SQL repeats the host/game checks and starts the shared Multiplayer lifecycle before creating a new game-specific match. A `match_started` Broadcast is sent after success.

### tap

The client sends `roomId`, `matchId` and `roundNumber`. The Edge Function derives Telegram identity and calls `reaction_rush_record_tap`.

SQL verifies that:
- the match exists in the room and is still playing;
- the requested round is the current round;
- the shared room is `playing` with the matching match start timestamp;
- the player is a current room member;
- server time is within the 10-second round window.

Each accepted request increments that player's score by one. The per-round score is capped at 1000. The client displays the returned current score but cannot choose or overwrite it.

### finish_round

The client sends `roomId`, `matchId` and `roundNumber`. SQL verifies the match is active, the round number is current and at least 10 seconds have elapsed.

- Rounds 1 and 2 produce round results and advance to the next round using a server timestamp.
- Round 3 computes final totals and winner/tie, updates common room stats and the Reaction Rush leaderboard, marks the game match completed, and calls the shared Multiplayer `finish_game` lifecycle operation.

The Edge Function broadcasts `round_finished` or `match_finished` after a successful SQL call. The current function's `finish_round` path does not itself perform the same explicit room membership/host check as `start_match`; it relies on the service-role RPC's match/room validation and the possession of valid Telegram initData at the Edge Function. Do not add assumptions about host-only round completion unless the backend contract is deliberately changed.

### get_match

The Edge Function calls `reaction_rush_match_snapshot`, which checks room membership and returns the canonical room plus the current or latest completed match snapshot. While playing, the snapshot includes the caller's current-round score.

### leaderboard

The Edge Function reads up to 50 rows from `games_reaction_rush_leaderboard`, ordered by wins and then best match score. The request is Telegram-authenticated; the query runs server-side using the service-role client.

## 5. Multiplayer rules and persistence

The current SQL uses:
- `games_reaction_rush_matches`;
- `games_reaction_rush_scores`;
- `games_reaction_rush_leaderboard`;
- shared `common_multiplayer_room_stats`.

A match has three rounds. Each round lasts 10 seconds. Every accepted tap adds one point, with a maximum of 1000 per player per round. Final match score is the sum across rounds. A unique highest total wins; a tie has no winner. Common room wins/matches and the game-specific leaderboard are updated when round 3 completes.

The game rules registry convention is `common_multiplayer_game_rules`, with Reaction Rush registered for 2–4 players in the game SQL. The current multiplayer UI also checks 2–4 players before enabling the host's start button. This client check is for presentation only: the later `multiplayer_game_lifecycle.sql` replacement does not consult the rules registry when starting a match. Verify the actual deployed RPC before claiming server-side min/max enforcement.

## 6. Realtime and synchronization

Reaction Rush broadcasts private room-topic events:
- `match_started`;
- `round_finished`;
- `match_finished`.

The shared Multiplayer watcher listens to its configured room event set; the game client also polls its own match snapshot. Broadcast messages are invalidation/notification signals, not canonical game state. Always reconcile with the server snapshot after reconnects, races or uncertain round transitions.

The client uses `finishRequestedRef` keyed by `matchId:roundNumber` to avoid repeatedly submitting the same round-finish request from one mounted screen. The server still validates the current match and round; client-side guards are not a substitute for backend idempotency/concurrency handling.

## 7. Known documentation and SQL discrepancies

The current `README.md` is stale in at least these areas:
- it names `public.reaction_rush_scores`, while the reviewed multiplayer SQL uses `public.games_reaction_rush_scores`;
- it describes the older score-store wording and does not enumerate the current Edge Function action contract;
- it says to apply `multiplayer_game_lifecycle.sql` followed by `reaction_rush_multiplayer.sql`, while `universal_lobby_reaction_rush.sql` contains the earlier universal room schema, game-rule registry and an alternative `multiplayer_execute_action` implementation.

There are two checked-in definitions of `public.multiplayer_execute_action` with materially different behavior: `universal_lobby_reaction_rush.sql` and `multiplayer_game_lifecycle.sql`. The latter currently requires `gameId` at room creation, omits `select_game`, uses a different capacity check and has different mid-match leave behavior. See `src/multiplayer/ai-readme.md`. Do not assume a file's presence proves that it is deployed, or apply SQL patches without confirming the actual database state and intended order.

The legacy `duels` table/function references in older code/README are not the current multiplayer UI flow. Do not add new dependencies on them.

## 8. Security and change rules

- Keep tap validation, timing, score accumulation, round transitions, final totals and winner calculation on the trusted backend.
- Never trust client-supplied Telegram IDs, room membership, host status, score totals, winner or timing values.
- Keep game table writes in trusted SQL RPCs; browser clients use the game Edge Function.
- Never expose service-role keys or server secrets in frontend code.
- Preserve the distinction between game-specific match state and shared room state.
- Do not change live Supabase SQL/functions/secrets without explicit approval.
- Update this document when actions, table names, timing, scoring, results or integration contracts change. Update the human README when it becomes stale.

## 9. Verification

Test solo mode separately. Multiplayer verification should cover create/join/select, 2–4 players, readiness, host start, accepted/rejected taps, 1000-point round cap, round deadline, concurrent finish requests, round advancement, final totals, winner/tie, leaderboard, common room stats, finish, rematch, leave during match and reconnect.

A successful build does not prove that the Edge Function, SQL, Realtime policies or live multi-device flow are deployed and working. Report source/build checks, SQL/deployment state and real multi-client tests separately.

# Reaction Rush — AI development guide

This document describes the current Reaction Rush implementation audited in the repository. It complements `README.md`. Read `src/games/ai-readme.md`, `src/multiplayer/ai-readme.md` and `src/database/ai-readme.md` before changing its multiplayer architecture.

## 1. Scope and structure

Reaction Rush has separate solo and multiplayer flows.

Relevant client files:
- `ReactionRushMenu.tsx`: menu with solo, multiplayer and back callbacks.
- `ReactionRush.tsx`: reusable gameplay presentation component.
- `useReactionRush.ts`: solo game state, timer and local best/round counters.
- `ReactionRushMatch.tsx`: routed multiplayer game UI; the shared room is owned by `src/menus/MultiplayerRoomMenu.tsx`.
- `ReactionRushMultiplayer.tsx`: legacy standalone room/game implementation, not routed by `App.tsx`.

Server files:
- `supabase/functions/reaction-rush/index.ts`: Telegram-authenticated game API.
- `supabase/sql/reaction_rush_multiplayer.sql`: game-specific match, score and leaderboard SQL.
- `supabase/sql/universal_lobby_reaction_rush.sql`: earlier universal lobby and game-rule/lifecycle SQL. It also defines a version of the shared Multiplayer action RPC.

## 2. Solo mode

The routed `ReactionRushSolo.tsx` uses server-owned 10-second sessions and server-recorded taps through `solo_start`, `solo_tap`, `solo_finish` and `solo_snapshot`. On entry, `solo_enter` retrieves the player's best top-ten score when present and the number of completed solo rounds. The old `useReactionRush.ts` local hook remains for compatibility with profile stats; it is not authoritative for the current solo game.

## 3. Multiplayer client integration

The routed multiplayer flow uses:
- `MultiplayerRoomMenu.tsx` with `createDatabaseMultiplayerAdapter({ functionName: 'multiplayer' })` for shared room operations;
- `MultiplayerRoomMenu.tsx` with `createMultiplayerRoomSession` for the room token, heartbeat and private Realtime watcher;
- `ReactionRushMatch.tsx` with `database.invokeFunction('reaction-rush', ...)` for game-specific actions.

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
- `return_to_room`
- `solo_enter`, `solo_start`, `solo_tap`, `solo_finish`, `solo_snapshot`

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

- Every round awards one `roundPoint` to each player tied for the most taps, including zero-tap ties. Rounds 1 and 2 return these round results and advance to the next round using a server timestamp.
- Round 3 calculates the number of round points won by each player. Each player tied for the most round points is a match winner, and each receives one common room win. The persisted `final_results` entries contain `score` (0–3 round points), `totalTaps` (raw tap sum), and `isWinner` (boolean). The legacy `winner_user_id` is set only for a unique winner. The Edge Function returns `winnerUserIds` for all winners. Room stats and the shared tap leaderboard are updated, and the match is marked completed with `completed_at`. The shared room remains `playing` during the results screen; the game Edge Function calls Multiplayer `finish_game` only after a member requests `return_to_room` or the 60-second results timeout expires.

The Edge Function broadcasts `round_finished` or `match_finished` after a successful SQL call. `reaction_rush_finish_round` receives the verified Telegram ID and checks the caller's room membership, the active match/session, current round and elapsed deadline under room-first locking. Any current room member may finalize an elapsed round.

### get_match

The Edge Function calls `reaction_rush_match_snapshot`, which checks room membership and returns the canonical room plus the current or latest completed match snapshot. While playing, the snapshot includes the caller's current-round score.

### leaderboard

The Edge Function reads up to ten rows from `games_reaction_rush_records`, ordered by highest recorded taps. This is a shared top-ten ranking for solo (single-round taps) and multiplayer (total taps across a match), and it does not rank by match round points. It is queried server-side under verified Telegram initData.

## 5. Multiplayer rules and persistence

The current SQL uses:
- `games_reaction_rush_matches`;
- `games_reaction_rush_scores`;
- `games_reaction_rush_records` (shared top-ten tap records);
- shared `common_multiplayer_room_stats`.

A match has three 10-second rounds. A tap increases the current round's tap count, capped at 1000 taps per player per round. The highest tap count in each round awards one round point to every tied leader; zero-score ties are valid. The match score is the number of round points (0–3), **not** the sum of taps. All players tied for the highest round-point total receive a room win. The shared top-ten record still saves raw tap totals, not round points. At completion, the SQL deletes per-round rows from `games_reaction_rush_scores`; `games_reaction_rush_matches.final_results` retains each player's round points, raw total taps and `isWinner` flag. Historical completed results without `totalTaps` retain their old score meaning.

Game availability and player limits are configured in `public.common_game_availability`. Reaction Rush is registered for solo and multiplayer play, with 2–4 participants in multiplayer (`min_players = 2`, `max_players = 4`). The shared Multiplayer RPC and room-capacity trigger read this catalog; client-side checks are presentation only. Do not register new games in the legacy `common_multiplayer_game_rules` table.

## 6. Realtime and synchronization

Reaction Rush broadcasts private room-topic events:
- `match_started`;
- `round_finished`;
- `match_finished`.

The shared Multiplayer watcher listens to its configured room event set; the game client also polls its own match snapshot. Broadcast messages are invalidation/notification signals, not canonical game state. Always reconcile with the server snapshot after reconnects, races or uncertain round transitions.

The client uses `finishRequestedRef` keyed by `matchId:roundNumber` to avoid repeatedly submitting the same round-finish request from one mounted screen. Once the match is completed, the room remains `playing` during the results screen. Any member can use the `return_to_room` Edge Function action, or the client automatically invokes it 60 seconds after the server's `completedAt` timestamp. The server validates terminal match state and finishes the shared room for all players.

## 7. Known documentation and SQL discrepancies

The human `README.md` has been updated for the current scoring rules, shared records and deployment migration. Older baseline SQL files may still document superseded score or multiplayer lifecycle behavior; the latest migrations and deployed routines are authoritative.

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

Test solo mode separately. Multiplayer verification should cover 2, 3 and 4 players; readiness and host start; valid/rejected taps; 1000-tap limit and server deadlines; one or multiple round leaders (including 0–0 ties); three-round aggregation; single or multiple match winners; one room win for each tied leader; raw-tap shared records; double finish requests; results return/timeout; leaving mid-match and reconnect.

A successful build does not prove that the Edge Function, SQL, Realtime policies or live multi-device flow are deployed and working. Report source/build checks, SQL/deployment state and real multi-client tests separately.


## 10. Shared room integration boundary

The common room screen is now `src/menus/MultiplayerRoomMenu.tsx`. It owns room creation/joining, selection of Reaction Rush, readiness, host start, invites, room presence and common room statistics. The game-specific `ReactionRushMatch` component receives an existing room and owns only Reaction Rush match snapshots, tap actions, round timing/transitions and match results.

Do not add common room controls or call `createRoom`, `joinRoom`, `selectGame`, `setReady` or `leaveRoom` from `ReactionRushMatch`. The older `ReactionRushMultiplayer.tsx` remains as legacy implementation and is not routed by the current `App.tsx`; do not extend it when changing the shared room flow.

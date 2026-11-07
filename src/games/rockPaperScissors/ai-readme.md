# Rock Paper Scissors — AI development guide

Read `src/ai-readme.md`, `src/games/ai-readme.md`, `src/multiplayer/ai-readme.md` and `src/database/ai-readme.md` before changing this module.

## 1. Ownership and structure

The `rockPaperScissors` game module owns the Rock Paper Scissors rules, solo state, multiplayer match state, round progression, scoring and results.

Relevant client files:
- `RockPaperScissorsSolo.tsx`: local solo match and randomly selected computer gestures.
- `RockPaperScissorsMatch.tsx`: multiplayer match screen mounted by `MultiplayerRoomMenu`.
- `HandIllustration.tsx`: shared left-hand gesture illustrations.
- `logic/gameRules.ts`: pure gesture outcome and opponent-name selection helpers.
- `types.ts`: game rules and public match snapshot types.
- `rockPaperScissors.css`: game-specific presentation.

Server files:
- `supabase/functions/rock-paper-scissors/index.ts`: Telegram-authenticated game API.
- `supabase/sql/rock_paper_scissors_multiplayer.sql`: game tables, trusted RPCs, room-capacity trigger and interrupted-match cleanup hook.
- `supabase/tests/rock_paper_scissors_multiplayer.sql`: isolated database integration checks.

The game ID and Edge Function slug are both `rock-paper-scissors`. The client module directory intentionally uses the name `rockPaperScissors`.

## 2. Agreed game contract

- Solo and multiplayer modes are supported.
- Multiplayer sessions contain exactly two players.
- A match ends when one player reaches three round wins. There is no fixed round limit because drawn rounds do not award points.
- Each round has three phases:
  1. `choosing`: three seconds. Both players choose simultaneously and cannot see the opponent's choice. The player may change their own choice until the server deadline. No choice at the deadline becomes `rock`.
  2. `revealing`: four seconds. Both choices are visible; no countdown is displayed.
  3. `result`: four seconds. The current round result and scores are shown; no countdown is displayed.
- A win awards one point. A draw awards no points and is presented as `Ничья` with the neutral blue treatment.
- The multiplayer final screen shows the two player names and the final match score. The winner sees `С победой!`; the other player sees `Не в этот раз`.
- In solo mode the computer selects each gesture randomly. Its final nickname is based on the computer's most frequent gesture: paper → Влад, scissors → Эдвард, rock → Дуэйн. Tied frequencies select a random name among the tied gestures.
- The gesture illustrations depict the left hand with the back of the hand facing up (palm down).

## 3. Trust and phase progression

The browser is never authoritative for multiplayer choices after the deadline, scores, round outcomes or match winner.

The Edge Function verifies Telegram `initData` and derives the acting Telegram user ID. SQL verifies current room membership, selected game, exact match/session, round, phase and server deadline. The client may submit a choice only while the server phase is `choosing`.

`rock_paper_scissors_match_snapshot` locks the shared room before the game match, advances a due phase using database time, applies default rock to missing choices, and returns a caller-specific snapshot. During `choosing`, the snapshot returns the caller's own choice but masks the opponent's choice. Both choices become visible only in `revealing` and `result`.

Clients poll the canonical snapshot, estimate the server/client clock offset from the returned `serverNow`, and use the server phase deadline to render a consistent countdown. A disconnected player remains a room member unless they explicitly leave. The three-second deadline is not paused or extended; a player who reconnects before it expires can still submit a choice, otherwise rock is assigned.

## 4. Multiplayer Core integration

`MultiplayerRoomMenu` owns room creation/joining, game selection, common readiness, host-only start, room session and room navigation. The game screen receives an existing `MultiplayerRoom` and standard callbacks. Do not implement a second room, invite, readiness, heartbeat, host or room-session system here.

The selected game rule is exactly 2–2. The shared SQL trigger `multiplayer_set_room_capacity_from_game` copies the selected game's `max_players` into the room capacity and rejects selecting a game when the room already contains too many players. This allows the existing `join_room` operation to enforce the two-player cap before a match starts. The trigger is part of the SQL patch in this task and must be deployed with the game rule row.

The game SQL starts the shared room through `multiplayer_execute_action('start_game', ...)` and finishes it through the matching `finish_game` action using the exact `startedAt`. These are server-only operations. The client must not call them directly.

When a player explicitly leaves during a match, Multiplayer resets the room to `waiting`; the game-owned room-reset trigger marks the active match `cancelled`. A network disconnect is not a leave and must not cancel the match.

The completed game match leaves the shared room in `playing` while the final result is displayed. Any current member can return everyone to the room. If nobody does so, the client requests the same trusted return action 60 seconds after the server-recorded completion time.

## 5. Solo mode

Solo mode is local and does not create a Multiplayer room or call the game Edge Function. The computer's gesture is generated randomly at the end of each three-second selection phase. The same pure `getRoundOutcome` helper is used to calculate the round result. The computer nickname is calculated from its own gesture history, not the player's history.

## 6. Persistence and security

The game-owned tables are:
- `games_rock_paper_scissors_matches`;
- `games_rock_paper_scissors_match_players`;
- `games_rock_paper_scissors_rounds`;
- `games_rock_paper_scissors_round_players`.

All four tables have RLS enabled and browser roles revoked. The game Edge Function uses the service-role client after verifying Telegram identity. Do not expose the service-role key or use browser CRUD for game state.

The match snapshot and choice submission RPCs lock the room first, then the game match. Keep this lock order aligned with the shared Multiplayer room lifecycle. Stale match IDs and mismatched room `started_at` values must never mutate a newer session.

## 7. Verification

The SQL integration script must run only against an isolated/local database. It covers selected-game capacity, the two-player cap, choice privacy, gesture resolution, the first-to-three match lifecycle, room statistics and interrupted-match cleanup.

Report TypeScript/build checks, SQL parsing, isolated database tests, Supabase deployment and real two-device Telegram testing separately. A successful build does not prove that the deployed multiplayer flow works.

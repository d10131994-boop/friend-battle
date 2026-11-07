# Brain Battle — AI development guide

This document describes the current Brain Battle implementation audited in the repository. It complements `README.md`. Read `src/games/ai-readme.md`, `src/multiplayer/ai-readme.md` and `src/database/ai-readme.md` before changing its multiplayer architecture.

## 1. Scope and structure

Brain Battle has separate solo and multiplayer flows.

Relevant client files:
- `BrainBattle.tsx`: solo gameplay screen.
- `BrainBattleMenu.tsx`: game menu; routes to solo or multiplayer callbacks.
- `BrainBattleRoom.tsx`: multiplayer room, match and result UI.
- `hooks/useBrainBattle.ts`: solo game state and timer.
- `logic/questionSelector.ts`, `logic/gameEngine.ts`, `logic/scoring.ts`: solo question selection and scoring.
- `types/index.ts`: game-local types.
- `data/`: solo question/category data.

Server files:
- `supabase/functions/brain-battle/index.ts`: Telegram-authenticated game API.
- `supabase/sql/brain_battle_multiplayer.sql`: game-specific match/answer tables and RPCs.

## 2. Solo mode

Solo mode uses local game state in `useBrainBattle` and the local question selector/game engine. The current hook:
- selects 10 questions;
- runs 15-second local countdowns;
- stores selected answers and remaining time per question;
- moves from `idle` to `playing`, `answering` and `finished`;
- calculates the final result locally.

Solo scoring is 100 base points for a correct answer plus a speed bonus calculated with `Math.round((remainingTime / 15) * 50)`; incorrect and skipped answers score zero. Do not reuse this client-side calculation as authoritative multiplayer scoring.

## 3. Multiplayer client integration

`BrainBattleRoom.tsx` uses:
- `createDatabaseMultiplayerAdapter({ functionName: 'multiplayer' })` for room operations;
- `createMultiplayerRoomSession` for room JWT, heartbeat and shared private Realtime;
- `database.invokeFunction('brain-battle', ...)` for game-specific match operations.

The room flow in the client is:
- create room with `maxPlayers: 4`;
- join by invite code;
- host selects `brain-battle` using Multiplayer `selectGame`;
- players toggle common readiness;
- host starts the match through the `brain-battle` Edge Function;
- clients submit answers and refresh game snapshots;
- the game UI presents final results and returns to the room menu for a possible rematch.

The room screen refreshes the game-specific match snapshot on an approximately 1.2-second interval in addition to the shared room Realtime watcher. This is current implementation behavior, not a universal polling requirement. Timers displayed in the browser are presentation only; the server timestamps and SQL checks determine whether an answer is accepted.

## 4. Game API and authentication

The `brain-battle` Edge Function accepts POST actions:
- `start_match`
- `submit_answer`
- `get_match`

It verifies Telegram initData on the server using `TELEGRAM_BOT_TOKEN`, including HMAC and auth-date validation (maximum age one hour; future tolerance 30 seconds). The acting Telegram ID and display name are derived from the verified user. The function uses the Supabase service-role client for trusted database operations.

The client must not send an authoritative user ID, correct answer, score, winner or timing result. The Edge Function derives identity and forwards it to SQL.

### start_match

The Edge Function:
1. fetches the canonical room through `multiplayer_execute_action(get_room)`;
2. verifies that Brain Battle is selected;
3. verifies that the caller is a room member; the host starts an initial match, while any current member may trigger a rematch only after the shared room has an accepted unanimous vote;
4. selects/shuffles the server-side question bank, excluding IDs from the immediately previous completed match;
5. calls `brain_battle_start_match`;
6. broadcasts `match_started` to the private room topic.

The SQL function repeats the critical checks: room exists, Brain Battle is selected, caller is a current member who is either the host or is triggering an already-approved rematch, and exactly 10 valid questions with four answers and a valid correct-answer index are supplied. The shared Multiplayer RPC independently validates readiness for an initial match or unanimous approval for a default rematch. It starts the shared room session and creates the game-specific match record.

### submit_answer

The client sends `roomId`, `matchId`, `questionIndex` and `selectedAnswer` (0–3; null is supported by the backend for a skip). The Edge Function derives the player ID from Telegram initData and calls `brain_battle_submit_answer`.

SQL verifies:
- the match belongs to the room and is active;
- the shared room is still `playing` with the matching `started_at`;
- the player is a current room member;
- question index matches the current question;
- answer index is valid;
- server time is within the question's start/deadline window;
- the player has not already answered that question (unique constraint).

The server stores correctness, response time and score. The correct answer and explanation are not returned in the active-question snapshot.

### get_match

The Edge Function verifies Telegram initData and obtains the room through the shared Multiplayer RPC. It looks up the active game match, calls `brain_battle_advance_if_due` when one exists, then returns `brain_battle_match_snapshot`.

Question advancement occurs when every current player has answered or the 15-second deadline has elapsed. Because advancement is checked during `get_match`/answer requests, the client polling currently helps drive deadline processing. The server stores question deadlines; client countdowns do not decide the outcome.

## 5. Multiplayer rules and scoring

The game-specific SQL creates:
- `games_brain_battle_matches`;
- `games_brain_battle_answers`.

A match contains exactly 10 questions. Each question has four answer options and a 15-second answer window. The first question starts three seconds after the shared match start timestamp; subsequent questions use server-generated timestamps.

Multiplayer score is calculated in SQL, not by the solo game engine:
- correct answer: 100 base points plus a speed bonus up to 50;
- incorrect answer: 0;
- skipped or unanswered by deadline: 0.

The SQL uses a floored speed bonus based on server-measured response time. Do not assume it is byte-for-byte identical to the solo `Math.round` formula.

Final results include score, correct, incorrect and skipped counts. The unique highest total wins; a tie results in `winnerUserId: null`. Common room statistics are updated in `common_multiplayer_room_stats`.

## 6. Realtime events and snapshots

The game Edge Function broadcasts private room-topic events such as:
- `match_started`;
- `answer_submitted`;
- `question_advanced`;
- `match_finished`.

These events are notifications. The room watcher in Multiplayer listens to the shared room event set and refreshes the common room snapshot; Brain Battle separately refreshes its game-specific snapshot. Do not treat Broadcast payloads as canonical match state.

## 7. Shared lifecycle and rematch integration

The current AI-branch canonical shared room lifecycle is defined in supabase/sql/universal_lobby_reaction_rush.sql. When a player leaves during a match, the shared room returns to waiting; the Brain Battle-owned trigger in supabase/sql/brain_battle_multiplayer.sql marks its active match cancelled. Multiplayer does not directly update Brain Battle match or answer tables.

Both current games use lifecycle mode default. After a completed match, Multiplayer opens a 60-second unanimous rematch vote. Once accepted, the host client automatically requests the next match. The trusted SQL layer validates the accepted vote before starting it.

For Brain Battle, supabase/functions/brain-battle/questions.ts contains the trusted question bank and selector. The Edge Function reads the immediately previous completed match's question IDs and excludes them when selecting the next set. The current bank contains 20 questions and each match uses 10, so consecutive completed matches receive disjoint question sets. If fewer than 10 unseen questions remain, the selector falls back to the full bank; this is a deliberate fallback, not a guarantee of permanent non-repetition across an unlimited number of matches.

The selector is covered by questions_test.ts. The transactional brain_battle_rematch.sql script covers two consecutive matches, winner/statistics accumulation, and repeated-completion idempotency. Database lifecycle SQL scripts are parsed by CI but are not executed there.

Deployment distinction: the rematch migration and current lifecycle SQL are present on the AI branch but have not been applied to Production. Production's live schema/migration history must be checked separately before any deployment. Do not infer deployed behavior from this branch's files.

## 8. Security and change rules

- Keep the question bank, correct answers, explanations, answer validation, response-time calculation and score calculation on the trusted backend for multiplayer.
- Never trust client-supplied Telegram IDs, membership, host status, answer correctness, timestamps, score or winner.
- Keep match/answer writes in trusted SQL RPCs; do not write game tables directly from the browser.
- Game SQL functions are intended for trusted service-role execution; inspect grants and function definitions before changing them.
- Do not expose service-role keys or server secrets in the frontend.
- Keep solo and multiplayer scoring paths distinct unless a deliberate rules change aligns them.
- Do not change live Supabase SQL/functions/secrets without explicit approval.
- Update this document when actions, schemas, rules, scoring, timers, results or integration contracts change. Update the human README when it becomes stale.

## 9. Verification

Test solo mode separately from multiplayer. Multiplayer verification should cover create/join/select, 2–4 players, readiness, host start, question snapshots, answer validation, duplicate answers, deadlines, unanswered skips, score calculation, tie/winner, common stats, finish, rematch, leave during match, disconnect/reconnect and concurrent answer/advance requests.

A successful build does not prove that the Edge Function, SQL, Realtime policies or live multi-device flow are deployed and working. Report these checks separately.


## 10. Shared room integration boundary

The common room screen is now `src/menus/MultiplayerRoomMenu.tsx`. It owns room creation/joining, selection of Brain Battle, readiness, host start, invites, room presence and common room statistics. The game-specific `BrainBattleMatch` component receives an existing room and owns only Brain Battle match snapshots, question timing, answer submission and match results.

Do not add common room controls or call `createRoom`, `joinRoom`, `selectGame`, `setReady` or `leaveRoom` from `BrainBattleMatch`. The older `BrainBattleRoom.tsx` remains as legacy implementation and is not routed by the current `App.tsx`; do not extend it when changing the shared room flow.

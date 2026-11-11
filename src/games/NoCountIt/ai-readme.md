# NoCountIt — AI development guide

Read `src/ai-readme.md`, `src/games/ai-readme.md`, `src/multiplayer/ai-readme.md` and `src/database/ai-readme.md` before changing this module.

## 1. Ownership

NoCountIt owns its game-specific match lifecycle, round states, scene generation, answer validation, error calculation, winner/tie calculation, results and game-specific persistence.

Multiplayer Core owns rooms, membership, host, common readiness, room heartbeat, room-scoped Realtime session and the shared room lifecycle. Do not duplicate these responsibilities.

Browser database transport must use `src/database`. Do not create another Supabase client or access common Multiplayer tables directly from game components.

## 2. Agreed game contract

- 2–4 players; no solo mode.
- Three rounds per match.
- One shared image and target-color prompt per round.
- 30 seconds to prepare/load the image; 5 seconds to show it; 10 seconds to answer.
- Answers are non-negative integers without a fixed upper bound. The in-game keypad replaces the system keyboard.
- An answer is immutable after successful submission.
- A round completes when all active participants answer or the server deadline expires.
- Error is `abs(answer - correctCount)`; no answer by an active participant means `correctCount`.
- A player not ready before the preparation deadline is excluded only from that round. They remain in the match and may participate in later rounds.
- The error assigned to a not-ready player is the ceiling of the mean error among actual participants in that round.
- If no player is ready, finish the match as a technical abort, record no round error, and return everyone to the existing room. Do not close/cancel the room.
- Lowest accumulated error wins; a tie has no winner.
- A real player departure is distinct from `excluded_not_ready`. The agreed rule is to end the match early and award the remaining player a win when all other players have actually left.

## 3. Scene generator

Version 1 generates a candy jar from a prepared visual template:
- 40–120 candies;
- 4–10 colors, with at least three candies of each color;
- random remaining color distribution and shuffled object list;
- a random target color selected from colors present in the scene;
- normalized 0–1000 coordinates;
- deterministic bottom-up placement in staggered layers, with jar-wall positions evaluated before interior positions;
- wall-adjacent candies must not cover more than 30% of any already placed neighbor;
- pairwise circle intersections are used as an approximation for overlap, targeting 10–60% cumulative overlap on each candy (outer-contour candies may use a lower 5% floor when needed);
- size is calculated from the requested candy count and multiplied by `CANDY_SIZE_MULTIPLIER` (currently `2`); the 20-unit minimum and 90-unit maximum base radius are multiplied by the same factor;
- the top 10–30% of the jar interior is left empty, with the percentage selected deterministically from the scene seed;
- no objects outside the jar, no fully hidden candies, and visible target candies.

A development-only generator preview is available at `/?no-count-it-generator=1` while running Vite. It accepts a fixed candy count and seed so generated layouts can be compared reproducibly. The preview must remain unavailable in production builds.

The generator creates the private scene data. The SVG renderer draws it and must not calculate game outcomes. Keep the generator independent from the match engine so additional scene generators can be added without changing match rules.

## 4. Privacy and trust boundary

Scene object coordinates, seed, target count and other private generation metadata are server-only until the round reveal. The pre-reveal client snapshot may include a signed image URL and the prompt, but never the scene JSON or correct count.

The backend verifies Telegram initData, derives the acting user ID, checks room membership and selected game, and enforces deadlines using database/server time. Never trust client-supplied identity, room membership, readiness, answer correctness, timestamps, score, errors or winner.

Every mutation must be atomic and safe under retries/concurrent requests. Preserve the project lock order: room first, then game match/round. A stale request must not mutate a later match; bind operations to the exact match ID and shared room `startedAt`.

## 5. Shared lifecycle

Use the trusted Multiplayer `start_game` and `finish_game` operations from the game server only. Pass the exact `startedAt` returned by `start_game` to `finish_game`. The game client must not call these operations directly.

A completed or technical-abort match keeps the shared room in `playing` while results are shown. Any member may return to the room; otherwise the client invokes the trusted `return_to_room` action 60 seconds after the match's server-recorded `completedAt`. That action verifies the terminal NoCountIt match and then marks the shared room `finished`. The room remains open and reusable.

## 6. Planned persistence and storage

The planned game tables are:
- `games_no_count_it_matches`;
- `games_no_count_it_match_players`;
- `games_no_count_it_rounds`;
- `games_no_count_it_round_players`.

All game tables are private to trusted server operations. Browser clients access game actions only through the `no-count-it` Edge Function.

The planned private Storage bucket is `no-count-it-scenes`. Use signed URLs issued after membership validation. Retain scene assets for 24 hours after match completion and clean them with a retry-safe scheduled process.

Production currently contains all four game tables with RLS enabled and no browser policies; execute access is restricted to `service_role`. The private `no-count-it-scenes` bucket is live, limited to SVG and 1 MiB, and the `no-count-it` Edge Function is deployed. Production migration history includes `no_count_it_multiplayer_schema`, `no_count_it_round_progression`, `no_count_it_match_rpcs`, `no_count_it_preparation_deadline`, `no_count_it_round_ready_deadline_guard`, `no_count_it_round_ready_waiting_count_fix` and `no_count_it_snapshot_locking`, `no_count_it_rounds_room_match_index`, `no_count_it_player_leave_lifecycle` and `no_count_it_snapshot_include_cancelled` and `no_count_it_snapshot_ignore_terminal_matches` and `no_count_it_room_cancel_cleanup` and `no_count_it_scene_retention_deadlines`. The database records a 24-hour `delete_after` timestamp on terminal matches, but actual Storage object deletion is not yet scheduled. The deployed Edge Function is version 7. Signed URLs currently expire after 10 minutes. The 24-hour object cleanup is not yet scheduled; do not claim retention enforcement is active.

Real player departure is handled by a NoCountIt-owned trigger on the shared player deletion: the leaver is marked `left`; if exactly one match participant remains, that player is recorded as the early winner and common room statistics are updated. If more than one participant remains, the active match is cancelled because the current shared Multiplayer leave operation resets the room and clears its selected game. The currently connected game screen preserves its NoCountIt view long enough to display the completed/cancelled result. Reconnection into that post-leave result view after a full app restart is not yet guaranteed.

The agreed 24-hour Storage object cleanup is still not implemented or scheduled.

## 7. Client integration boundary

The match component receives the existing room and standard callbacks from `MultiplayerRoomMenu`. It owns only NoCountIt match snapshots, preparation/image/answer/reveal UI and game-specific actions. It must not create/join/leave rooms, select games, set common readiness or duplicate the common room interface.

Use `database.invokeFunction('no-count-it', ...)` for game actions. Use the existing Multiplayer room session and canonical game snapshots for synchronization. Realtime events are invalidation only.

## 8. Verification

Test generator invariants independently and with deterministic seeds. Test server transitions and races for preparation deadlines, late readiness, zero-ready technical abort, early all-answered completion, timeout/no-answer, immutable answers, excluded-player average error, reveal privacy, stale match requests, real player departure, final tie/winner, reconnect, room return and results timeout.

Report build/typecheck, lint, SQL validation, deployment and real multi-client testing separately. A successful client build does not prove backend or multiplayer integration.

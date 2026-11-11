# NoCountIt

NoCountIt is a multiplayer estimation game for 2–4 players. There is no solo mode.

## Match rules

- A match contains three rounds.
- Every participating player receives the same scene and target-color question.
- The scene is displayed for 5 seconds, followed by a 10-second answer window.
- Players submit a non-negative integer using the game's on-screen number pad. The answer cannot be changed after submission.
- A round ends as soon as all active participants have answered, or when the server deadline expires.
- A submitted answer's error is the absolute difference between the answer and the actual number of target-color candies.
- A participant who does not submit an answer receives an error equal to the actual target count.
- A player excluded from a round because the scene did not load before the 30-second preparation deadline receives the ceiling of the average error among the players who actually participated in that round.
- If no player is ready before the preparation deadline, the match ends as a technical abort. The room is returned to the shared room flow and no round error is recorded.
- The winner has the lowest sum of errors across the three rounds. Equal totals result in a tie.

## Scene generation v1

Version 1 uses a prepared candy-jar visual template and a deterministic server-side placement generator. A scene contains 40–120 candies and 4–10 colors. Every generated color appears at least three times; remaining candies are distributed randomly. One present color is selected as the target.

The generator stores a private scene description, including object positions and the correct count. The SVG renderer only draws that description; it does not implement game rules. Scene coordinates use a normalized 0–1000 space.

Candies are placed bottom-up in staggered layers. The generator evaluates wall-adjacent positions before interior positions, and a new candy may cover no more than 30% of an already placed neighbor when it is used to form the jar contour. Candy size is derived from the total count, and the top 10–30% of the jar interior is left empty. Pairwise circle intersections approximate the 10–60% overlap target, with a lower 5% threshold permitted for outer-contour candies. Every candy must remain inside the jar, target candies must remain distinguishable, and no candy may be completely hidden. The SVG clipping path is a final visual safeguard, not the primary placement validator.

For local visual inspection, run the Vite app with `npm run dev -- --host 0.0.0.0` and open `/?no-count-it-generator=1`. The development-only preview allows a fixed candy count and seed.

## Multiplayer integration

The shared Multiplayer Core owns rooms, invitations, membership, common readiness and room presence. NoCountIt owns match and round state, answers, errors and results. After results are displayed, any member can return everyone to the room; otherwise the client automatically does so after 60 seconds.

The game screen is mounted by `src/menus/MultiplayerRoomMenu.tsx` with an existing room. It must not create or leave rooms, select games, change common readiness or implement a second room UI.

All deadlines and competitive outcomes are server-authoritative. Realtime events are invalidation notifications; clients reconcile through canonical game snapshots. Private scene metadata and the correct count are not returned to clients before the reveal phase.

## Infrastructure

The planned private Storage bucket is `no-count-it-scenes`. Scene SVGs are uploaded as `image/svg+xml`; short-lived signed URLs are issued only after the server verifies room membership. Scene files are retained for 24 hours after match completion and removed by a retry-safe cleanup process.

The game tables, trusted SQL RPCs, `no-count-it` Edge Function and private `no-count-it-scenes` bucket have been provisioned in Production. Browser access to game tables is revoked; game operations pass through the Telegram-authenticated Edge Function. The bucket is private, accepts only SVG files up to 1 MiB, and signed image URLs are issued for 10 minutes. The server writes a `delete_after` timestamp 24 hours after terminal match paths. Actual Storage object deletion is not yet scheduled, so files are not automatically removed at that deadline. A real player departure is handled separately from round-local not-ready exclusion: if exactly one player remains, that player is awarded the match; if multiple players remain, the match is cancelled because the shared room lifecycle resets the room. The currently connected remaining player sees the result. Reconnect after a full app restart is not yet guaranteed. The agreed 24-hour asset cleanup is not yet implemented.

# Democracy Merge

Democracy Merge — merge puzzle for one player or a match with friends.

## Version 1

- Board: 6×6 cells.
- Modes: solo and multiplayer matches for 2–4 players.
- Players build their own boards independently while sharing the match timeline and the server-generated character/obstacle sequences.
- Match results are based on score; detailed rules, tools, obstacles, economy, timing, history and UI behavior are specified in [V1-SPEC.md](./V1-SPEC.md).

The character images currently use temporary numbered placeholders (levels 1–6). They will be replaced when the final artwork is supplied.

## Development status

The V1 specification is agreed. The working branch includes the solo game, versioned local checkpoint/save/restore, absolute deadline handling, tools/shop/rewards, solo history and aggregates; and the multiplayer game, server-generated shared sequences, trusted start/snapshot/action/departure APIs, action reservations, revision/idempotency checks, disconnect/deadline jobs, private player state, match history and separate aggregate statistics. Both modes share local animation settings and basic placement/merge/obstacle animations; desktop zoom/drag and mobile pinch/scroll are implemented. The multiplayer catalog registration and both SQL migrations are prepared in the repository but are not applied to Production. Remaining work includes isolated-database execution, final V1 interaction/visual review (especially tool, purchase and transition animation polish), and real multi-device Telegram verification. Character icons remain numbered placeholders (levels 1–6); because there is currently one identity per level, the replace tool can consume a use without a visible icon change until character variants are supplied. A passing build is not a substitute for those checks.

There is no rematch feature. After a match, players can view its history or return to the main menu. A later match is started through the ordinary room flow.

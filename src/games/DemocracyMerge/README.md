# Democracy Merge

Democracy Merge — merge puzzle for one player or a match with friends.

## Version 1

- Board: 6×6 cells.
- Modes: solo and multiplayer matches for 2–4 players.
- Players build their own boards independently while sharing the match timeline and the server-generated character/obstacle sequences.
- Match results are based on score; detailed rules, tools, obstacles, economy, timing, history and UI behavior are specified in [V1-SPEC.md](./V1-SPEC.md).

The character images currently use temporary numbered placeholders (levels 1–6). They will be replaced when the final artwork is supplied.

## Development status

The V1 specification is agreed. The pure board/merge engine, initial tool-rule helpers, shop pricing and obstacle/reward generators are implemented with Deno unit tests. Solo rules, versioned local checkpoint/save-restore, 30-minute deadline handling, solo history/aggregates, and solo UI are implemented in the working branch. Multiplayer match persistence, trusted start/snapshot/action/leave endpoints, server-generated sequences, revision/idempotency handling, deadline/disconnect jobs and an initial match UI are also implemented. Remaining work includes full integration verification, history UX refinements, animation/settings polish, production migration/catalog registration and real multi-device testing; this README describes the target game, not a claim that the full game is implemented or deployed.

There is no rematch feature. After a match, players can view its history or return to the main menu. A later match is started through the ordinary room flow.

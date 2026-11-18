# Duel — implementation and development notes

## Scope
The Duel module contains shared pure combat rules, a shared board, a solo controller, a multiplayer controller, and standalone development pages. Multiplayer uses the deployed `duel` Edge Function and server-only PostgreSQL match storage. The server initializes a match only for an active two-player Duel room, accepts hidden choices and resolves an exchange atomically when both choices are present. The client polls server snapshots and displays the last authoritative result. The current implementation is **not production-ready**: Duel now calls the shared room start/finish lifecycle through the Edge Function, and uses a server-owned 15-second exchange deadline with random completion for missing player choices and a two-second delay after both choices are ready. The multiplayer choreography is still provisional, and parity tests between the SQL resolver and pure TypeScript engine are outstanding. The Edge Function sends private room-scoped notifications on match start, match completion, round resolution, and return to room; server snapshots remain authoritative. Full SQL/TypeScript parity verification remains outstanding. A Duel row is registered in `common_game_availability` with `is_solo_enabled=false` and `is_multiplayer_enabled=false`; only the user may activate these flags after publication. The room game rules restrict Duel to exactly two players and stay disabled until the user enables the multiplayer availability flag; a database trigger synchronizes the room rule on that change.

## Rules
- Two fighters, each starting a round with three HP.
- Four zones: head, chest, belly, legs.
- Each fighter selects two *distinct* actions from four attacks and four defenses. Attack and defense of the same zone are distinct actions and may coexist.
- All actions resolve simultaneously, independent of visual ordering.
- An attack into the opponent's defense reflects one damage to the attacker in the same zone, unless the attacker also defends that zone.
- Two attacks aimed at the same zone cancel each other (sword clash), taking priority over reflection.
- An unblocked attack deals one damage. Both fighters reaching zero in the same stage is a draw.
- A round ends on death; the first fighter to win two rounds wins the match. Simultaneous knockouts replay the same round without awarding a win.
- Solo opponent chooses two random distinct actions. Multiplayer selection and scoring must be server-authoritative.

## Animation planning
- Render unused defenses first.
- A shield-block precedes its reflected counterstrike.
- Show hits and health loss when animated; a fighter with one HP dies on their first received hit.
- Prefer the last strike to kill the losing fighter, or a synchronized final strike for mutual death.
- Decompose animation into primitives (raise/hold/lower shield, sword swing, shield impact, parry, hit reaction, fall).
- The current `planDuel` is an **initial scheduling draft**, not a verified choreography solver. It flags some scenarios for review and does not yet guarantee a feasible ordering for every selection/HP pair. In particular, multiple hits against a one-HP target, reflected-strike prerequisites, and mutual-death choreography require systematic testing and refinement.
- Never change the simultaneous combat result merely to simplify visual presentation.

## Integration rules
Read `src/ai-readme.md`, `src/games/ai-readme.md`, `src/multiplayer/ai-readme.md`, and `src/database/ai-readme.md` before integration. Reuse shared UI and pure combat logic between solo/multiplayer, but keep the multiplayer server authoritative. Do not duplicate room/ready/invite UI.

## Multiplayer transport (not yet enabled)
- `duelProtocol.ts` validates two distinct actions and carries room ID, match ID and exchange number. It never accepts client-computed HP, winner or score.
- `duelApi.ts` invokes the deployed `duel` Edge Function through the shared Database facade. `DuelMatch.tsx` parses server snapshots before displaying them. Backend deployment does not imply that the complete multiplayer lifecycle is playable.
- No availability flags are changed here; the user will enable solo and multiplayer manually after publication. Multiplayer manual testing is explicitly deferred until after merging to main and publication.

## Standalone test pages
- `/duel-play.html`: uninterrupted solo match against random opponent; automatic 15-second selection, two-second waiting phase, best-of-three rounds, draw replay. The current timeout behavior fills missing choices automatically, a provisional solo-only behavior.
- `/duel-prototype.html`: manual combat/choreography lab with arbitrary HP and actions; do not embed its debug controls in the routed game.
- Both pages import `duelEngine.ts`, `duelChoice.ts`, and `duelMatch.ts` as appropriate. These modules must remain independent of React and transport; future React game UI should share its presentation between modes, with distinct solo/server controllers.

## React preview
- `DuelSolo.tsx` + `DuelSolo.css` provide a dev-only React game screen, currently entered via `/?duel-preview=1` in `App.tsx`.
- Keep gameplay rules in `duelEngine`, `duelChoice`, `duelMatch`; do not copy the pure rules into the component.
- The same solo component is now routed from the availability-controlled solo menu. It remains hidden unless the database enables the game. This is not evidence of successful browser testing or multiplayer support.

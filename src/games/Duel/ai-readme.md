# Duel — AI development notes (prototype)

## Scope
This module now contains pure combat, shared selection/match state, a standalone solo play page (`/duel-play.html`), and a separate choreography lab (`/duel-prototype.html`); it is **not yet registered in Friend Battle menus**. A React solo preview is available in development at `/?duel-preview=1` through `DuelSolo.tsx`. No multiplayer Edge Function, database schema, production animations, or menu registration exists yet. The standalone page is for functional testing and is not a production integration. Do not enable it in game availability.

## Rules
- Two fighters, each starting a round with three HP.
- Four zones: head, chest, belly, legs.
- Each fighter selects two *distinct* actions from four attacks and four defenses. Attack and defense of the same zone are distinct actions and may coexist.
- All actions resolve simultaneously, independent of visual ordering.
- An attack into the opponent's defense reflects one damage to the attacker in the same zone, unless the attacker also defends that zone.
- Two attacks aimed at the same zone cancel each other (sword clash), taking priority over reflection.
- An unblocked attack deals one damage. Both fighters reaching zero in the same stage is a draw.
- A round ends on death; the intended match is best of three rounds, subject to final draw handling decisions.
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

## Standalone test pages
- `/duel-play.html`: uninterrupted solo match against random opponent; automatic 15-second selection, two-second waiting phase, best-of-three rounds, draw replay. The current timeout behavior fills missing choices automatically, a provisional solo-only behavior.
- `/duel-prototype.html`: manual combat/choreography lab with arbitrary HP and actions; do not embed its debug controls in the routed game.
- Both pages import `duelEngine.ts`, `duelChoice.ts`, and `duelMatch.ts` as appropriate. These modules must remain independent of React and transport; future React game UI should share its presentation between modes, with distinct solo/server controllers.

## React preview
- `DuelSolo.tsx` + `DuelSolo.css` provide a dev-only React game screen, currently entered via `/?duel-preview=1` in `App.tsx`.
- Keep gameplay rules in `duelEngine`, `duelChoice`, `duelMatch`; do not copy the pure rules into the component.
- This is a visual/functional preview, not evidence of successful browser testing, production routing, or multiplayer support.

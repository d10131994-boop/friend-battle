import { resolveDuel, type Action, type Resolution } from './duelEngine'

/**
 * Shared match state machine. No network calls or UI; multiplayer must apply
 * server-authoritative transitions rather than trust a browser-computed result.
 */
export type MatchState = {
  readonly wins: readonly [number, number]
  readonly health: readonly [number, number]
  readonly round: number
  readonly exchanges: number
  readonly finished: boolean
  readonly winner: 0 | 1 | null
}
export type MatchStep = {
  readonly match: MatchState
  readonly resolution: Resolution
  readonly roundResult: 'continue' | 'left' | 'right' | 'draw'
  readonly roundEnded: boolean
}
export const INITIAL_HEALTH = 3
export const WINS_TO_WIN = 2

export function newDuelMatch(): MatchState {
  return { wins: [0, 0], health: [INITIAL_HEALTH, INITIAL_HEALTH], round: 1, exchanges: 0, finished: false, winner: null }
}

export function advanceDuelMatch(state: MatchState, left: readonly Action[], right: readonly Action[]): MatchStep {
  if (state.finished) throw new Error('Match already finished')
  const resolution = resolveDuel(left, right, state.health)
  const roundResult = resolution.outcome
  const roundEnded = roundResult !== 'continue'
  const wins: [number, number] = [...state.wins]
  if (roundResult === 'left') wins[0]++
  if (roundResult === 'right') wins[1]++
  const winner = wins[0] >= WINS_TO_WIN ? 0 : wins[1] >= WINS_TO_WIN ? 1 : null
  const match: MatchState = {
    wins,
    health: roundEnded && winner === null ? [INITIAL_HEALTH, INITIAL_HEALTH] : resolution.healthAfter,
    // A simultaneous knockout replays the current round; neither fighter gets a win.
    round: state.round + (roundEnded && roundResult !== 'draw' && winner === null ? 1 : 0),
    exchanges: state.exchanges + 1,
    finished: winner !== null,
    winner,
  }
  return { match, resolution, roundResult, roundEnded }
}

import { advanceDuelMatch, newDuelMatch, type MatchState, type MatchStep } from './duelMatch.js'
import { parseDuelSelection } from './duelProtocol.js'
import type { Selection } from './duelEngine.js'

/**
 * Pure authoritative transition used by the trusted server.
 * Pending choices must remain server-private until both players submit.
 */
export type DuelServerState = {
  match: MatchState
  exchange: number
  pending: readonly [Selection | null, Selection | null]
}
export type DuelServerAdvance =
  | { status: 'waiting'; state: DuelServerState }
  | { status: 'resolved'; state: DuelServerState; step: MatchStep }

export function newDuelServerState(): DuelServerState {
  return { match: newDuelMatch(), exchange: 1, pending: [null, null] }
}

export function submitDuelServerChoice(
  state: DuelServerState,
  fighter: 0 | 1,
  exchange: number,
  rawChoice: unknown,
): DuelServerAdvance {
  if (state.match.finished) throw new Error('Match already finished')
  if (exchange !== state.exchange) throw new Error('Stale duel exchange')
  if (state.pending[fighter]) throw new Error('Choice already submitted')
  const choice = parseDuelSelection(rawChoice)
  const pending: [Selection | null, Selection | null] = [...state.pending]
  pending[fighter] = choice
  if (!pending[0] || !pending[1]) return { status: 'waiting', state: { ...state, pending } }
  const step = advanceDuelMatch(state.match, pending[0], pending[1])
  return { status: 'resolved', state: { match: step.match, exchange: exchange + 1, pending: [null, null] }, step }
}

import { ZONES, type Action, type Selection } from './duelEngine'

/**
 * Game-specific wire contract. Server responses are untrusted until parsed.
 * No client-computed score, HP or winner is ever sent as an action.
 */
export type DuelSubmitAction = {
  action: 'submit_choice'
  roomId: string
  matchId: string
  exchange: number
  choices: Selection
  initData: string
}
export type DuelSnapshotRequest = {
  action: 'get_match'
  roomId: string
  initData: string
}

export function parseDuelSelection(value: unknown): Selection {
  if (!Array.isArray(value) || value.length !== 2) throw new Error('Invalid duel selection length')
  const parsed: Action[] = value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid duel action')
    const a = item as Record<string, unknown>
    if ((a.kind !== 'attack' && a.kind !== 'defend') || !ZONES.some(zone => zone === a.zone))
      throw new Error('Invalid duel action')
    return { kind: a.kind, zone: a.zone as Action['zone'] }
  })
  if (parsed[0].kind === parsed[1].kind && parsed[0].zone === parsed[1].zone)
    throw new Error('Duplicate duel action')
  return [parsed[0], parsed[1]]
}

export function makeDuelSubmitAction(input: {
  roomId: string
  matchId: string
  exchange: number
  choices: readonly Action[]
  initData: string
}): DuelSubmitAction {
  if (!input.roomId.trim() || !input.matchId.trim() || !input.initData.trim()) throw new Error('Missing duel session identity')
  if (!Number.isSafeInteger(input.exchange) || input.exchange < 1) throw new Error('Invalid duel exchange')
  return { action: 'submit_choice', ...input, choices: parseDuelSelection(input.choices) }
}

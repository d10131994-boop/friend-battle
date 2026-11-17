import { ZONES, type Action, type Selection } from './duelEngine.js'

/** Shared between solo and multiplayer. This models only local input, never server authority. */
export const CHOICE_SECONDS = 15
export const WAIT_AFTER_BOTH_READY_MS = 2000

export type ChoiceState = {
  readonly selected: readonly Action[]
  readonly locked: boolean
}

export function sameAction(a: Action, b: Action): boolean {
  return a.kind === b.kind && a.zone === b.zone
}

export function toggleChoice(state: ChoiceState, action: Action): ChoiceState {
  if (state.locked) return state
  if (!['attack', 'defend'].includes(action.kind) || !ZONES.includes(action.zone)) return state
  const selected = state.selected.some(a => sameAction(a, action))
    ? state.selected.filter(a => !sameAction(a, action))
    : state.selected.length < 2 ? [...state.selected, action] : state.selected
  return { selected, locked: false }
}

export function lockChoice(state: ChoiceState): ChoiceState {
  if (state.selected.length !== 2) return state
  return { selected: state.selected as Selection, locked: true }
}

export function randomChoice(random: () => number = Math.random): Selection {
  const actions: Action[] = ZONES.flatMap(zone => [
    { kind: 'attack' as const, zone },
    { kind: 'defend' as const, zone },
  ])
  const first = Math.min(actions.length - 1, Math.max(0, Math.floor(random() * actions.length)))
  const remaining = actions.filter((_, index) => index !== first)
  const second = Math.min(remaining.length - 1, Math.max(0, Math.floor(random() * remaining.length)))
  return [actions[first], remaining[second]]
}

export function choiceRemainingSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.ceil((CHOICE_SECONDS * 1000 - Math.max(0, now - startedAt)) / 1000))
}

/** Solo timeout fallback. Preserve deliberate choices and fill only missing slots. */
export function completeChoice(state: ChoiceState, random: () => number = Math.random): ChoiceState {
  if (state.locked || state.selected.length === 2) return lockChoice(state)
  const pool: Action[] = ZONES.flatMap(zone => [
    { kind: 'attack' as const, zone },
    { kind: 'defend' as const, zone },
  ]).filter(action => !state.selected.some(selected => sameAction(selected, action)))
  const selected = [...state.selected]
  while (selected.length < 2) {
    const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
    selected.push(...pool.splice(index, 1))
  }
  return { selected: selected as Selection, locked: true }
}

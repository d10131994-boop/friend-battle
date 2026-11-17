import type { Action } from './duelEngine'
import { ZONES } from './duelEngine'
import type { ChoiceState } from './duelChoice'

export type DuelPose = { kind: 'attacking' | 'defending' | 'hit' | 'fallen' | ''; zone?: Action['zone'] }
const actions: Action[] = ZONES.flatMap(zone => [{ kind: 'attack' as const, zone }, { kind: 'defend' as const, zone }])
const zoneNames = { head: 'Голова', chest: 'Грудь', belly: 'Живот', legs: 'Ноги' }

type Props = {
  poses: readonly [DuelPose, DuelPose]
  choice: ChoiceState
  canChoose: boolean
  onChoose: (action: Action) => void
}

/** Shared, non-authoritative presentation for solo and future server-driven multiplayer. */
export default function DuelBoard({ poses, choice, canChoose, onChoose }: Props) {
  return <>
    <div className="duel-arena" aria-label="Арена дуэли">
      {poses.map((pose, i) => <div key={i} aria-label={i === 0 ? 'Ваш боец' : 'Противник'} className={['duel-fighter', i === 1 ? 'right' : '', pose.kind, pose.zone ? 'zone-' + pose.zone : ''].join(' ')}>
        <div className="duel-head" /><div className="duel-body" /><div className="duel-legs" /><div className="duel-shield" /><div className="duel-sword" />
      </div>)}
    </div>
    <div className="duel-choices">{actions.map(action => <button key={action.kind + action.zone} disabled={!canChoose} aria-pressed={choice.selected.some(selected => selected.kind === action.kind && selected.zone === action.zone)} className={choice.selected.some(selected => selected.kind === action.kind && selected.zone === action.zone) ? 'selected' : ''} onClick={() => onChoose(action)}>{action.kind === 'attack' ? '⚔' : '🛡'} {zoneNames[action.zone]}</button>)}</div>
  </>
}

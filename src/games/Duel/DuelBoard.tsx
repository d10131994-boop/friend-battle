import type { Action } from './duelEngine'
import type { DuelPose } from './duelPresentation'
import { ZONES } from './duelEngine'
import type { ChoiceState } from './duelChoice'

const actions: Action[] = ZONES.flatMap(zone => [{ kind: 'attack' as const, zone }, { kind: 'defend' as const, zone }])
const zoneNames = { head: 'Голова', chest: 'Грудь', belly: 'Живот', legs: 'Ноги' }

type Props = {
  poses: readonly [DuelPose, DuelPose]
  choice: ChoiceState
  canChoose: boolean
  onChoose: (action: Action) => void
  playerIndex?: 0 | 1
}

/** Shared, non-authoritative presentation for solo and future server-driven multiplayer. */
export default function DuelBoard({ poses, choice, canChoose, onChoose, playerIndex = 0 }: Props) {
  return <>
    <div className="duel-arena" aria-label="Арена дуэли">
      {poses.map((pose, i) => <div key={i} aria-label={i === playerIndex ? 'Ваш боец' : 'Противник'} className={['duel-fighter', i === 1 ? 'right' : '', pose.kind, pose.zone ? 'zone-' + pose.zone : ''].join(' ')}>
        <div className="duel-head" /><div className="duel-body" /><div className="duel-legs" /><div className="duel-shield" /><div className="duel-sword" />
      </div>)}
    </div>
    <div className="duel-choices">{actions.map(action => <button key={action.kind + action.zone} disabled={!canChoose} aria-pressed={choice.selected.some(selected => selected.kind === action.kind && selected.zone === action.zone)} className={choice.selected.some(selected => selected.kind === action.kind && selected.zone === action.zone) ? 'selected' : ''} onClick={() => onChoose(action)}>{action.kind === 'attack' ? '⚔' : '🛡'} {zoneNames[action.zone]}</button>)}</div>
  </>
}

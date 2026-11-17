import { useEffect, useRef, useState } from 'react'
import { planDuel } from './duelEngine'
import DuelBoard, { type DuelPose } from './DuelBoard'
import { CHOICE_SECONDS, WAIT_AFTER_BOTH_READY_MS, choiceRemainingSeconds, completeChoice, lockChoice, randomChoice, toggleChoice, type ChoiceState } from './duelChoice'
import { advanceDuelMatch, newDuelMatch, type MatchState } from './duelMatch'
import './DuelSolo.css'

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
type Phase = 'idle' | 'choice' | 'waiting' | 'combat' | 'intermission' | 'finished'

export default function DuelSolo({ onBack }: { onBack: () => void }) {
  const [match, setMatch] = useState<MatchState>(newDuelMatch)
  const [choice, setChoice] = useState<ChoiceState>({ selected: [], locked: false })
  const [phase, setPhase] = useState<Phase>('idle')
  const [remaining, setRemaining] = useState(CHOICE_SECONDS)
  const [message, setMessage] = useState('Начните новый матч')
  const [poses, setDuelPoses] = useState<[DuelPose, DuelPose]>([{ kind: '' }, { kind: '' }])
  const generation = useRef(0)
  const mounted = useRef(true)
  const choiceRef = useRef<ChoiceState>({ selected: [], locked: false })
  const matchRef = useRef(match)
  const phaseRef = useRef<Phase>('idle')
  const deadline = useRef(0)

  function setPhaseNow(next: Phase) { phaseRef.current = next; setPhase(next) }
  function setChoiceNow(next: ChoiceState) { choiceRef.current = next; setChoice(next) }
  function beginChoice() {
    if (!mounted.current || matchRef.current.finished) return
    setChoiceNow({ selected: [], locked: false })
    deadline.current = Date.now()
    setRemaining(CHOICE_SECONDS)
    setPhaseNow('choice')
    setMessage('Выберите два действия')
  }
  function newMatch() {
    generation.current++
    const initial = newDuelMatch()
    matchRef.current = initial
    setMatch(initial)
    setDuelPoses([{ kind: '' }, { kind: '' }])
    beginChoice()
  }
  async function submit() {
    if (phaseRef.current !== 'choice') return
    const id = generation.current
    const selection = completeChoice(choiceRef.current)
    setChoiceNow(lockChoice(selection))
    setPhaseNow('waiting')
    setMessage('Выбор принят. Противник готовится…')
    await wait(WAIT_AFTER_BOTH_READY_MS)
    if (id !== generation.current) return
    const opponent = randomChoice()
    const before = [...matchRef.current.health] as [number, number]
    const step = advanceDuelMatch(matchRef.current, selection.selected, opponent)
    matchRef.current = step.match
    setPhaseNow('combat')
    setMessage('Бой!')
    for (const beat of planDuel(step.resolution, before).beats) {
      if (id !== generation.current) return
      const next: [DuelPose, DuelPose] = [{ kind: '' }, { kind: '' }]
      if (beat.kind === 'unused-defense') next[beat.fighter] = { kind: 'defending', zone: beat.zone }
      if (beat.kind === 'clash') { next[0] = { kind: 'attacking', zone: beat.zone }; next[1] = { kind: 'attacking', zone: beat.zone } }
      if (beat.kind === 'shield-block') { next[beat.attacker] = { kind: 'attacking', zone: beat.zone }; next[beat.defender] = { kind: 'defending', zone: beat.zone } }
      if (beat.kind === 'strike') for (const hit of beat.hits) { next[hit.source] = { kind: 'attacking', zone: hit.zone }; next[hit.target] = { kind: 'hit' } }
      if (beat.kind === 'fall') for (const fighter of beat.fighters) next[fighter] = { kind: 'fallen' }
      setDuelPoses(next)
      await wait(beat.kind === 'fall' ? 650 : 520)
    }
    if (id !== generation.current) return
    setMatch(step.match)
    setPhaseNow(step.match.finished ? 'finished' : 'intermission')
    setMessage(step.match.finished ? (step.match.winner === 0 ? 'Вы выиграли матч!' : 'Противник выиграл матч!') : step.roundResult === 'draw' ? 'Ничья — переигровка раунда' : step.roundEnded ? 'Раунд завершён' : 'Обмен ударами завершён')
    if (!step.match.finished) { await wait(900); if (id === generation.current) beginChoice() }
  }
  useEffect(() => {
    if (phase !== 'choice') return
    const interval = window.setInterval(() => {
      const seconds = choiceRemainingSeconds(deadline.current, Date.now())
      setRemaining(seconds)
      if (seconds === 0) void submit()
    }, 100)
    return () => window.clearInterval(interval)
  }, [phase])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current++ }
  }, [])
  return <main className="duel-solo">
    <header><button onClick={onBack}>← Назад</button><h1>⚔ Дуэль</h1></header>
    <p className="duel-score">Раунд {match.round} · Победы {match.wins.join(' : ')} · HP {match.health.join(' : ')}</p>
    <DuelBoard poses={poses} choice={choice} canChoose={phase === 'choice'} onChoose={action => setChoiceNow(toggleChoice(choiceRef.current, action))} />
    <p className="duel-message" aria-live="polite">{message}</p>
    {phase === 'choice' && <p className="duel-timer">Осталось {remaining} сек.</p>}
    <div className="duel-controls"><button onClick={newMatch}>Новый матч</button><button disabled={phase !== 'choice' || choice.selected.length !== 2} onClick={() => void submit()}>Подтвердить</button></div>
  </main>
}

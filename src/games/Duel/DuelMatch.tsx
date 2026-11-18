import { useEffect, useMemo, useState } from 'react'
import type { MultiplayerRoom } from '../../multiplayer'
import { createDuelApi } from './duelApi'
import { toggleChoice, type ChoiceState } from './duelChoice'
import DuelBoard from './DuelBoard'
import type { DuelPose } from './duelPresentation'
import type { MatchState } from './duelMatch'
import './DuelSolo.css'

type Snapshot = {
  matchId: string
  exchange: number
  match: MatchState
  status: 'playing' | 'completed'
  yourChoiceSubmitted: boolean
  opponentReady: boolean
  fighter: 0 | 1
}

function parseSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('Некорректное состояние матча')
  const s = value as Record<string, unknown>
  if (typeof s.matchId !== 'string' || !Number.isSafeInteger(s.exchange) || (s.exchange as number) < 1 ||
      (s.fighter !== 0 && s.fighter !== 1) || (s.status !== 'playing' && s.status !== 'completed') ||
      typeof s.yourChoiceSubmitted !== 'boolean' || typeof s.opponentReady !== 'boolean' ||
      !s.match || typeof s.match !== 'object') throw new Error('Некорректное состояние матча')
  const m = s.match as Record<string, unknown>
  if (!Array.isArray(m.health) || m.health.length !== 2 || !m.health.every(x => Number.isInteger(x) && x >= 0 && x <= 3) ||
      !Array.isArray(m.wins) || m.wins.length !== 2 || !m.wins.every(x => Number.isInteger(x) && x >= 0) ||
      !Number.isSafeInteger(m.round) || typeof m.finished !== 'boolean' ||
      (m.winner !== null && m.winner !== 0 && m.winner !== 1)) throw new Error('Некорректное состояние боя')
  return s as Snapshot
}

export default function DuelMatch({ initData, room, onReturnToRoom }: {
  initData: string | undefined
  room: MultiplayerRoom
  onReturnToRoom: () => void
}) {
  const api = useMemo(() => initData ? createDuelApi(initData) : null, [initData])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [choice, setChoice] = useState<ChoiceState>({ selected: [], locked: false })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Подключаемся к матчу…')
  useEffect(() => {
    if (!api) { setMessage('Откройте игру через Telegram'); return }
    let alive = true
    const refresh = async () => {
      try {
        const next = parseSnapshot(await api.getMatch(room.roomId))
        if (!alive) return
        setSnapshot(previous => {
          if (previous && (previous.matchId !== next.matchId || previous.exchange !== next.exchange))
            setChoice({ selected: [], locked: false })
          return next
        })
        setMessage(next.status === 'completed' ? 'Матч завершён' : next.yourChoiceSubmitted ? 'Ожидаем соперника…' : 'Выберите два действия')
      } catch (error) {
        if (alive) setMessage(error instanceof Error ? error.message : 'Не удалось получить матч')
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 1500)
    return () => { alive = false; window.clearInterval(timer) }
  }, [api, room.roomId])
  async function submit() {
    if (!api || !snapshot || choice.selected.length !== 2 || busy || snapshot.yourChoiceSubmitted) return
    setBusy(true)
    try {
      await api.submitChoice({ roomId: room.roomId, matchId: snapshot.matchId, exchange: snapshot.exchange, choices: choice.selected })
      setChoice(current => ({ ...current, locked: true }))
      setMessage('Выбор принят. Ожидаем соперника…')
      setSnapshot(current => current ? { ...current, yourChoiceSubmitted: true } : current)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось подтвердить выбор')
    } finally { setBusy(false) }
  }
  const poses: [DuelPose, DuelPose] = [{ kind: '' }, { kind: '' }]
  const canChoose = Boolean(snapshot && snapshot.status === 'playing' && !snapshot.yourChoiceSubmitted && !busy)
  return <main className="duel-solo">
    <header><button onClick={onReturnToRoom}>← Комната</button><h1>⚔ Дуэль</h1></header>
    {snapshot && <p className="duel-score">Раунд {snapshot.match.round} · Победы {snapshot.match.wins.join(' : ')} · HP {snapshot.match.health.join(' : ')}</p>}
    <DuelBoard poses={poses} choice={choice} canChoose={canChoose} onChoose={action => setChoice(current => toggleChoice(current, action))} />
    <p className="duel-message" aria-live="polite">{message}</p>
    <div className="duel-controls"><button disabled={!canChoose || choice.selected.length !== 2} onClick={() => void submit()}>Подтвердить</button></div>
  </main>
}

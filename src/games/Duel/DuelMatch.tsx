import { useEffect, useMemo, useRef, useState } from 'react'
import type { MultiplayerRoom } from '../../multiplayer'
import { createDuelApi } from './duelApi'
import { toggleChoice, type ChoiceState } from './duelChoice'
import DuelBoard from './DuelBoard'
import { posesForBeat, type DuelPose } from './duelPresentation'
import { planDuel, ZONES, type Resolution } from './duelEngine'
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
  lastResult: { exchange: number; roundResult: 'continue' | 'left' | 'right' | 'draw'; resolution: Resolution } | null
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
  if (s.lastResult != null) {
    if (typeof s.lastResult !== 'object' || Array.isArray(s.lastResult)) throw new Error('Некорректный результат боя')
    const result = s.lastResult as Record<string, unknown>
    const resolution = result.resolution as Record<string, unknown> | null
    if (!Number.isSafeInteger(result.exchange) ||
        !['continue', 'left', 'right', 'draw'].includes(String(result.roundResult)) ||
        !resolution || !Array.isArray(resolution.hits) || !Array.isArray(resolution.clashes) || !Array.isArray(resolution.blocks) ||
        !resolution.hits.every(hit => hit && (hit.source === 0 || hit.source === 1) && (hit.target === 0 || hit.target === 1) && ZONES.includes(hit.zone) && typeof hit.reflected === 'boolean') ||
        !resolution.clashes.every(clash => clash && ZONES.includes(clash.zone)) ||
        !resolution.blocks.every(block => block && (block.attacker === 0 || block.attacker === 1) && (block.defender === 0 || block.defender === 1) && ZONES.includes(block.zone)) ||
        !Array.isArray(resolution.damage) || resolution.damage.length !== 2 ||
        !resolution.damage.every(x => Number.isInteger(x) && x >= 0 && x <= 2) ||
        !Array.isArray(resolution.healthAfter) || resolution.healthAfter.length !== 2 ||
        !resolution.healthAfter.every(x => Number.isInteger(x) && x >= 0 && x <= 3))
      throw new Error('Некорректный результат боя')
  }
  return s as Snapshot
}

export default function DuelMatch({ initData, room, onReturnToRoom, startRequested, onStartRequestHandled, onRoomUpdate }: {
  initData: string | undefined
  room: MultiplayerRoom
  onReturnToRoom: () => void
  startRequested: boolean
  onStartRequestHandled: () => void
  onRoomUpdate: (room: MultiplayerRoom) => void
}) {
  const api = useMemo(() => initData ? createDuelApi(initData) : null, [initData])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [choice, setChoice] = useState<ChoiceState>({ selected: [], locked: false })
  const [busy, setBusy] = useState(false)
  const exchangeRef = useRef<string | null>(null)
  const animatedExchangeRef = useRef<string | null>(null)
  const [poses, setPoses] = useState<[DuelPose, DuelPose]>([{ kind: '' }, { kind: '' }])
  const [displayHealth, setDisplayHealth] = useState<readonly [number, number] | null>(null)
  const [animating, setAnimating] = useState(false)
  const [message, setMessage] = useState('Подключаемся к матчу…')
  useEffect(() => {
    if (!startRequested) return
    onStartRequestHandled()
    if (!api) { setMessage('Откройте игру через Telegram'); return }
    let active = true
    setBusy(true)
    void api.startMatch(room.roomId).then(value => {
      if (!active) return
      const response = value as { room?: MultiplayerRoom }
      if (response?.room) onRoomUpdate(response.room)
    }).catch(error => {
      if (active) setMessage(error instanceof Error ? error.message : 'Не удалось начать матч')
    }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [api, startRequested, room.roomId, onRoomUpdate, onStartRequestHandled])
  async function finishAndReturn() {
    if (!api || busy) return
    setBusy(true)
    try {
      const value = await api.returnToRoom(room.roomId) as { room?: MultiplayerRoom }
      if (value?.room) onRoomUpdate(value.room)
      onReturnToRoom()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось завершить матч')
    } finally { setBusy(false) }
  }
  useEffect(() => {
    if (!api) { setMessage('Откройте игру через Telegram'); return }
    let alive = true
    const refresh = async () => {
      try {
        const next = parseSnapshot(await api.getMatch(room.roomId))
        if (!alive) return
        const exchangeKey = next.matchId + ':' + next.exchange
        if (exchangeRef.current !== exchangeKey) {
          exchangeRef.current = exchangeKey
          setChoice({ selected: [], locked: false })
        }
        setSnapshot(next)
        setMessage(next.status === 'completed' ? 'Матч завершён' : next.yourChoiceSubmitted ? 'Ожидаем соперника…' : 'Выберите два действия')
      } catch (error) {
        if (alive) setMessage(error instanceof Error ? error.message : 'Не удалось получить матч')
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 1500)
    return () => { alive = false; window.clearInterval(timer) }
  }, [api, room.roomId])
  useEffect(() => {
    if (!snapshot?.lastResult) return
    const result = snapshot.lastResult
    const key = snapshot.matchId + ':' + result.exchange
    if (animatedExchangeRef.current === key) return
    animatedExchangeRef.current = key
    let cancelled = false
    const before: [number, number] = [
      Math.min(3, result.resolution.healthAfter[0] + result.resolution.damage[0]),
      Math.min(3, result.resolution.healthAfter[1] + result.resolution.damage[1]),
    ]
    const animated: [number, number] = [...before]
    setDisplayHealth(before)
    setAnimating(true)
    const run = async () => {
      for (const beat of planDuel({ ...result.resolution, unusedDefenses: result.resolution.unusedDefenses ?? [] }, before).beats) {
        if (cancelled) return
        setPoses([...posesForBeat(beat)])
        if (beat.kind === 'strike') {
          for (const hit of beat.hits) animated[hit.target] = Math.max(0, animated[hit.target] - 1)
          setDisplayHealth([...animated])
        }
        await new Promise(resolve => window.setTimeout(resolve, beat.kind === 'fall' ? 650 : 520))
      }
      if (!cancelled) {
        setPoses([{ kind: '' }, { kind: '' }])
        setDisplayHealth(null)
        setAnimating(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [snapshot?.matchId, snapshot?.lastResult?.exchange])
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
  const canChoose = Boolean(snapshot && snapshot.status === 'playing' && !snapshot.yourChoiceSubmitted && !busy && !choice.locked && !animating)
  const lastResult = snapshot?.lastResult
  const winner = snapshot?.match.winner
  const finishedMessage = winner === snapshot?.fighter ? 'Вы выиграли матч!' : winner === null || winner === undefined ? 'Матч завершён' : 'Противник выиграл матч!'
  return <main className="duel-solo">
    <header><button onClick={onReturnToRoom}>← Комната</button><h1>⚔ Дуэль</h1></header>
    {snapshot && <p className="duel-score">Раунд {snapshot.match.round} · Победы {snapshot.match.wins.join(' : ')} · HP {(displayHealth ?? snapshot.match.health).join(' : ')}</p>}
    <DuelBoard poses={poses} choice={choice} canChoose={canChoose} onChoose={action => setChoice(current => toggleChoice(current, action))} />
    {lastResult && <p className="duel-message">Последний обмен №{lastResult.exchange}: урон {lastResult.resolution.damage.join(' : ')} · {lastResult.roundResult === 'draw' ? 'Ничья' : lastResult.roundResult === 'continue' ? 'Бой продолжается' : 'Раунд завершён'}</p>}
    <p className="duel-message" aria-live="polite">{snapshot?.status === 'completed' ? finishedMessage : message}</p>
    <div className="duel-controls">
      {snapshot?.status === 'completed'
        ? <button disabled={busy} onClick={() => void finishAndReturn()}>Вернуться в комнату</button>
        : <button disabled={!canChoose || choice.selected.length !== 2} onClick={() => void submit()}>Подтвердить</button>}
    </div>
  </main>
}

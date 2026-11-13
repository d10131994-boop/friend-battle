import { useCallback, useEffect, useRef, useState } from 'react'
import { database } from '../../database'
import { telegramInitData } from '../../services/telegram'

type SoloSession = {
  sessionId: string
  startedAt: string
  score: number
  completed: boolean
  roundsPlayed: number
  best: number | null
}
type RecordRow = { telegram_id: string; username: string; score: number }
type Props = { onBack: () => void }

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Ошибка соединения с сервером'
}

export default function ReactionRushSolo({ onBack }: Props) {
  const [session, setSession] = useState<SoloSession | null>(null)
  const [remaining, setRemaining] = useState(10)
  const [best, setBest] = useState(0)
  const [rounds, setRounds] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [leaderboard, setLeaderboard] = useState<RecordRow[]>([])
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const finishRequested = useRef<string | null>(null)
  const mounted = useRef(true)

  const invoke = useCallback(async <T,>(action: string, extra: Record<string, unknown> = {}) => {
    return database.invokeFunction<T, Record<string, unknown>>('reaction-rush', {
      action, initData: telegramInitData ?? '', ...extra,
    })
  }, [])

  useEffect(() => {
    mounted.current = true
    void invoke<{ best: number; roundsPlayed: number }>('solo_enter')
      .then((data) => {
        if (mounted.current) {
          setBest(data.best)
          setRounds(data.roundsPlayed)
        }
      })
      .catch((error: unknown) => { if (mounted.current) setMessage(messageOf(error)) })
      .finally(() => { if (mounted.current) setLoading(false) })
    return () => { mounted.current = false }
  }, [invoke])

  useEffect(() => {
    if (!session || session.completed) return
    const endAt = Date.parse(session.startedAt) + 10_000
    const update = () => setRemaining(Math.max(0, Math.ceil((endAt - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [session?.sessionId, session?.startedAt, session?.completed])

  const finish = useCallback(async (id: string) => {
    try {
      const result = await invoke<SoloSession>('solo_finish', { sessionId: id })
      if (mounted.current) {
        setSession(result)
        setBest(result.best ?? 0)
        setRounds(result.roundsPlayed)
        setMessage('')
      }
    } catch (error) {
      if (mounted.current) {
        setMessage(messageOf(error))
        finishRequested.current = null
      }
    }
  }, [invoke])

  useEffect(() => {
    if (!session || session.completed || remaining > 0) return
    if (finishRequested.current === session.sessionId) return
    finishRequested.current = session.sessionId
    void finish(session.sessionId)
  }, [session, remaining, finish])

  async function start() {
    setLoading(true)
    setMessage('')
    try {
      const result = await invoke<SoloSession>('solo_start')
      setSession(result)
      setRemaining(10)
      finishRequested.current = null
    } catch (error) {
      setMessage(messageOf(error))
    } finally {
      setLoading(false)
    }
  }

  async function tap() {
    if (!session || session.completed || remaining <= 0) return
    try {
      const result = await invoke<SoloSession>('solo_tap', { sessionId: session.sessionId })
      setSession((current) => current?.sessionId === result.sessionId && !current.completed
        ? { ...current, score: Math.max(current.score, result.score) } : current)
    } catch (error) {
      setMessage(messageOf(error))
    }
  }

  async function loadLeaderboard() {
    setLoading(true)
    try {
      const result = await invoke<{ leaderboard: RecordRow[] }>('leaderboard')
      setLeaderboard(result.leaderboard)
      setShowLeaderboard(true)
    } catch (error) {
      setMessage(messageOf(error))
    } finally {
      setLoading(false)
    }
  }

  const playing = !!session && !session.completed
  return (
    <main className="app">
      <header className="topbar">
        <button className="leaderboard-button" onClick={onBack} disabled={playing}>← Назад</button>
        <div className="logo">FRIEND <span>BATTLE</span></div>
      </header>
      <section className="hero">
        <div className="eyebrow">ОДИНОЧНАЯ ИГРА</div>
        <div className="game-icon">⚡</div>
        <h1>REACTION<br /><span>RUSH</span></h1>
        <p>Один раунд, 10 секунд. Набери максимум очков!</p>
      </section>
      <section className="stats">
        <div className="stat-card"><span>⚡</span><div><small>ТВОИ ОЧКИ</small><strong>{session?.score ?? 0}</strong></div></div>
        <div className="stat-card"><span>⏱️</span><div><small>ОСТАЛОСЬ</small><strong>{playing ? remaining : 10}</strong></div></div>
      </section>
      <section className="game-card">
        {playing ? (
          <button className="play-button" onClick={() => void tap()} disabled={remaining <= 0}>ЖМИ! ⚡</button>
        ) : session?.completed ? (
          <>
            <h2>РАУНД ЗАВЕРШЁН</h2>
            <p>Твой результат: <strong>{session.score}</strong></p>
            <p>Личный рекорд: <strong>{best}</strong></p>
            <p>Сыграно раундов: <strong>{rounds}</strong></p>
            <button className="play-button" onClick={() => void start()} disabled={loading}>ИГРАТЬ ЕЩЁ</button>
            <button className="invite-button" onClick={onBack}>ВЕРНУТЬСЯ В МЕНЮ</button>
          </>
        ) : (
          <>
            <p>Личный рекорд: <strong>{best}</strong> · Сыграно: <strong>{rounds}</strong></p>
            <button className="play-button" onClick={() => void start()} disabled={loading}>
              {loading ? 'ПОДКЛЮЧЕНИЕ...' : 'НАЧАТЬ ИГРУ'}
            </button>
          </>
        )}
      </section>
      <button className="leaderboard-button" onClick={() => void loadLeaderboard()} disabled={loading}>
        🏆 РЕКОРДЫ REACTION RUSH
      </button>
      {showLeaderboard && (
        <section className="game-card">
          <h2>ТОП-10 REACTION RUSH</h2>
          {leaderboard.length === 0 && <p>Рекордов пока нет.</p>}
          {leaderboard.map((row, index) => (
            <p key={row.telegram_id}>{index + 1}. {row.username} — <strong>{row.score}</strong></p>
          ))}
          <button className="invite-button" onClick={() => setShowLeaderboard(false)}>ЗАКРЫТЬ</button>
        </section>
      )}
      {message && <section className="game-card" role="alert"><p>{message}</p></section>}
    </main>
  )
}

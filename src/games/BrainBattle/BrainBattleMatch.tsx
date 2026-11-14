import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { database } from '../../database'
import type { MultiplayerRoom } from '../../multiplayer'
import { telegramUser } from '../../services/telegram'

type BrainBattleQuestion = {
  id: number
  category: 'logic' | 'math' | 'attention' | 'general'
  question: string
  answers: string[]
}
type BrainBattlePlayerResult = {
  userId: string
  displayName: string
  score: number
  correctAnswers: number
  incorrectAnswers: number
  skippedQuestions: number
  answeredCurrentQuestion: boolean
  isWinner?: boolean
}
type BrainBattleMatchState = {
  matchId: string
  startedAt: string
  completedAt: string | null
  status: 'playing' | 'completed'
  currentQuestionIndex: number
  questionStartedAt: string
  questionEndsAt: string
  currentQuestion: BrainBattleQuestion | null
  players: BrainBattlePlayerResult[]
  myAnswerSubmitted: boolean
  finalResults: BrainBattlePlayerResult[] | null
  winnerUserId: string | null
}
type BrainBattleSnapshot = { room: MultiplayerRoom; match: BrainBattleMatchState | null }

type Props = {
  initData: string | undefined
  room: MultiplayerRoom
  startRequested: boolean
  onRoomUpdate: (room: MultiplayerRoom) => void
  onReturnToRoom: () => void
  onStartRequestHandled: () => void
}
function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export default function BrainBattleMatch({
  initData, room, startRequested, onRoomUpdate, onReturnToRoom, onStartRequestHandled,
}: Props) {
  const auth = useMemo(() => ({ initData: initData ?? '' }), [initData])
  const [match, setMatch] = useState<BrainBattleMatchState | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [remaining, setRemaining] = useState(15)
  const [questionStarted, setQuestionStarted] = useState(false)
  const startAttemptRef = useRef(false)
  const telegramId = telegramUser?.id ? String(telegramUser.id) : ''

  const invokeGame = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    return database.invokeFunction<T, Record<string, unknown>>('brain-battle', {
      ...body, initData: auth.initData,
    })
  }, [auth.initData])

  const refreshMatch = useCallback(async () => {
    const snapshot = await invokeGame<BrainBattleSnapshot>({ action: 'get_match', roomId: room.roomId })
    onRoomUpdate(snapshot.room)
    setMatch(snapshot.match)
  }, [room.roomId, invokeGame, onRoomUpdate])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refreshMatch().catch((error: unknown) => setMessage(getErrorMessage(error, 'Не удалось обновить состояние матча.')))
    }, 0)
    const timer = window.setInterval(() => {
      void refreshMatch().catch((error: unknown) => setMessage(getErrorMessage(error, 'Не удалось обновить состояние матча.')))
    }, 1200)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(timer)
    }
  }, [refreshMatch])

  useEffect(() => {
    if (!match || match.status !== 'playing' || room.status !== 'playing') return
    const startAt = Date.parse(match.questionStartedAt)
    const endAt = Date.parse(match.questionEndsAt)
    const update = () => {
      const now = Date.now()
      setQuestionStarted(now >= startAt)
      setRemaining(now < startAt ? 15 : Math.max(0, Math.ceil((endAt - now) / 1000)))
    }
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [match?.matchId, match?.currentQuestionIndex, match?.questionEndsAt, match?.status, room.status])

  const startMatch = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const started = await invokeGame<{
        matchId: string
        currentQuestionIndex: number
        questionStartedAt: string
        questionEndsAt: string
        room: MultiplayerRoom
      }>({ action: 'start_match', roomId: room.roomId })
      setRemaining(15)
      onRoomUpdate(started.room)
      await refreshMatch()
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось начать матч.'))
      onReturnToRoom()
    } finally {
      setLoading(false)
      onStartRequestHandled()
    }
  }, [invokeGame, room.roomId, onRoomUpdate, refreshMatch, onReturnToRoom, onStartRequestHandled])

  const me = room.players.find((player) => player.userId === telegramId)
  useEffect(() => {
    if (!startRequested || !me?.isHost || room.status === 'playing' || startAttemptRef.current) return
    startAttemptRef.current = true
    void startMatch()
  }, [startRequested, me?.isHost, room.status, startMatch])

  async function submitAnswer(answerIndex: number) {
    if (!match || match.status !== 'playing' || match.myAnswerSubmitted || remaining <= 0) return
    setLoading(true)
    setMessage('')
    try {
      await invokeGame({
        action: 'submit_answer', roomId: room.roomId, matchId: match.matchId,
        questionIndex: match.currentQuestionIndex, selectedAnswer: answerIndex,
      })
      await refreshMatch()
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось отправить ответ.'))
      await refreshMatch().catch(() => undefined)
    } finally {
      setLoading(false)
    }
  }

  const questionIsLive = Boolean(
    match?.status === 'playing' && room.status === 'playing' &&
    questionStarted && remaining > 0,
  )
  const finishAndReturn = useCallback(async () => {
    if (room.status !== 'playing') {
      onReturnToRoom()
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const response = await invokeGame<{ room: MultiplayerRoom }>({ action: 'return_to_room', roomId: room.roomId })
      onRoomUpdate(response.room)
      onReturnToRoom()
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось вернуться в комнату.'))
    } finally {
      setLoading(false)
    }
  }, [invokeGame, room.status, room.roomId, onRoomUpdate, onReturnToRoom])

  useEffect(() => {
    if (!match || match.status !== 'completed' || room.status !== 'playing' || !match.completedAt) return
    const completedAt = Date.parse(match.completedAt)
    if (!Number.isFinite(completedAt)) return
    const delay = Math.max(0, completedAt + 60_000 - Date.now())
    const timer = window.setTimeout(() => { void finishAndReturn() }, delay)
    return () => window.clearTimeout(timer)
  }, [match?.matchId, match?.status, match?.completedAt, room.status, finishAndReturn])

  const results = match?.finalResults ?? []

  return (
    <main className="app">
      <header className="topbar">
        <div className="logo">BRAIN <span>BATTLE</span></div>
        <div className="player-level">МУЛЬТИПЛЕЕР</div>
      </header>
      <section className="hero">
        <div className="eyebrow">BRAIN BATTLE</div>
        <div className="game-icon">🧠</div>
        <h1>ИНТЕЛЛЕКТУАЛЬНАЯ<br /><span>БИТВА</span></h1>
        <p>10 вопросов · 15 секунд на ответ</p>
      </section>

      {match?.status === 'completed' && (
        <section className="game-card">
          <h2>БИТВА ЗАВЕРШЕНА</h2>
          {results.map((result) => (
            <p key={result.userId}>{result.isWinner || result.userId === match.winnerUserId ? '🏆 ' : ''}{result.displayName}: <strong>{result.score}</strong> очков</p>
          ))}
          <p>{'Каждый игрок с максимальным количеством очков получает победу в статистике комнаты.'}</p>
          <p>Если не вернуться вручную, через минуту после завершения матча вы автоматически вернётесь в комнату.</p>
          <button className="play-button" onClick={() => void finishAndReturn()} disabled={loading}>ВЕРНУТЬСЯ В КОМНАТУ</button>
        </section>
      )}

      {match?.status === 'playing' && room.status === 'playing' && (
        <>
          <section className="stats">
            <div className="stat-card"><span>⚡</span><div><small>ТВОИ ОЧКИ</small><strong>{match.players.find((player) => player.userId === telegramId)?.score ?? 0}</strong></div></div>
            <div className="stat-card"><span>⏱️</span><div><small>ОСТАЛОСЬ</small><strong>{remaining}</strong></div></div>
            <div className="stat-card"><span>🧩</span><div><small>ВОПРОС</small><strong>{match.currentQuestionIndex + 1} / 10</strong></div></div>
          </section>
          <section className="game-card">
            <h2>СЧЁТ МАТЧА</h2>
            {match.players.map((player) => (
              <div className="brain-room-player" key={player.userId}>
                <span>{player.displayName}{player.userId === telegramId ? ' (ты)' : ''}</span><strong>{player.score}</strong>
              </div>
            ))}
          </section>
          {match.currentQuestion && (
            <section className="game-card">
              <div className="eyebrow">{match.currentQuestion.category.toUpperCase()}</div>
              <h2>{match.currentQuestion.question}</h2>
              {questionIsLive && !match.myAnswerSubmitted && (
                <div className="brain-answer-options">
                  {match.currentQuestion.answers.map((answer, index) => (
                    <button key={index} className="primary-button" onClick={() => void submitAnswer(index)} disabled={loading}>
                      {String.fromCharCode(65 + index)}. {answer}
                    </button>
                  ))}
                </div>
              )}
              {match.myAnswerSubmitted && <div className="brain-answer-waiting"><h2>✓ Ответ принят!</h2><p>Ожидаем остальных игроков…</p></div>}
              {!match.myAnswerSubmitted && remaining === 0 && <div><h2>Время вышло!</h2><p>Ожидаем завершения вопроса...</p></div>}
              {!questionIsLive && remaining > 0 && <p>Приготовься! Вопрос скоро начнётся.</p>}
            </section>
          )}
        </>
      )}

      {!match && <section className="game-card"><p>{loading ? 'Запускаем матч...' : 'Подключаемся к матчу...'}</p></section>}
      {message && <section className="game-card" role="alert"><p>{message}</p></section>}
    </main>
  )
}

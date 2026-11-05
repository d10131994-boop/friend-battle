import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { database } from '../../database'
import type { MultiplayerRoom } from '../../multiplayer'
import { telegramUser } from '../../services/telegram'

type ReactionRushResult = { userId: string; displayName: string; score: number }
type ReactionRushMatchState = {
  matchId: string
  roundNumber: number
  roundStartedAt: string
  startedAt: string
  status: 'playing' | 'completed'
  myScore: number
  finalResults?: ReactionRushResult[] | null
  winnerUserId?: string | null
}
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

export default function ReactionRushMatch({
  initData, room, startRequested, onRoomUpdate, onReturnToRoom, onStartRequestHandled,
}: Props) {
  const auth = useMemo(() => ({ initData: initData ?? '' }), [initData])
  const [match, setMatch] = useState<ReactionRushMatchState | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [remaining, setRemaining] = useState(10)
  const [myScore, setMyScore] = useState(0)
  const [roundResults, setRoundResults] = useState<ReactionRushResult[]>([])
  const [leaderboard, setLeaderboard] = useState<Array<{
    user_id: string
    display_name: string
    wins: number
    matches_played: number
    total_taps: number
    best_match_score: number
  }>>([])
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const finishRequestedRef = useRef<string | null>(null)
  const startAttemptRef = useRef(false)
  const telegramId = telegramUser?.id ? String(telegramUser.id) : ''

  const invokeGame = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    return database.invokeFunction<T, Record<string, unknown>>('reaction-rush', {
      ...body, initData: auth.initData,
    })
  }, [auth.initData])

  const refreshMatch = useCallback(async () => {
    const response = await invokeGame<{ room: MultiplayerRoom; match: ReactionRushMatchState | null }>({
      action: 'get_match', roomId: room.roomId,
    })
    onRoomUpdate(response.room)
    setMatch(response.match)
    if (response.match?.status === 'playing') setMyScore(response.match.myScore ?? 0)
  }, [room.roomId, invokeGame, onRoomUpdate])

  useEffect(() => {
    void refreshMatch().catch((error: unknown) => setMessage(getErrorMessage(error, 'Не удалось обновить состояние матча.')))
    const timer = window.setInterval(() => {
      void refreshMatch().catch((error: unknown) => setMessage(getErrorMessage(error, 'Не удалось обновить состояние матча.')))
    }, 1200)
    return () => window.clearInterval(timer)
  }, [refreshMatch])

  useEffect(() => {
    if (!match || match.status !== 'playing' || room.status !== 'playing') return
    const endAt = Date.parse(match.roundStartedAt) + 10_000
    const update = () => setRemaining(Math.max(0, Math.ceil((endAt - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [match?.matchId, match?.roundNumber, match?.roundStartedAt, match?.status, room.status])

  const startMatch = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const started = await invokeGame<{
        matchId: string; roundNumber: number; roundStartedAt: string; room: MultiplayerRoom
      }>({ action: 'start_match', roomId: room.roomId })
      setRoundResults([])
      setMyScore(0)
      setRemaining(10)
      finishRequestedRef.current = null
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

  useEffect(() => {
    if (!match || match.status !== 'playing' || room.status !== 'playing' || remaining > 0) return
    const requestKey = match.matchId + ':' + match.roundNumber
    if (finishRequestedRef.current === requestKey) return
    finishRequestedRef.current = requestKey
    void invokeGame<{
      roundResults: ReactionRushResult[]
      roundNumber?: number
      roundStartedAt?: string
      matchFinished: boolean
      finalResults?: ReactionRushResult[]
      winnerUserId?: string | null
      room?: MultiplayerRoom
    }>({
      action: 'finish_round', roomId: room.roomId, matchId: match.matchId, roundNumber: match.roundNumber,
    }).then((response) => {
      setRoundResults(response.roundResults ?? [])
      if (response.matchFinished) {
        setMatch({ ...match, status: 'completed', finalResults: response.finalResults ?? [], winnerUserId: response.winnerUserId ?? null })
        if (response.room) onRoomUpdate(response.room)
      } else if (response.roundNumber && response.roundStartedAt) {
        setMatch({ ...match, roundNumber: response.roundNumber, roundStartedAt: response.roundStartedAt, myScore: 0 })
        setMyScore(0)
        setRemaining(10)
      }
    }).catch((error: unknown) => {
      void refreshMatch().catch(() => setMessage(getErrorMessage(error, 'Не удалось завершить раунд.')))
    })
  }, [match, room, remaining, invokeGame, onRoomUpdate, refreshMatch])

  async function loadLeaderboard() {
    setLoading(true)
    try {
      const response = await invokeGame<{ leaderboard: typeof leaderboard }>({ action: 'leaderboard' })
      setLeaderboard(response.leaderboard ?? [])
      setShowLeaderboard(true)
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось загрузить лидерборд.'))
    } finally {
      setLoading(false)
    }
  }

  async function tap() {
    if (!match || match.status !== 'playing' || room.status !== 'playing' || remaining <= 0) return
    try {
      const response = await invokeGame<{ score: number }>({
        action: 'tap', roomId: room.roomId, matchId: match.matchId, roundNumber: match.roundNumber,
      })
      setMyScore((current) => Math.max(current, response.score))
    } catch (error) {
      setMessage(getErrorMessage(error, 'Нажатие не засчитано.'))
    }
  }

  const finalResults = match?.status === 'completed' ? match.finalResults ?? [] : []

  return (
    <main className="app">
      <header className="topbar">
        <div className="logo">FRIEND <span>BATTLE</span></div>
        <div className="player-level">МУЛЬТИПЛЕЕР</div>
      </header>
      <section className="hero">
        <div className="eyebrow">REACTION RUSH</div>
        <div className="game-icon">⚡</div>
        <h1>REACTION<br /><span>RUSH</span></h1>
        <p>Три раунда по 10 секунд. Жми быстрее соперников!</p>
      </section>

      {match?.status === 'playing' && room.status === 'playing' && (
        <>
          <section className="stats">
            <div className="stat-card"><span>⚡</span><div><small>ТВОИ ОЧКИ</small><strong>{myScore}</strong></div></div>
            <div className="stat-card"><span>⏱️</span><div><small>ОСТАЛОСЬ</small><strong>{remaining}</strong></div></div>
            <div className="stat-card"><span>🔁</span><div><small>РАУНД</small><strong>{match.roundNumber} / 3</strong></div></div>
          </section>
          {roundResults.length > 0 && (
            <section className="game-card">
              <h2>РЕЗУЛЬТАТЫ РАУНДА</h2>
              {roundResults.map((result) => <p key={result.userId}>{result.displayName}: <strong>{result.score}</strong></p>)}
            </section>
          )}
          <section className="game-card">
            <button className="play-button" onClick={() => void tap()} disabled={remaining <= 0 || loading}>ЖМИ! ⚡</button>
          </section>
        </>
      )}

      {match?.status === 'completed' && (
        <section className="game-card">
          <h2>МАТЧ ЗАВЕРШЁН</h2>
          {finalResults.map((result) => (
            <p key={result.userId}>{result.userId === match.winnerUserId ? '🏆 ' : ''}{result.displayName}: <strong>{result.score}</strong></p>
          ))}
          <p>{match.winnerUserId ? 'Победитель получает победу в общем счёте комнаты!' : 'Ничья! В этот раз без победителя.'}</p>
          <button className="play-button" onClick={onReturnToRoom}>ВЕРНУТЬСЯ В КОМНАТУ</button>
        </section>
      )}

      {!match && <section className="game-card"><p>{loading ? 'Запускаем матч...' : 'Подключаемся к матчу...'}</p></section>}

      <button className="leaderboard-button" onClick={() => void loadLeaderboard()} disabled={loading}>
        🏆 ЛИДЕРБОРД REACTION RUSH
      </button>
      {showLeaderboard && (
        <section className="game-card">
          <h2>ЛИДЕРБОРД REACTION RUSH</h2>
          {leaderboard.length === 0 && <p>Пока нет завершённых матчей.</p>}
          {leaderboard.map((player, index) => (
            <p key={player.user_id}>
              {index + 1}. {player.display_name} — {player.wins} побед · лучший счёт {player.best_match_score}
            </p>
          ))}
          <button className="invite-button" onClick={() => setShowLeaderboard(false)}>ЗАКРЫТЬ</button>
        </section>
      )}
      {message && <section className="game-card" role="alert"><p>{message}</p></section>}
    </main>
  )
}

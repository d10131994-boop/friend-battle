import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { database } from '../../database'
import type { MultiplayerRoom } from '../../multiplayer'
import { telegramUser } from '../../services/telegram'
import { ChoiceIcon, HandIllustration } from './HandIllustration'
import type { RockPaperScissorsChoice, RockPaperScissorsMatch as MatchState, RockPaperScissorsSnapshot } from './types'
import './rockPaperScissors.css'

type Props = {
  initData: string | undefined
  room: MultiplayerRoom
  startRequested: boolean
  onRoomUpdate: (room: MultiplayerRoom) => void
  onReturnToRoom: () => void
  onStartRequestHandled: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось обновить игру.'
}

export default function RockPaperScissorsMatch({
  initData, room, startRequested, onRoomUpdate, onReturnToRoom, onStartRequestHandled,
}: Props) {
  const auth = useMemo(() => ({ initData: initData ?? '' }), [initData])
  const [match, setMatch] = useState<MatchState | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(0)
  const matchIdRef = useRef<string | null>(null)
  const [serverOffset, setServerOffset] = useState(0)
  const startAttemptRef = useRef(false)
  const returnAttemptRef = useRef(false)
  const userId = telegramUser?.id ? String(telegramUser.id) : ''
  const roomId = room.roomId
  const roomStatus = room.status

  const invokeGame = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    return database.invokeFunction<T, Record<string, unknown>>('rock-paper-scissors', {
      ...body,
      initData: auth.initData,
    })
  }, [auth.initData])

  const refreshMatch = useCallback(async () => {
    const requestStartedAt = Date.now()
    const snapshot = await invokeGame<RockPaperScissorsSnapshot>({
      action: 'get_match',
      roomId,
    })
    const responseReceivedAt = Date.now()
    const serverNow = Date.parse(snapshot.serverNow)
    if (Number.isFinite(serverNow)) {
      setServerOffset(serverNow - (requestStartedAt + responseReceivedAt) / 2)
    }
    onRoomUpdate(snapshot.room)
    setMatch(snapshot.match)
    return snapshot.match
  }, [invokeGame, onRoomUpdate, roomId])

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refreshMatch().catch((error: unknown) => setMessage(errorMessage(error)))
    }, 0)
    const timer = window.setInterval(() => {
      void refreshMatch().catch((error: unknown) => setMessage(errorMessage(error)))
    }, 900)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refreshMatch])

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [])

  const startMatch = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const snapshot = await invokeGame<RockPaperScissorsSnapshot>({
        action: 'start_match',
        roomId,
      })
      onRoomUpdate(snapshot.room)
      setMatch(snapshot.match)
    } catch (error) {
      setMessage(errorMessage(error))
      onReturnToRoom()
    } finally {
      setLoading(false)
      onStartRequestHandled()
    }
  }, [invokeGame, onRoomUpdate, onReturnToRoom, onStartRequestHandled, roomId])

  useEffect(() => {
    matchIdRef.current = match?.matchId ?? null
  }, [match?.matchId])

  const me = room.players.find((player) => player.userId === userId)
  useEffect(() => {
    if (!startRequested || !me?.isHost || roomStatus === 'playing' || startAttemptRef.current) return
    startAttemptRef.current = true
    void startMatch()
  }, [startRequested, me?.isHost, roomStatus, startMatch])

  const choose = async (choice: RockPaperScissorsChoice) => {
    if (!match || match.status !== 'playing' || match.phase !== 'choosing' || loading ||
      now + serverOffset >= Date.parse(match.phaseDeadline)) return
    setLoading(true)
    setMessage('')
    try {
      await invokeGame({
        action: 'submit_choice',
        roomId,
        matchId: match.matchId,
        roundNumber: match.currentRound,
        choice,
      })
      await refreshMatch()
    } catch (error) {
      setMessage(errorMessage(error))
      await refreshMatch().catch(() => undefined)
    } finally {
      setLoading(false)
    }
  }

  const finishAndReturn = useCallback(async () => {
    if (returnAttemptRef.current) return
    if (roomStatus !== 'playing') {
      onReturnToRoom()
      return
    }
    returnAttemptRef.current = true
    setLoading(true)
    setMessage('')
    try {
      const matchId = matchIdRef.current
      if (!matchId) throw new Error('Не найден идентификатор завершённого матча.')
      const response = await invokeGame<{ room: MultiplayerRoom }>({
        action: 'return_to_room',
        roomId,
        matchId,
      })
      onRoomUpdate(response.room)
      onReturnToRoom()
    } catch (error) {
      returnAttemptRef.current = false
      setMessage(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [invokeGame, roomStatus, roomId, onRoomUpdate, onReturnToRoom])

  const matchStatus = match?.status
  const matchCompletedAt = match?.completedAt
  const currentMatchId = match?.matchId
  useEffect(() => {
    if (!currentMatchId || matchStatus !== 'completed' || roomStatus !== 'playing' || !matchCompletedAt) return
    const completedAt = Date.parse(matchCompletedAt)
    if (!Number.isFinite(completedAt)) return
    const timer = window.setTimeout(
      () => { void finishAndReturn() },
      Math.max(0, completedAt + 60_000 - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [currentMatchId, matchStatus, matchCompletedAt, roomStatus, finishAndReturn])

  const round = match?.round
  const myRoundPlayer = round?.players.find((player) => player.userId === userId)
  const opponent = match?.players.find((player) => player.userId !== userId)
  const myPlayer = match?.players.find((player) => player.userId === userId)
  const myChoice = myRoundPlayer?.choice ?? 'rock'
  const opponentChoice = round?.players.find((player) => player.userId !== userId)?.choice
  const remaining = match?.phase === 'choosing'
    ? Math.max(0, Math.ceil((Date.parse(match.phaseDeadline) - (now + serverOffset)) / 1_000))
    : 0
  const isCompleted = match?.status === 'completed'
  const isWinner = Boolean(match?.winnerUserId && match.winnerUserId === userId)
  const finalResults = match?.finalResults ?? match?.players ?? []
  const roundResult = match?.round?.isDraw
    ? 'draw'
    : match?.round?.winnerUserId === userId
      ? 'win'
      : 'loss'

  return (
    <main className="app rps-app">
      <header className="topbar rps-topbar">
        <div className="logo">RPS <span>BATTLE</span></div>
        <div className="rps-mode-label">МУЛЬТИПЛЕЕР</div>
      </header>

      <section className="rps-arena">
        {!match && (
          <div className="rps-phase-message">
            {loading ? 'Запускаем игру…' : 'Подключаемся к матчу…'}
          </div>
        )}

        {match?.status === 'playing' && match.phase === 'choosing' && (
          <>
            <div className="rps-timer" aria-label={`Осталось ${remaining} секунд`}>{remaining}</div>
            <HandIllustration choice={myChoice} className="rps-hand rps-my-hand" label="Твой выбор" />
            <div className="rps-choice-pyramid" aria-label="Выбери жест">
              {(['rock'] as RockPaperScissorsChoice[]).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={`rps-choice-button ${myChoice === choice ? 'selected' : ''}`}
                  aria-label="Камень"
                  aria-pressed={myChoice === choice}
                  disabled={loading || remaining <= 0}
                  onClick={() => void choose(choice)}
                ><ChoiceIcon choice={choice} className="rps-choice-icon" /></button>
              ))}
              <div className="rps-choice-row">
                {(['scissors', 'paper'] as RockPaperScissorsChoice[]).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className={`rps-choice-button ${myChoice === choice ? 'selected' : ''}`}
                    aria-label={choice === 'scissors' ? 'Ножницы' : 'Бумага'}
                    aria-pressed={myChoice === choice}
                    disabled={loading || remaining <= 0}
                    onClick={() => void choose(choice)}
                  ><HandIllustration choice={choice} className="rps-hand-icon" /></button>
                ))}
              </div>
            </div>
            <div className="rps-phase-message">{myRoundPlayer?.choice ? 'Выбор принят' : 'Выбери жест'}</div>
          </>
        )}

        {match?.status === 'playing' && match.phase === 'revealing' && round && opponentChoice && (
          <>
            <HandIllustration choice={opponentChoice} className="rps-hand rps-opponent-hand" label="Выбор соперника" />
            <HandIllustration choice={myChoice} className="rps-hand rps-my-hand" label="Твой выбор" />
          </>
        )}

        {match?.status === 'playing' && match.phase === 'result' && (
          <div className="rps-round-result">
            <div className="rps-round-score">{opponent?.score ?? 0}</div>
            <h1 className={`rps-round-title ${roundResult}`}>
              {roundResult === 'win' ? 'Победа' : roundResult === 'loss' ? 'Поражение' : 'Ничья'}
            </h1>
            <div className="rps-round-score">{myPlayer?.score ?? 0}</div>
          </div>
        )}

        {isCompleted && (
          <div className="rps-session-result">
            <h1 className={`rps-session-title ${isWinner ? 'win' : 'loss'}`}>
              {isWinner ? 'С победой!' : 'Не в этот раз'}
            </h1>
            <div className="rps-session-scores">
              <div className="rps-session-player">
                <span className="rps-session-name">{finalResults[0]?.displayName ?? 'Игрок 1'}</span>
                <strong className="rps-session-score">{finalResults[0]?.score ?? 0}</strong>
              </div>
              <span className="rps-session-separator">:</span>
              <div className="rps-session-player">
                <span className="rps-session-name">{finalResults[1]?.displayName ?? 'Игрок 2'}</span>
                <strong className="rps-session-score">{finalResults[1]?.score ?? 0}</strong>
              </div>
            </div>
            <button type="button" className="rps-exit-button" onClick={() => void finishAndReturn()} disabled={loading}>
              {loading ? 'ВОЗВРАЩАЕМСЯ…' : 'ВЕРНУТЬСЯ В КОМНАТУ'}
            </button>
          </div>
        )}

        {match?.status === 'cancelled' && (
          <div className="rps-session-result">
            <h1 className="rps-session-title loss">Матч прерван</h1>
            <button type="button" className="rps-exit-button" onClick={() => void finishAndReturn()}>В КОМНАТУ</button>
          </div>
        )}

        {message && <div className="rps-status-message">{message}</div>}
      </section>
    </main>
  )
}

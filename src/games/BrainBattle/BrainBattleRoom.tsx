import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { database } from '../../database'
import { createDatabaseMultiplayerAdapter } from '../../multiplayer'
import type { MultiplayerRoom } from '../../multiplayer'
import { createMultiplayerRoomSession } from '../../multiplayer/roomSession'
import { telegramUser } from '../../services/telegram'

const multiplayer = createDatabaseMultiplayerAdapter({ functionName: 'multiplayer' })

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
}

type BrainBattleMatch = {
  matchId: string
  startedAt: string
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

type BrainBattleSnapshot = {
  room: MultiplayerRoom
  match: BrainBattleMatch | null
}

type BrainBattleRoomProps = {
  initData: string | undefined
  inviteCode?: string
  onBack: () => void
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export default function BrainBattleRoom({
  initData,
  inviteCode: initialInviteCode,
  onBack,
}: BrainBattleRoomProps) {
  const auth = useMemo(() => ({ initData: initData ?? '' }), [initData])
  const [room, setRoom] = useState<MultiplayerRoom | null>(null)
  const [match, setMatch] = useState<BrainBattleMatch | null>(null)
  const [inviteInput, setInviteInput] = useState(initialInviteCode ?? '')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [remaining, setRemaining] = useState(15)
  const [showFinalResults, setShowFinalResults] = useState(true)
  const [realtimeStatus, setRealtimeStatus] = useState('Подключаемся...')
  const sessionRef = useRef<ReturnType<typeof createMultiplayerRoomSession> | null>(null)
  const telegramId = telegramUser?.id ? String(telegramUser.id) : ''

  const invokeGame = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    return database.invokeFunction<T, Record<string, unknown>>('brain-battle', {
      ...body,
      initData: auth.initData,
    })
  }, [auth.initData])

  const acceptRoom = useCallback((nextRoom: MultiplayerRoom) => {
    setRoom(nextRoom)
    if (nextRoom.status === 'waiting' || nextRoom.status === 'cancelled') {
      setMatch(null)
      setRemaining(15)
    }
  }, [])

  const refreshMatch = useCallback(async () => {
    if (!room?.roomId) return
    const snapshot = await invokeGame<BrainBattleSnapshot>({
      action: 'get_match',
      roomId: room.roomId,
    })
    acceptRoom(snapshot.room)
    setMatch(snapshot.match)
    if (snapshot.match?.status === 'completed') setShowFinalResults(true)
  }, [room?.roomId, invokeGame, acceptRoom])

  useEffect(() => {
    if (!room?.roomId || !auth.initData || room.status === 'cancelled') return

    const session = createMultiplayerRoomSession({
      roomId: room.roomId,
      auth,
      service: multiplayer,
      onRoom: acceptRoom,
      onStatus: setRealtimeStatus,
      onError: (error) => setMessage(error.message),
    })
    sessionRef.current = session
    void session.start().catch((error: unknown) => {
      setMessage(getErrorMessage(error, 'Не удалось подключить комнату.'))
    })

    return () => {
      sessionRef.current = null
      void session.stop()
    }
  }, [room?.roomId, auth, acceptRoom])

  useEffect(() => {
    if (!room?.roomId || room.status === 'cancelled') return
    void refreshMatch().catch((error: unknown) => {
      setMessage(getErrorMessage(error, 'Не удалось обновить состояние матча.'))
    })
    const timer = window.setInterval(() => {
      void refreshMatch().catch((error: unknown) => {
        setMessage(getErrorMessage(error, 'Не удалось обновить состояние матча.'))
      })
    }, 1200)
    return () => window.clearInterval(timer)
  }, [room?.roomId, room?.status, refreshMatch])

  useEffect(() => {
    if (!match || match.status !== 'playing' || room?.status !== 'playing') return
    const startAt = Date.parse(match.questionStartedAt)
    const endAt = Date.parse(match.questionEndsAt)
    const update = () => {
      const now = Date.now()
      setRemaining(now < startAt ? 15 : Math.max(0, Math.ceil((endAt - now) / 1000)))
    }
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [match?.matchId, match?.currentQuestionIndex, match?.questionEndsAt, match?.status, room?.status])

  async function createRoom() {
    if (!auth.initData) {
      setMessage('Открой игру через Telegram, чтобы создать комнату.')
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const created = await multiplayer.createRoom(auth, { maxPlayers: 4 })
      setMatch(null)
      setShowFinalResults(true)
      setRoom(created)
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось создать комнату.'))
    } finally {
      setLoading(false)
    }
  }

  async function joinRoom(code = inviteInput) {
    if (!auth.initData) {
      setMessage('Открой игру через Telegram, чтобы присоединиться к комнате.')
      return
    }
    if (!code.trim()) {
      setMessage('Введи код приглашения.')
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const joined = await multiplayer.joinRoom(auth, { inviteCode: code.trim() })
      setMatch(null)
      setShowFinalResults(true)
      setRoom(joined)
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось присоединиться к комнате.'))
    } finally {
      setLoading(false)
    }
  }

  async function selectGame() {
    if (!room) return
    setLoading(true)
    setMessage('')
    try {
      const updated = await multiplayer.selectGame(auth, {
        roomId: room.roomId,
        gameId: 'brain-battle',
      })
      acceptRoom(updated)
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось выбрать Brain Battle.'))
    } finally {
      setLoading(false)
    }
  }

  async function toggleReady() {
    if (!room) return
    setLoading(true)
    setMessage('')
    try {
      const updated = await multiplayer.setReady(auth, {
        roomId: room.roomId,
        isReady: !room.players.find((player) => player.userId === telegramId)?.isReady,
      })
      acceptRoom(updated)
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось изменить готовность.'))
    } finally {
      setLoading(false)
    }
  }

  async function startMatch() {
    if (!room) return
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
      setShowFinalResults(false)
      setRemaining(15)
      acceptRoom(started.room)
      await refreshMatch()
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось начать матч.'))
    } finally {
      setLoading(false)
    }
  }

  async function submitAnswer(answerIndex: number) {
    if (!room || !match || match.status !== 'playing' || match.myAnswerSubmitted || remaining <= 0) return
    setLoading(true)
    setMessage('')
    try {
      await invokeGame({
        action: 'submit_answer',
        roomId: room.roomId,
        matchId: match.matchId,
        questionIndex: match.currentQuestionIndex,
        selectedAnswer: answerIndex,
      })
      await refreshMatch()
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось отправить ответ.'))
      await refreshMatch().catch(() => undefined)
    } finally {
      setLoading(false)
    }
  }

  async function leaveRoom() {
    if (room) {
      setLoading(true)
      try {
        await multiplayer.leaveRoom(auth, { roomId: room.roomId })
      } catch (error) {
        setMessage(getErrorMessage(error, 'Не удалось выйти из комнаты.'))
        setLoading(false)
        return
      }
      await sessionRef.current?.stop()
      setRoom(null)
      setMatch(null)
      setMessage('')
      setLoading(false)
    }
    onBack()
  }

  function shareInvite() {
    if (!room) return
    const inviteUrl = `https://t.me/yourpartygame_bot/FriendBattle?startapp=bb_${room.inviteCode}`
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent('Сразись со мной в Brain Battle! 🧠')}`
    window.open(shareUrl, '_blank')
  }

  const me = room?.players.find((player) => player.userId === telegramId)
  const allReady = Boolean(room?.players.length && room.players.every((player) => player.isReady))
  const canStart = Boolean(
    room?.gameId === 'brain-battle' &&
    room.players.length >= 2 &&
    room.players.length <= 4 &&
    allReady,
  )
  const isHost = Boolean(me?.isHost)
  const questionIsLive = Boolean(
    match?.status === 'playing' &&
    room?.status === 'playing' &&
    Date.now() >= Date.parse(match.questionStartedAt) &&
    remaining > 0,
  )
  const results = match?.finalResults ?? []

  return (
    <main className="app">
      <header className="topbar">
        <button className="leaderboard-button" onClick={() => void leaveRoom()} disabled={loading}>
          ← Назад
        </button>
        <div className="logo">BRAIN <span>BATTLE</span></div>
      </header>

      <section className="hero">
        <div className="eyebrow">ИГРА С ДРУЗЬЯМИ</div>
        <div className="game-icon">🧠</div>
        <h1>ИНТЕЛЛЕКТУАЛЬНАЯ<br /><span>БИТВА</span></h1>
        <p>10 вопросов · 15 секунд на ответ · от 2 до 4 игроков</p>
      </section>

      {!room && (
        <section className="game-card">
          <button className="play-button" onClick={() => void createRoom()} disabled={loading}>
            {loading ? 'СОЗДАЁМ...' : 'СОЗДАТЬ КОМНАТУ'}
          </button>
          <p>Или присоединись к друзьям по коду</p>
          <input
            className="invite-input"
            value={inviteInput}
            onChange={(event) => setInviteInput(event.target.value)}
            placeholder="КОД ПРИГЛАШЕНИЯ"
            maxLength={100}
          />
          <button className="invite-button" onClick={() => void joinRoom()} disabled={loading}>
            ПРИСОЕДИНИТЬСЯ
          </button>
        </section>
      )}

      {room && (
        <>
          <section className="invite-card">
            <div className="invite-icon">🧠</div>
            <div className="invite-text">
              <strong>КОМНАТА {room.inviteCode}</strong>
              <p>{realtimeStatus === 'SUBSCRIBED' ? 'Синхронизация активна' : realtimeStatus}</p>
              <p>{room.players.length} / {room.maxPlayers ?? 4} игроков</p>
              {room.players.map((player) => (
                <p key={player.userId}>
                  {player.displayName}{player.isHost ? ' 👑' : ''} — {player.isReady ? '✅ Готов' : '⏳ Не готов'}
                  {' · '}{player.wins} побед · {player.matchesPlayed} матчей
                  {player.userId === telegramId ? ' (ты)' : ''}
                </p>
              ))}
            </div>
            <button className="invite-button" onClick={shareInvite}>ПРИГЛАСИТЬ ДРУГА</button>
          </section>

          {room.status !== 'playing' && room.status !== 'cancelled' && (
            <>
              {match?.status === 'completed' && showFinalResults && (
                <section className="game-card">
                  <h2>БИТВА ЗАВЕРШЕНА</h2>
                  {results.map((result) => (
                    <p key={result.userId}>
                      {result.userId === match.winnerUserId ? '🏆 ' : ''}
                      {result.displayName}: <strong>{result.score}</strong> очков
                    </p>
                  ))}
                  <p>{match.winnerUserId ? 'Победитель получает победу в счёте комнаты!' : 'Ничья! В этот раз без победителя.'}</p>
                  <button className="invite-button" onClick={() => setShowFinalResults(false)}>ЗАКРЫТЬ РЕЗУЛЬТАТЫ</button>
                </section>
              )}

              <section className="game-card">
                <h2>ВЫБОР ИГРЫ</h2>
                {isHost ? (
                  <select
                    className="invite-input"
                    value={room.gameId ?? ''}
                    onChange={(event) => {
                      if (event.target.value === 'brain-battle') void selectGame()
                    }}
                    disabled={loading}
                  >
                    <option value="">Выбери игру</option>
                    <option value="brain-battle">Brain Battle</option>
                  </select>
                ) : (
                  <p>Выбрана игра: {room.gameId === 'brain-battle' ? 'Brain Battle' : 'Пока не выбрана'}</p>
                )}
                {room.gameId === 'brain-battle' && <p>10 вопросов, 15 секунд на каждый. За правильный ответ — до 150 очков.</p>}
                {room.gameId && room.gameId !== 'brain-battle' && (
                  <p>В этой комнате выбрана другая игра. Вернись в общий зал, чтобы продолжить.</p>
                )}
                {room.gameId === 'brain-battle' && (
                  <>
                    <button className="invite-button" onClick={() => void toggleReady()} disabled={loading}>
                      {me?.isReady ? 'ОТМЕНИТЬ ГОТОВНОСТЬ' : 'Я ГОТОВ 🧠'}
                    </button>
                    {isHost ? (
                      <button className="play-button" onClick={() => void startMatch()} disabled={loading || !canStart}>
                        {room.status === 'finished' ? 'НАЧАТЬ РЕВАНШ' : 'НАЧАТЬ БИТВУ'}
                      </button>
                    ) : (
                      <p>Ожидаем, пока ведущий начнёт матч.</p>
                    )}
                    {room.players.length < 2 && <p>Для начала битвы нужен хотя бы ещё один игрок.</p>}
                    {room.players.length >= 2 && !allReady && <p>Все игроки должны подтвердить готовность.</p>}
                  </>
                )}
              </section>
            </>
          )}

          {room.status === 'playing' && match?.status === 'playing' && (
            <>
              <section className="stats">
                <div className="stat-card"><span>⚡</span><div><small>ТВОИ ОЧКИ</small><strong>{match.players.find((player) => player.userId === telegramId)?.score ?? 0}</strong></div></div>
                <div className="stat-card"><span>⏱️</span><div><small>ОСТАЛОСЬ</small><strong>{remaining}</strong></div></div>
                <div className="stat-card"><span>🧩</span><div><small>ВОПРОС</small><strong>{match.currentQuestionIndex + 1} / 10</strong></div></div>
              </section>

              <section className="game-card">
                <h2>СЧЁТ</h2>
                {match.players.map((player) => (
                  <div className="brain-room-player" key={player.userId}>
                    <span>{player.displayName}{player.userId === telegramId ? ' (ты)' : ''}</span>
                    <strong>{player.score}</strong>
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
                        <button
                          key={index}
                          className="primary-button"
                          onClick={() => void submitAnswer(index)}
                          disabled={loading}
                        >
                          {String.fromCharCode(65 + index)}. {answer}
                        </button>
                      ))}
                    </div>
                  )}
                  {match.myAnswerSubmitted && (
                    <div className="brain-answer-waiting">
                      <h2>✓ Ответ принят!</h2>
                      <p>Ожидаем остальных игроков…</p>
                    </div>
                  )}
                  {!match.myAnswerSubmitted && remaining === 0 && (
                    <div><h2>Время вышло!</h2><p>Ожидаем завершения вопроса...</p></div>
                  )}
                  {!questionIsLive && remaining > 0 && <p>Приготовься! Вопрос скоро начнётся.</p>}
                </section>
              )}
            </>
          )}
        </>
      )}

      {message && <section className="game-card" role="alert"><p>{message}</p></section>}
    </main>
  )
}

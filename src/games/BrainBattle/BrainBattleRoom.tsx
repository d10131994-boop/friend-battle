
import { useEffect, useRef, useState } from 'react'
import { telegramInitData, telegramUser } from '../../services/telegram'
import {
  checkBrainBattleServer,
  createBrainBattleRoom,
  joinBrainBattleRoom,
  getBrainBattleRoom,
  setBrainBattleReady,
  submitBrainBattleAnswer,
} from './services/brainBattleService'
import type { BrainBattleRoomResponse } from './types'

type BrainBattleRoomProps = {
  onBack: () => void
}

function BrainBattleRoom({ onBack }: BrainBattleRoomProps) {
  const [serverStatus, setServerStatus] = useState('Проверяем подключение...')
  const [playerName, setPlayerName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [roomData, setRoomData] = useState<BrainBattleRoomResponse | null>(null)

  const [inviteCode, setInviteCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [roomLoading, setRoomLoading] = useState(false)
  const [roomError, setRoomError] = useState('')

  const [submittedQuestionIndex, setSubmittedQuestionIndex] = useState<number | null>(null)
  const [answerSubmitting, setAnswerSubmitting] = useState(false)
  const [clockNow, setClockNow] = useState(Date.now())

  const submittingRef = useRef(false)

  const room = roomData?.room
  const roomPlayers = roomData?.players ?? []
  const currentQuestion = roomData?.currentQuestion ?? null

  const currentTelegramId = telegramUser?.id
    ? String(telegramUser.id)
    : ''

  const currentPlayer = roomPlayers.find(
    (player) => player.telegram_id === currentTelegramId
  )

  const opponent = roomPlayers.find(
    (player) => player.telegram_id !== currentTelegramId
  )

  const isAnswered =
    room?.current_question_index === submittedQuestionIndex

  const questionStartTime = room?.question_started_at
    ? new Date(room.question_started_at).getTime()
    : room?.started_at
      ? new Date(room.started_at).getTime()
      : null

  const questionEndTime = room?.question_ends_at
    ? new Date(room.question_ends_at).getTime()
    : null

  const countdown = questionStartTime !== null
    ? Math.max(0, Math.ceil((questionStartTime - clockNow) / 1000))
    : null

  const remainingSeconds = questionEndTime !== null
    ? Math.max(0, Math.ceil((questionEndTime - clockNow) / 1000))
    : 0

  const questionIsLive =
    room?.status === 'playing' &&
    currentQuestion !== null &&
    countdown === 0 &&
    remainingSeconds > 0

  const isWinner =
    room?.winner_telegram_id !== null &&
    room?.winner_telegram_id === currentTelegramId

  async function refreshRoom() {
    if (!roomId || !telegramInitData) return

    const response = await getBrainBattleRoom(telegramInitData, roomId)
    setRoomData(response)
  }

  async function handleCreateRoom() {
    if (!telegramInitData) {
      setRoomError('Открой игру через Telegram')
      return
    }

    setRoomLoading(true)
    setRoomError('')

    try {
      const response = await createBrainBattleRoom(telegramInitData)

      setRoomId(response.room.id)
      setInviteCode(response.room.invite_code || '')
    } catch (error) {
      console.error('BRAIN BATTLE create room error:', error)
      setRoomError(
        error instanceof Error
          ? error.message
          : 'Не удалось создать комнату'
      )
    } finally {
      setRoomLoading(false)
    }
  }

  async function handleJoinRoom() {
    if (!telegramInitData) {
      setRoomError('Открой игру через Telegram')
      return
    }

    const code = joinCode.trim()

    if (!code) {
      setRoomError('Введи код приглашения')
      return
    }

    setRoomLoading(true)
    setRoomError('')

    try {
      const response = await joinBrainBattleRoom(
        telegramInitData,
        code
      )

      setRoomId(response.room.id)
      setInviteCode(response.room.invite_code || code)
    } catch (error) {
      console.error('BRAIN BATTLE join room error:', error)
      setRoomError(
        error instanceof Error
          ? error.message
          : 'Не удалось присоединиться к комнате'
      )
    } finally {
      setRoomLoading(false)
    }
  }

  async function handleReady() {
    if (!roomId || !telegramInitData || roomLoading) return

    setRoomLoading(true)
    setRoomError('')

    try {
      await setBrainBattleReady(telegramInitData, roomId)
      await refreshRoom()
    } catch (error) {
      console.error('BRAIN BATTLE ready error:', error)
      setRoomError(
        error instanceof Error
          ? error.message
          : 'Не удалось подтвердить готовность'
      )
    } finally {
      setRoomLoading(false)
    }
  }

  async function handleAnswer(answerIndex: number) {
    if (
      !roomId ||
      !telegramInitData ||
      !room ||
      !questionIsLive ||
      isAnswered ||
      submittingRef.current
    ) {
      return
    }

    submittingRef.current = true
    setAnswerSubmitting(true)
    setSubmittedQuestionIndex(room.current_question_index)
    setRoomError('')

    try {
      await submitBrainBattleAnswer(
        telegramInitData,
        roomId,
        room.current_question_index,
        answerIndex
      )

      await refreshRoom()
    } catch (error) {
      console.error('BRAIN BATTLE submit answer error:', error)

      setSubmittedQuestionIndex(null)
      setRoomError(
        error instanceof Error
          ? error.message
          : 'Не удалось отправить ответ'
      )

      await refreshRoom().catch(console.error)
    } finally {
      submittingRef.current = false
      setAnswerSubmitting(false)
    }
  }

  // Проверка подключения к серверу.
  useEffect(() => {
    let cancelled = false

    async function checkServer() {
      if (!telegramInitData) {
        setServerStatus('Открой игру через Telegram')
        return
      }

      try {
        const response = await checkBrainBattleServer(telegramInitData)

        if (cancelled) return

        setServerStatus('Сервер подключён')
        setPlayerName(response.player?.player_name || 'Игрок')
      } catch (error) {
        if (cancelled) return

        console.error('BRAIN BATTLE connection error:', error)
        setServerStatus(
          error instanceof Error
            ? error.message
            : 'Ошибка подключения к серверу'
        )
      }
    }

    checkServer()

    return () => {
      cancelled = true
    }
  }, [])

  // Обновление часов на экране.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockNow(Date.now())
    }, 250)

    return () => window.clearInterval(intervalId)
  }, [])

  // Получение состояния комнаты и синхронизация игроков.
  useEffect(() => {
    if (!roomId || !telegramInitData) return

    let cancelled = false

    async function loadRoom() {
      try {
        const response = await getBrainBattleRoom(
          telegramInitData!,
          roomId
        )

        if (cancelled) return

        setRoomData(response)
      } catch (error) {
        if (cancelled) return

        console.error('BRAIN BATTLE room update error:', error)
      }
    }

    loadRoom()

    const intervalId = window.setInterval(loadRoom, 1500)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [roomId])

  const showResults = room?.status === 'finished'

  return (
    <main className="app">
      <header className="topbar">
        <button
          className="leaderboard-button"
          onClick={onBack}
        >
          ← Назад
        </button>
      </header>

      <section className="hero">
        <div className="eyebrow">BRAIN BATTLE</div>

        <div className="game-icon">⚔️</div>

        <h1>
          PLAY<br />
          <span>TOGETHER</span>
        </h1>

        <p>
          Соревнуйся с другом в интеллектуальной битве!
        </p>
      </section>

      <section className="game-card">
        <p>{serverStatus}</p>

        {playerName && (
          <p>Игрок: {playerName}</p>
        )}

        {!roomId && (
          <>
            <button
              className="primary-button"
              onClick={handleCreateRoom}
              disabled={roomLoading}
            >
              {roomLoading ? 'Создаём комнату...' : '⚔️ Создать комнату'}
            </button>

            <div>
              <p>Или присоединись к другу</p>

              <input
                type="text"
                placeholder="Код приглашения"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                maxLength={16}
              />

              <button
                className="primary-button"
                onClick={handleJoinRoom}
                disabled={roomLoading || !joinCode.trim()}
              >
                {roomLoading ? 'Подключаемся...' : 'Присоединиться'}
              </button>
            </div>
          </>
        )}

        {roomError && (
          <p role="alert">{roomError}</p>
        )}

        {roomId && (
          <div>
            {inviteCode && (
              <div>
                <p>Код комнаты:</p>
                <h2>{inviteCode}</h2>
              </div>
            )}

            {/* Ожидание игроков и готовности */}
            {room?.status === 'waiting' && (
              <div className="brain-room-players">
                <h3>Игроки в комнате</h3>

                {roomPlayers.map((player) => (
                  <div
                    key={player.telegram_id}
                    className="brain-room-player"
                  >
                    <span>{player.player_name}</span>
                    <span>{player.is_ready ? 'Готов' : 'Ожидает'}</span>
                  </div>
                ))}

                {!opponent && (
                  <p>Ожидаем второго игрока...</p>
                )}

                <button
                  className="primary-button"
                  onClick={handleReady}
                  disabled={
                    roomLoading ||
                    roomPlayers.length < 2 ||
                    Boolean(currentPlayer?.is_ready)
                  }
                >
                  {roomLoading
                    ? 'Подтверждаем...'
                    : currentPlayer?.is_ready
                      ? 'Вы готовы ✓'
                      : 'Я готов'}
                </button>

                {roomPlayers.length === 2 &&
                  roomPlayers.every((player) => player.is_ready) && (
                    <p>Оба игрока готовы. Начинаем!</p>
                  )}
              </div>
            )}

            {/* Обратный отсчёт до первого вопроса */}
            {room?.status === 'playing' &&
              countdown !== null &&
              countdown > 0 && (
                <div className="brain-room-countdown">
                  <h2>Игра начинается!</h2>
                  <div className="brain-countdown-number">
                    {countdown}
                  </div>
                </div>
              )}

            {/* Игровой экран */}
            {room?.status === 'playing' && countdown === 0 && (
              <div className="brain-battle-game">
                <div className="brain-room-players">
                  <h3>Счёт</h3>

                  {roomPlayers.map((player) => (
                    <div
                      key={player.telegram_id}
                      className="brain-room-player"
                    >
                      <span>
                        {player.player_name}
                        {player.telegram_id === currentTelegramId
                          ? ' (Вы)'
                          : ''}
                      </span>
                      <strong>{player.total_score}</strong>
                    </div>
                  ))}
                </div>

                {currentQuestion && (
                  <>
                    <p>
                      Вопрос {room.current_question_index + 1} из 10
                    </p>

                    <div className="brain-question-timer">
                      <h2>
                        {remainingSeconds > 0
                          ? `⏱ ${remainingSeconds} сек.`
                          : 'Время вышло'}
                      </h2>
                    </div>

                    <h2>{currentQuestion.question}</h2>

                    {questionIsLive && !isAnswered && (
                      <div className="brain-answer-options">
                        {currentQuestion.answers.map((answer, index) => (
                          <button
                            key={index}
                            className="primary-button"
                            onClick={() => handleAnswer(index)}
                            disabled={answerSubmitting || isAnswered}
                          >
                            {answer}
                          </button>
                        ))}
                      </div>
                    )}

                    {isAnswered && (
                      <div className="brain-answer-waiting">
                        <h2>✓ Ответ принят!</h2>
                        <p>Ожидаем соперника…</p>
                        <p>
                          Следующий вопрос появится, когда оба игрока
                          ответят или закончится время.
                        </p>
                      </div>
                    )}

                    {!isAnswered && remainingSeconds === 0 && (
                      <div>
                        <h2>Время вышло!</h2>
                        <p>Ожидаем завершения вопроса...</p>
                      </div>
                    )}

                    {answerSubmitting && (
                      <p>Отправляем ответ...</p>
                    )}
                  </>
                )}

                {!currentQuestion && (
                  <p>Загружаем вопрос...</p>
                )}
              </div>
            )}

            {/* Итоги игры */}
            {showResults && (
              <div className="brain-battle-results">
                <h2>Битва завершена!</h2>

                {room.winner_telegram_id === null ? (
                  <h3>🤝 Ничья!</h3>
                ) : isWinner ? (
                  <h3>🏆 Ты победил!</h3>
                ) : (
                  <h3>Победил соперник</h3>
                )}

                <h3>Результаты</h3>

                {roomPlayers
                  .slice()
                  .sort((a, b) => b.total_score - a.total_score)
                  .map((player) => (
                    <div
                      key={player.telegram_id}
                      className="brain-room-player"
                    >
                      <strong>
                        {player.player_name}
                        {player.telegram_id === currentTelegramId
                          ? ' (Вы)'
                          : ''}
                      </strong>
                      <strong>{player.total_score} очков</strong>
                    </div>
                  ))}

                {currentPlayer && (
                  <div>
                    <p>Правильных ответов: {currentPlayer.correct_answers}</p>
                    <p>Неправильных ответов: {currentPlayer.incorrect_answers}</p>
                    <p>Пропущено: {currentPlayer.skipped_questions}</p>
                  </div>
                )}

                <button
                  className="primary-button"
                  onClick={onBack}
                >
                  Вернуться в меню
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

export default BrainBattleRoom

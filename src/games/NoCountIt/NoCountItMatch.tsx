import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { database } from '../../database'
import type { MultiplayerRoom } from '../../multiplayer'
import { telegramUser } from '../../services/telegram'
import type { NoCountItPublicMatch, NoCountItSnapshot } from './types'

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

export default function NoCountItMatch({
  initData, room, startRequested, onRoomUpdate, onReturnToRoom, onStartRequestHandled,
}: Props) {
  const auth = useMemo(() => ({ initData: initData ?? '' }), [initData])
  const [match, setMatch] = useState<NoCountItPublicMatch | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [answerDraft, setAnswerDraft] = useState<{ roundKey: string | null; value: string }>({ roundKey: null, value: '' })
  const [remaining, setRemaining] = useState(0)
  const [imageRemaining, setImageRemaining] = useState(0)
  const [readyRoundKey, setReadyRoundKey] = useState<string | null>(null)
  const startAttemptRef = useRef(false)
  const readyAttemptRef = useRef<string | null>(null)
  const telegramId = telegramUser?.id ? String(telegramUser.id) : ''

  const invokeGame = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    return database.invokeFunction<T, Record<string, unknown>>('no-count-it', {
      ...body, initData: auth.initData,
    })
  }, [auth.initData])

  const refreshMatch = useCallback(async () => {
    const snapshot = await invokeGame<NoCountItSnapshot>({ action: 'get_match', roomId: room.roomId })
    onRoomUpdate(snapshot.room)
    setMatch((previous) => {
      if (!snapshot.match || !previous || previous.matchId !== snapshot.match.matchId) return snapshot.match
      if (previous.round?.roundNumber !== snapshot.match.round?.roundNumber) return snapshot.match
      return {
        ...snapshot.match,
        round: snapshot.match.round && previous.round?.imageUrl
          ? { ...snapshot.match.round, imageUrl: previous.round.imageUrl }
          : snapshot.match.round,
      }
    })
    return snapshot.match
  }, [invokeGame, onRoomUpdate, room.roomId])

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refreshMatch().catch((error: unknown) => setMessage(errorMessage(error)))
    }, 0)
    const interval = window.setInterval(() => {
      void refreshMatch().catch((error: unknown) => setMessage(errorMessage(error)))
    }, 900)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [refreshMatch])

  const startMatch = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const response = await invokeGame<{ room: MultiplayerRoom }>({
        action: 'start_match', roomId: room.roomId,
      })
      onRoomUpdate(response.room)
      await refreshMatch()
    } catch (error) {
      setMessage(errorMessage(error))
      onReturnToRoom()
    } finally {
      setLoading(false)
      onStartRequestHandled()
    }
  }, [invokeGame, onRoomUpdate, onReturnToRoom, onStartRequestHandled, refreshMatch, room.roomId])

  const me = room.players.find((player) => player.userId === telegramId)
  useEffect(() => {
    if (!startRequested || !me?.isHost || room.status === 'playing' || startAttemptRef.current) return
    startAttemptRef.current = true
    void startMatch()
  }, [startRequested, me?.isHost, room.status, startMatch])

  const currentRound = match?.round
  const myRoundPlayer = currentRound?.players.find((player) => player.userId === telegramId)
  const roundKey = match && currentRound ? `${match.matchId}:${currentRound.roundNumber}` : null

  const roundReady = readyRoundKey === roundKey
  const answerInput = answerDraft.roundKey === roundKey ? answerDraft.value : ''

  useEffect(() => {
    if (!roundKey || !currentRound || currentRound.status !== 'preparing' ||
      myRoundPlayer?.status !== 'preparing' || readyAttemptRef.current === roundKey) return
    readyAttemptRef.current = roundKey
    void invokeGame({ action: 'round_ready', roomId: room.roomId, matchId: match?.matchId })
      .then(() => refreshMatch())
      .then(() => setRoundReady(true))
      .catch((error: unknown) => {
        readyAttemptRef.current = null
        setMessage(errorMessage(error))
      })
  }, [roundKey, currentRound?.status, myRoundPlayer?.status, invokeGame, room.roomId, match?.matchId, refreshMatch])

  useEffect(() => {
    if (!currentRound) return
    const update = () => {
      const now = Date.now()
      const showAt = currentRound.showStartedAt ? Date.parse(currentRound.showStartedAt) : null
      const deadline = currentRound.answerDeadline ? Date.parse(currentRound.answerDeadline) : null
      setImageRemaining(showAt ? Math.max(0, Math.ceil((showAt + 5000 - now) / 1000)) : 0)
      setRemaining(deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0)
    }
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [currentRound?.status, currentRound?.showStartedAt, currentRound?.answerDeadline])

  async function submitAnswer() {
    if (!match || !currentRound || currentRound.status !== 'answering' ||
      myRoundPlayer?.status !== 'active' || myRoundPlayer.answer !== null ||
      !/^\d+$/.test(answerInput)) return
    setLoading(true)
    setMessage('')
    try {
      await invokeGame({
        action: 'submit_answer',
        roomId: room.roomId,
        matchId: match.matchId,
        roundNumber: currentRound.roundNumber,
        answer: answerInput,
      })
      setAnswerDraft({ roundKey: null, value: '' })
      await refreshMatch()
    } catch (error) {
      setMessage(errorMessage(error))
      await refreshMatch().catch(() => undefined)
    } finally {
      setLoading(false)
    }
  }

  function appendDigit(digit: string) {
    if (answerInput.length >= 19 || myRoundPlayer?.answer !== null) return
    setAnswerDraft({ roundKey, value: answerInput + digit })
  }

  const isFinished = match?.status === 'completed' || match?.status === 'technical_aborted'
  const isReveal = currentRound?.status === 'revealing' || currentRound?.status === 'completed'

  return (
    <main className="app">
      <header className="topbar">
        <div className="logo">NO COUNT <span>IT</span></div>
        <div className="player-level">МУЛЬТИПЛЕЕР</div>
      </header>
      <section className="hero">
        <div className="eyebrow">NO COUNT IT</div>
        <div className="game-icon">🍬</div>
        <h1>СКОЛЬКО <span>КОНФЕТ?</span></h1>
        <p>Три раунда · Меньше ошибок — выше шанс победить</p>
      </section>

      {!match && <section className="game-card"><p>{loading ? 'Готовим игру…' : 'Подключаемся к матчу…'}</p></section>}

      {match && !isFinished && currentRound && (
        <>
          <section className="stats">
            <div className="stat-card"><span>🔁</span><div><small>РАУНД</small><strong>{currentRound.roundNumber} / 3</strong></div></div>
            <div className="stat-card"><span>⏱️</span><div><small>{currentRound.status === 'showing' ? 'ПОКАЗ' : 'ОСТАЛОСЬ'}</small><strong>{currentRound.status === 'showing' ? imageRemaining : remaining}</strong></div></div>
            <div className="stat-card"><span>🍬</span><div><small>ТВОЯ ОЦЕНКА</small><strong>{myRoundPlayer?.answer ?? '—'}</strong></div></div>
          </section>

          {currentRound.status === 'preparing' && (
            <section className="game-card">
              <h2>ГОТОВИМ ИЗОБРАЖЕНИЕ</h2>
              <p>Как только изображение загрузится у участников, раунд начнётся одновременно для всех готовых игроков.</p>
              {currentRound.imageUrl && <img src={currentRound.imageUrl} alt="Банка с конфетами" onLoad={() => void confirmRoundReady()} onError={() => setMessage('Не удалось загрузить изображение раунда.')} style={{ width: '100%', maxWidth: 420, display: 'block', margin: '0 auto' }} />}
              <p>{roundReady ? '✓ Изображение готово. Ждём остальных…' : 'Загружаем сцену…'}</p>
              <p>Игроки готовы: {currentRound.players.filter((player) => player.status === 'ready').length} / {currentRound.players.length}</p>
            </section>
          )}

          {(currentRound.status === 'showing' || currentRound.status === 'answering' || isReveal) && (
            <section className="game-card">
              {currentRound.status === 'showing' && currentRound.imageUrl && (
                <img src={currentRound.imageUrl} alt="Банка с конфетами" style={{ width: '100%', maxWidth: 420, display: 'block', margin: '0 auto' }} />
              )}
              <h2>Сколько конфет цвета «{currentRound.targetColor ?? '…'}»?</h2>
              {currentRound.status === 'showing' && <p>Запоминай расположение и количество. Ответ скоро!</p>}
              {currentRound.status === 'answering' && myRoundPlayer?.status === 'active' && (
                <>
                  {myRoundPlayer.answer !== null ? (
                    <p>✓ Твоя оценка: {myRoundPlayer.answer}. Изменить её уже нельзя.</p>
                  ) : (
                    <>
                      <div className="stat-card"><strong style={{ fontSize: 32 }}>{answerInput || '0'}</strong></div>
                      <div className="brain-answer-options" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                        {['1','2','3','4','5','6','7','8','9','⌫','0','✓'].map((digit) => (
                          <button key={digit} className="primary-button" disabled={loading} onClick={() => {
                            if (digit === '✓') void submitAnswer()
                            else if (digit === '⌫') setAnswerDraft({ roundKey, value: answerInput.slice(0, -1) })
                            else appendDigit(digit)
                          }}>{digit}</button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              {currentRound.status === 'answering' && myRoundPlayer?.status === 'excluded_not_ready' && (
                <p>В этом раунде ты не успел загрузить сцену. В следующем раунде сможешь участвовать.</p>
              )}
              {isReveal && (
                <>
                  <h2>Правильный ответ: {currentRound.correctCount}</h2>
                  {currentRound.players.map((player) => (
                    <p key={player.userId}>{player.displayName}: {player.answer ?? 'нет ответа'} · ошибка {player.error ?? '—'}</p>
                  ))}
                </>
              )}
            </section>
          )}

          <section className="game-card">
            <h2>СУММА ОШИБОК</h2>
            {match.players.map((player) => (
              <div className="brain-room-player" key={player.userId}>
                <span>{player.displayName}{player.userId === telegramId ? ' (ты)' : ''}</span>
                <strong>{player.totalError}</strong>
              </div>
            ))}
          </section>
        </>
      )}

      {isFinished && match && (
        <section className="game-card">
          <h2>{match.status === 'technical_aborted' ? 'НЕ УДАЛОСЬ ПОДГОТОВИТЬ РАУНД' : 'МАТЧ ЗАВЕРШЁН'}</h2>
          {match.status === 'technical_aborted'
            ? <p>Никто не успел подготовить изображение. Ошибки не начислены, комната сохранена.</p>
            : <>
              {match.finalResults?.map((player) => (
                <p key={player.userId}>{player.userId === match.winnerUserId ? '🏆 ' : ''}{player.displayName}: <strong>{player.totalError}</strong> ошибок</p>
              ))}
              <p>{match.winnerUserId ? 'Побеждает игрок с наименьшей суммой ошибок!' : 'Ничья!'}</p>
            </>}
          <button className="play-button" onClick={onReturnToRoom}>ВЕРНУТЬСЯ В КОМНАТУ</button>
        </section>
      )}
      {message && <section className="game-card" role="alert"><p>{message}</p></section>}
    </main>
  )
}  const confirmRoundReady = useCallback(async () => {
    if (!roundKey || readyAttemptRef.current === roundKey || !match) return
    readyAttemptRef.current = roundKey
    try {
      await invokeGame({ action: 'round_ready', roomId: room.roomId, matchId: match.matchId })
      setReadyRoundKey(roundKey)
      await refreshMatch()
    } catch (error) {
      readyAttemptRef.current = null
      setMessage(errorMessage(error))
    }
  }, [roundKey, match, invokeGame, room.roomId, refreshMatch])

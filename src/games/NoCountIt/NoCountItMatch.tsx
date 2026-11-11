import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { database } from '../../database'
import type { MultiplayerRoom } from '../../multiplayer'
import { telegramUser } from '../../services/telegram'
import type { NoCountItPaletteColor, NoCountItPublicMatch, NoCountItSnapshot } from './types'
import { createSeededRandom } from './scene/sceneGenerator'
import { CANDY_PALETTE } from './scene/svgRenderer'
import { NO_COUNT_IT_TEXTS } from './texts'

type Props = {
  initData: string | undefined
  room: MultiplayerRoom
  startRequested: boolean
  onRoomUpdate: (room: MultiplayerRoom) => void
  onReturnToRoom: () => void
  onStartRequestHandled: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : NO_COUNT_IT_TEXTS.match.updateFailed
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
  const answerSubmitAttemptRef = useRef<string | null>(null)
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

  const keypadStyles = useMemo(() => {
    const colors: NoCountItPaletteColor[] = [...new Set<NoCountItPaletteColor>([
      ...(currentRound?.candyColors ?? []),
      ...(currentRound?.backgroundColor ? [currentRound.backgroundColor] : []),
    ])].sort()
    if (colors.length < 2 || !match || !currentRound) return {}

    const random = createSeededRandom(`${match.matchId}:${currentRound.roundNumber}:keypad`)
    const styles: Record<string, CSSProperties> = {}
    for (const digit of '0123456789') {
      const backgroundColor = colors[Math.floor(random() * colors.length)]
      const textColors = colors.filter((color) => color !== backgroundColor)
      const textColor = textColors[Math.floor(random() * textColors.length)]
      const background = CANDY_PALETTE[backgroundColor]
      styles[digit] = {
        background: `linear-gradient(180deg, ${background.light}, ${background.base})`,
        color: CANDY_PALETTE[textColor].base,
        borderColor: background.light,
        boxShadow: `0 5px 0 ${background.dark}, 0 7px 11px rgba(74, 46, 14, .16), inset 0 2px 0 rgba(255,255,255,.65)`,
      }
    }
    return styles
  }, [match?.matchId, currentRound?.roundNumber, currentRound?.candyColors, currentRound?.backgroundColor])

  const roundReady = readyRoundKey === roundKey
  const answerInput = answerDraft.roundKey === roundKey ? answerDraft.value : ''

  const isAnswering = currentRound?.status === 'answering'
  const isActiveRoundScreen = currentRound?.status === 'showing' || isAnswering

  useEffect(() => {
    answerSubmitAttemptRef.current = null
  }, [roundKey])

  const showStartedAt = currentRound?.showStartedAt ?? null
  const answerDeadline = currentRound?.answerDeadline ?? null

  useEffect(() => {
    if (!showStartedAt && !answerDeadline) return
    const update = () => {
      const now = Date.now()
      const showAt = showStartedAt ? Date.parse(showStartedAt) : null
      const deadline = answerDeadline ? Date.parse(answerDeadline) : null
      setImageRemaining(showAt ? Math.max(0, Math.ceil((showAt + 5000 - now) / 1000)) : 0)
      setRemaining(deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0)
    }
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [showStartedAt, answerDeadline])

  const submitAnswer = useCallback(async () => {
    if (!match || !currentRound || currentRound.status !== 'answering' ||
      myRoundPlayer?.status !== 'active' || myRoundPlayer.answer !== null ||
      !/^\d+$/.test(answerInput) || answerSubmitAttemptRef.current === roundKey) return
    answerSubmitAttemptRef.current = roundKey
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
      answerSubmitAttemptRef.current = null
      setMessage(errorMessage(error))
      await refreshMatch().catch(() => undefined)
    } finally {
      setLoading(false)
    }
  }, [match, currentRound, myRoundPlayer, answerInput, roundKey, invokeGame, room.roomId, refreshMatch])

  useEffect(() => {
    if (!isAnswering || !answerDeadline || remaining > 0 || !answerInput || !roundKey ||
      myRoundPlayer?.status !== 'active' || myRoundPlayer.answer !== null ||
      answerSubmitAttemptRef.current === roundKey) return
    void submitAnswer()
  }, [isAnswering, answerDeadline, remaining, answerInput, roundKey, myRoundPlayer, submitAnswer])

  function appendDigit(digit: string) {
    if (answerInput.length >= 19 || myRoundPlayer?.answer !== null) return
    setAnswerDraft({ roundKey, value: answerInput + digit })
  }

  const confirmRoundReady = useCallback(async () => {
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

  const isFinished = match?.status === 'completed' || match?.status === 'technical_aborted' || match?.status === 'cancelled'
  const isReveal = currentRound?.status === 'revealing' || currentRound?.status === 'completed'

  const exitEarly = useCallback(async () => {
    if (!match || room.status !== 'playing' || loading) return
    setLoading(true)
    setMessage('')
    try {
      const response = await invokeGame<{ room: MultiplayerRoom }>({
        action: 'early_exit', roomId: room.roomId, matchId: match.matchId,
      })
      onRoomUpdate(response.room)
      onReturnToRoom()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [match, room.status, room.roomId, loading, invokeGame, onRoomUpdate, onReturnToRoom])

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
      setMessage(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [invokeGame, room.status, room.roomId, onRoomUpdate, onReturnToRoom])

  useEffect(() => {
    if (!match || (match.status !== 'completed' && match.status !== 'technical_aborted') || room.status !== 'playing' || !match.completedAt) return
    const completedAt = Date.parse(match.completedAt)
    if (!Number.isFinite(completedAt)) return
    const delay = Math.max(0, completedAt + 60_000 - Date.now())
    const timer = window.setTimeout(() => { void finishAndReturn() }, delay)
    return () => window.clearTimeout(timer)
  }, [match?.matchId, match?.status, match?.completedAt, room.status, finishAndReturn])


  return (
    <main className={`app${isAnswering ? " no-count-it-answer-screen" : ""}`}>
      <header className="topbar">
        <div className="logo">NO COUNT <span>IT</span></div>
        <div className="player-level">{NO_COUNT_IT_TEXTS.match.multiplayer}</div>
      </header>
      {!isActiveRoundScreen && <section className="hero">
        <div className="eyebrow">{NO_COUNT_IT_TEXTS.match.eyebrow}</div>
        <div className="game-icon">🍬</div>
        <h1>{NO_COUNT_IT_TEXTS.match.headingFirst} <span>{NO_COUNT_IT_TEXTS.match.headingSecond}</span></h1>
        <p>{NO_COUNT_IT_TEXTS.match.subtitle}</p>
      </section>}

      {!match && <section className="game-card"><p>{loading ? NO_COUNT_IT_TEXTS.match.preparingGame : NO_COUNT_IT_TEXTS.match.connectingMatch}</p></section>}

      {match && !isFinished && currentRound && (
        <>
          {currentRound.status === 'preparing' && (
            <section className="game-card">
              <h2>{NO_COUNT_IT_TEXTS.match.preparingImage}</h2>
              <p>{NO_COUNT_IT_TEXTS.match.imagePreparationInfo}</p>
              {currentRound.imageUrl && <img src={currentRound.imageUrl} alt={NO_COUNT_IT_TEXTS.match.imageAlt} onLoad={() => void confirmRoundReady()} onError={() => setMessage(NO_COUNT_IT_TEXTS.match.imageLoadFailed)} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />}
              <p>{roundReady ? NO_COUNT_IT_TEXTS.match.imageReadyWaiting : NO_COUNT_IT_TEXTS.match.loadingScene}</p>
              <p>{NO_COUNT_IT_TEXTS.match.playersReady} {currentRound.players.filter((player) => player.status === 'ready').length} / {currentRound.players.length}</p>
            </section>
          )}

          {(currentRound.status === 'showing' || currentRound.status === 'answering' || isReveal) && (
            <section className={`game-card${isAnswering ? ' no-count-it-answer-card' : ' no-count-it-showing-card'}`}>
              {currentRound.status === 'showing' && currentRound.imageUrl && (
                <img src={currentRound.imageUrl} alt={NO_COUNT_IT_TEXTS.match.imageAlt} className="no-count-it-round-image" />
              )}
              {currentRound.status === 'answering' ? (
                <div className="no-count-it-answer-layout">
                  <div className="no-count-it-answer-top">
                    <h2 className="no-count-it-answer-question">{NO_COUNT_IT_TEXTS.match.questionPrefix}{currentRound.targetColor ? NO_COUNT_IT_TEXTS.colors[currentRound.targetColor] : '…'}»?</h2>
                    <div className="no-count-it-answer-timer" aria-live="polite">{remaining} сек.</div>
                    {myRoundPlayer && myRoundPlayer.answer !== null ? (
                      <p className="no-count-it-answer-submitted">{NO_COUNT_IT_TEXTS.match.yourEstimateResult} {myRoundPlayer?.answer}. {NO_COUNT_IT_TEXTS.match.cannotChangeAnswer}</p>
                    ) : myRoundPlayer?.status === 'active' ? (
                      <div className="no-count-it-answer-value" aria-live="polite">{answerInput || '0'}</div>
                    ) : null}
                  </div>
                  {myRoundPlayer?.status === 'active' && myRoundPlayer.answer === null && (
                    <div className="no-count-it-keypad">
                      {['1','2','3','4','5','6','7','8','9','⌫','0','✓'].map((digit) => (
                        <button
                          key={digit}
                          type="button"
                          className={`no-count-it-key${digit === '✓' ? ' no-count-it-key-submit' : digit === '⌫' ? ' no-count-it-key-delete' : ''}`}
                          aria-label={digit === '⌫' ? 'Удалить последнюю цифру' : digit === '✓' ? 'Отправить ответ' : digit}
                          disabled={loading || remaining <= 0}
                          style={/^\d$/.test(digit) ? keypadStyles[digit] : undefined}
                          onClick={() => {
                            if (digit === '✓') void submitAnswer()
                            else if (digit === '⌫') setAnswerDraft({ roundKey, value: answerInput.slice(0, -1) })
                            else appendDigit(digit)
                          }}
                        >{digit}</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <h2>{NO_COUNT_IT_TEXTS.match.questionPrefix}{currentRound.targetColor ? NO_COUNT_IT_TEXTS.colors[currentRound.targetColor] : '…'}»?</h2>
                  {currentRound.status === 'showing' && <p>{NO_COUNT_IT_TEXTS.match.rememberPrompt} · {imageRemaining} сек.</p>}
                </>
              )}
              {currentRound.status === 'answering' && myRoundPlayer?.status === 'excluded_not_ready' && (
                <p>{NO_COUNT_IT_TEXTS.match.notReady}</p>
              )}
              {isReveal && (
                <>
                  <h2>{NO_COUNT_IT_TEXTS.match.correctAnswer} {currentRound.correctCount}</h2>
                  {currentRound.players.map((player) => (
                    <p key={player.userId}>{player.displayName}: {player.answer ?? NO_COUNT_IT_TEXTS.match.noAnswer} · {NO_COUNT_IT_TEXTS.match.error} {player.error ?? '—'}</p>
                  ))}
                  <button className="play-button" onClick={() => void exitEarly()} disabled={loading}>
                    {NO_COUNT_IT_TEXTS.match.earlyExit}
                  </button>
                </>
              )}
            </section>
          )}

          {currentRound.status !== "showing" && currentRound.status !== "answering" && <section className="game-card">
            <h2>{NO_COUNT_IT_TEXTS.match.totalErrors}</h2>
            {match.players.map((player) => (
              <div className="brain-room-player" key={player.userId}>
                <span>{player.displayName}{player.userId === telegramId ? NO_COUNT_IT_TEXTS.match.you : ''}</span>
                <strong>{player.totalError}</strong>
              </div>
            ))}
          </section>}
        </>
      )}

      {isFinished && match && (
        <section className="game-card">
          <h2>{match.status === 'technical_aborted' ? NO_COUNT_IT_TEXTS.match.technicalAbort : match.status === 'cancelled' ? NO_COUNT_IT_TEXTS.match.cancelled : NO_COUNT_IT_TEXTS.match.completed}</h2>
          {match.status === 'technical_aborted'
            ? <p>{NO_COUNT_IT_TEXTS.match.technicalAbortDetails}</p>
            : match.status === 'cancelled'
              ? <p>{NO_COUNT_IT_TEXTS.match.cancelledDetails}</p>
              : <>
              {match.finalResults?.map((player) => (
                <p key={player.userId}>{player.userId === match.winnerUserId ? '🏆 ' : ''}{player.displayName}: <strong>{player.totalError}</strong> {NO_COUNT_IT_TEXTS.match.errorSuffix}</p>
              ))}
              <p>{match.winnerUserId ? NO_COUNT_IT_TEXTS.match.winner : NO_COUNT_IT_TEXTS.match.tie}</p>
            </>}
          <p>{NO_COUNT_IT_TEXTS.match.autoReturn}</p>
                    <p>{NO_COUNT_IT_TEXTS.match.autoReturn}</p>
          <button className="play-button" onClick={() => void finishAndReturn()} disabled={loading}>{NO_COUNT_IT_TEXTS.match.returnToRoom}</button>
        </section>
      )}
      {message && <section className="game-card" role="alert"><p>{message}</p></section>}
    </main>
  )
}

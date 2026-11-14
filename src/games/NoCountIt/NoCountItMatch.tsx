import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { database } from '../../database'
import type { MultiplayerRoom } from '../../multiplayer'
import { telegramUser } from '../../services/telegram'
import type { NoCountItPaletteColor, NoCountItPublicMatch, NoCountItSnapshot } from './types'

type PositionedRevealPlayer = {
  userId: string
  displayName: string
  answer: number | null
  error: number | null
  nameColor: string
  scoreColor: string
  labelSide: 'left' | 'right'
  top: number
}

type RevealLayout = {
  players: PositionedRevealPlayer[]
  correctPlayers: Array<{ userId: string; displayName: string; nameColor: string }>
  correctGroupHeight: number
  correctGroupTop: number
  upperSpace: number
  centerBandHeight: number
  scaleHeight: number
  answerWindowTop: number
}

const RESULT_ROW_GAP = 58
const RESULT_ROW_HEIGHT = 42
const RESULT_MARKER_CLEARANCE = 28
const RESULT_OUTER_MARGIN = 30
const RESULT_ANSWER_WINDOW_HEIGHT = 62

function buildRevealLayout(
  players: NonNullable<NoCountItPublicMatch['round']>['players'],
  correctCount: number,
  candyColors: NoCountItPaletteColor[],
  seed: string,
): RevealLayout {
  const availableColors = [...new Set(candyColors)].sort()
  const shuffledColors = [...availableColors]
  const random = createSeededRandom(seed)
  for (let index = shuffledColors.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[shuffledColors[index], shuffledColors[target]] = [shuffledColors[target], shuffledColors[index]]
  }
  const colorByUserId = new Map(players.map((player, index) => [
    player.userId,
    CANDY_PALETTE[(shuffledColors[index % Math.max(1, shuffledColors.length)] ?? 'brown') as keyof typeof CANDY_PALETTE].base,
  ] as const))

  const correctPlayers = players.filter((player) => player.error === 0).map((player) => ({
    userId: player.userId,
    displayName: player.displayName,
    nameColor: colorByUserId.get(player.userId) ?? '#8962bd',
  }))
  const incorrectPlayers = players.filter((player) => player.error !== 0)
  const effectiveAnswer = (player: typeof players[number]) => player.answer ?? 0
  const upperPlayers = incorrectPlayers
    .filter((player) => effectiveAnswer(player) > correctCount)
    .sort((a, b) => effectiveAnswer(b) - effectiveAnswer(a))
  const lowerPlayers = incorrectPlayers
    .filter((player) => effectiveAnswer(player) <= correctCount)
    .sort((a, b) => effectiveAnswer(b) - effectiveAnswer(a))

  const correctGroupHeight = correctPlayers.length * RESULT_ROW_HEIGHT + Math.max(0, correctPlayers.length - 1) * 8
  const centerBandHeight = Math.max(RESULT_ANSWER_WINDOW_HEIGHT, correctGroupHeight)
  const upperSpace = Math.max(170, upperPlayers.length * RESULT_ROW_GAP + 60)
  const lowerSpace = Math.max(170, lowerPlayers.length * RESULT_ROW_GAP + 60)
  const scaleHeight = upperSpace + centerBandHeight + lowerSpace
  const upperMaxDeviation = Math.max(1, ...upperPlayers.map((player) => effectiveAnswer(player) - correctCount))
  const lowerMaxDeviation = Math.max(1, ...lowerPlayers.map((player) => correctCount - effectiveAnswer(player)))
  const positioned = new Map<string, number>()
  let previousUpperTop = Number.POSITIVE_INFINITY
  for (const player of [...upperPlayers].reverse()) {
    const ratio = (effectiveAnswer(player) - correctCount) / upperMaxDeviation
    const desiredTop = upperSpace - RESULT_MARKER_CLEARANCE - ratio * (upperSpace - RESULT_MARKER_CLEARANCE - RESULT_OUTER_MARGIN)
    const top = Math.min(desiredTop, previousUpperTop - RESULT_ROW_GAP)
    positioned.set(player.userId, top)
    previousUpperTop = top
  }
  let previousLowerTop = Number.NEGATIVE_INFINITY
  for (const player of lowerPlayers) {
    const ratio = (correctCount - effectiveAnswer(player)) / lowerMaxDeviation
    const desiredTop = upperSpace + centerBandHeight + RESULT_MARKER_CLEARANCE + ratio * (lowerSpace - RESULT_MARKER_CLEARANCE - RESULT_OUTER_MARGIN)
    const top = Math.max(desiredTop, previousLowerTop + RESULT_ROW_GAP)
    positioned.set(player.userId, top)
    previousLowerTop = top
  }
  const sideById = new Map(incorrectPlayers.map((player, index) => [player.userId, index % 2 === 0 ? 'left' : 'right'] as const))
  const resultPlayers: PositionedRevealPlayer[] = incorrectPlayers.map((player) => ({
    userId: player.userId,
    displayName: player.displayName,
    answer: player.answer,
    error: player.error,
    nameColor: colorByUserId.get(player.userId) ?? '#8962bd',
    scoreColor: effectiveAnswer(player) > correctCount ? '#388b43' : '#d34e43',
    labelSide: sideById.get(player.userId) ?? 'left',
    top: positioned.get(player.userId) ?? scaleHeight / 2,
  }))
  return {
    players: resultPlayers, correctPlayers, correctGroupHeight,
    correctGroupTop: upperSpace + (centerBandHeight - correctGroupHeight) / 2,
    upperSpace, centerBandHeight, scaleHeight,
    answerWindowTop: upperSpace + (centerBandHeight - RESULT_ANSWER_WINDOW_HEIGHT) / 2,
  }
}
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

  const keypadStyles = useMemo<Record<string, CSSProperties>>(() => {
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
  const isReveal = currentRound?.status === 'revealing' || currentRound?.status === 'completed'
  const revealLayout = useMemo(() => currentRound && isReveal
    ? buildRevealLayout(currentRound.players, currentRound.correctCount ?? 0, currentRound.candyColors, `${match?.matchId ?? ''}:${currentRound.roundNumber}:result-names`)
    : null,
  [currentRound?.players, currentRound?.correctCount, currentRound?.candyColors, currentRound?.roundNumber, match?.matchId, isReveal])
  const isActiveRoundScreen = currentRound?.status === 'showing' || isAnswering || isReveal

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

          {(currentRound.status === 'showing' || currentRound.status === 'answering') && (
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

            </section>
          )}

          {isReveal && currentRound && revealLayout && (
            <section className="game-card no-count-it-reveal-card">
              <header className="no-count-it-reveal-heading">
                <div className="no-count-it-reveal-round">{NO_COUNT_IT_TEXTS.match.round} {currentRound.roundNumber}</div>
                <h2>{NO_COUNT_IT_TEXTS.match.roundResults}</h2>
              </header>
              <div className="no-count-it-result-columns">
                <span>{NO_COUNT_IT_TEXTS.match.playerAndAnswer}</span>
                <span>{NO_COUNT_IT_TEXTS.match.errorsHeader}</span>
              </div>
              <div className="no-count-it-result-scale" style={{ height: revealLayout.scaleHeight }}>
                <div className="no-count-it-result-axis no-count-it-result-axis-upper" style={{ top: 12, height: Math.max(0, revealLayout.answerWindowTop - 12) }} />
                <div className="no-count-it-result-axis no-count-it-result-axis-lower" style={{ top: revealLayout.upperSpace + revealLayout.centerBandHeight, bottom: 12 }} />
                {revealLayout.correctPlayers.some((player) => player.userId === telegramId) && (
                  <div className="no-count-it-correct-highlight" style={{
                    top: Math.min(revealLayout.correctGroupTop, revealLayout.answerWindowTop),
                    height: Math.max(revealLayout.correctGroupTop + revealLayout.correctGroupHeight, revealLayout.answerWindowTop + RESULT_ANSWER_WINDOW_HEIGHT) - Math.min(revealLayout.correctGroupTop, revealLayout.answerWindowTop),
                  }} />
                )}
                {revealLayout.players.map((player) => {
                  const labelOnLeft = player.labelSide === 'left'
                  const playerLabel = (
                    <div className={`no-count-it-result-player-label ${labelOnLeft ? 'is-left' : 'is-right'}`}>
                      {labelOnLeft ? (
                        <>
                          <span className="no-count-it-result-name" style={{ color: player.nameColor }}>{player.displayName}</span>
                          <span className="no-count-it-result-answer">- {player.answer === null ? NO_COUNT_IT_TEXTS.match.noAnswer : player.answer}</span>
                        </>
                      ) : (
                        <>
                          <span className="no-count-it-result-answer">{player.answer === null ? NO_COUNT_IT_TEXTS.match.noAnswer : player.answer} -</span>
                          <span className="no-count-it-result-name" style={{ color: player.nameColor }}>{player.displayName}</span>
                        </>
                      )}
                    </div>
                  )
                  const score = <div className={`no-count-it-result-score ${labelOnLeft ? 'is-right' : 'is-left'}`} style={{ color: player.scoreColor }}>{player.error ?? '—'}</div>
                  return (
                    <div className="no-count-it-result-player" key={player.userId} style={{ top: player.top }}>
                      {labelOnLeft ? playerLabel : score}
                      {labelOnLeft ? score : playerLabel}
                      <span className="no-count-it-result-dot" style={{ background: player.nameColor }} />
                    </div>
                  )
                })}
                {revealLayout.correctPlayers.length > 0 && (
                  <>
                    <div className="no-count-it-correct-player-list" style={{ top: revealLayout.correctGroupTop }}>
                      {revealLayout.correctPlayers.map((player) => (
                        <div className="no-count-it-correct-player" key={player.userId}>
                          <span>{player.displayName}</span>
                          <span className="no-count-it-correct-player-dot" style={{ background: player.nameColor }} />
                        </div>
                      ))}
                    </div>
                    <div className="no-count-it-correct-zero" style={{ top: revealLayout.answerWindowTop }}>0</div>
                  </>
                )}
                <div className="no-count-it-correct-answer" style={{ top: revealLayout.answerWindowTop }}>
                  <span>{NO_COUNT_IT_TEXTS.match.correctShort}</span>
                  <strong>{currentRound.correctCount ?? 0}</strong>
                </div>
              </div>
              <div className="no-count-it-result-legend">
                <span><i className="is-higher" />{NO_COUNT_IT_TEXTS.match.moreThanCorrect}</span>
                <span><i className="is-lower" />{NO_COUNT_IT_TEXTS.match.lessThanCorrect}</span>
              </div>
              <button className="play-button no-count-it-reveal-exit" onClick={() => void exitEarly()} disabled={loading}>
                {NO_COUNT_IT_TEXTS.match.earlyExit}
              </button>
            </section>
          )}
          {currentRound.status !== "showing" && currentRound.status !== "answering" && !isReveal && <section className="game-card">
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
          <button className="play-button" onClick={() => void finishAndReturn()} disabled={loading}>{NO_COUNT_IT_TEXTS.match.returnToRoom}</button>
        </section>
      )}
      {message && <section className="game-card" role="alert"><p>{message}</p></section>}
    </main>
  )
}

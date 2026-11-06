import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { database } from '../../database'
import { createDatabaseMultiplayerAdapter } from '../../multiplayer'
import type { MultiplayerRoom } from '../../multiplayer'
import { createMultiplayerRoomSession } from '../../multiplayer/roomSession'
import { telegramUser } from '../../services/telegram'

const multiplayer = createDatabaseMultiplayerAdapter({ functionName: 'multiplayer' })

type ReactionRushResult = {
  userId: string
  displayName: string
  score: number
}

type ReactionRushMatch = {
  matchId: string
  roundNumber: number
  roundStartedAt: string
  startedAt: string
  status: 'playing' | 'completed'
  myScore: number
  finalResults?: ReactionRushResult[] | null
  winnerUserId?: string | null
}

type ReactionRushMultiplayerProps = {
  initData: string | undefined
  inviteCode?: string
  onBack: () => void
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export default function ReactionRushMultiplayer({
  initData,
  inviteCode: initialInviteCode,
  onBack,
}: ReactionRushMultiplayerProps) {
  const auth = useMemo(() => ({ initData: initData ?? '' }), [initData])
  const [room, setRoom] = useState<MultiplayerRoom | null>(null)
  const [match, setMatch] = useState<ReactionRushMatch | null>(null)
  const [inviteInput, setInviteInput] = useState(initialInviteCode ?? '')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [remaining, setRemaining] = useState(10)
  const [myScore, setMyScore] = useState(0)
  const [roundResults, setRoundResults] = useState<ReactionRushResult[]>([])
  const [showFinalResults, setShowFinalResults] = useState(true)
  const [realtimeStatus, setRealtimeStatus] = useState('Подключаемся...')
  const [leaderboard, setLeaderboard] = useState<Array<{
    user_id: string
    display_name: string
    wins: number
    matches_played: number
    total_taps: number
    best_match_score: number
  }>>([])
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const sessionRef = useRef<ReturnType<typeof createMultiplayerRoomSession> | null>(null)
  const finishRequestedRef = useRef<string | null>(null)
  const telegramId = telegramUser?.id ? String(telegramUser.id) : ''

  const invokeGame = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    return database.invokeFunction<T, Record<string, unknown>>('reaction-rush', {
      ...body,
      initData: auth.initData,
    })
  }, [auth.initData])

  const acceptRoom = useCallback((nextRoom: MultiplayerRoom) => {
    setRoom(nextRoom)
    if (nextRoom.status === 'waiting' || nextRoom.status === 'cancelled') {
      setMatch(null)
      setMyScore(0)
      setRemaining(10)
    }
  }, [])

  const refreshMatch = useCallback(async () => {
    if (!room?.roomId) return
    const response = await invokeGame<{
      room: MultiplayerRoom
      match: ReactionRushMatch | null
    }>({ action: 'get_match', roomId: room.roomId })
    acceptRoom(response.room)
    setMatch(response.match)
    if (response.match?.status === 'playing') {
      setMyScore(response.match.myScore ?? 0)
    } else if (response.match?.status === 'completed') {
      setShowFinalResults(true)
    }
  }, [room?.roomId, invokeGame, acceptRoom])

  useEffect(() => {
    if (!room?.roomId || !auth.initData) return

    const session = createMultiplayerRoomSession({
      roomId: room.roomId,
      auth,
      service: multiplayer,
      onRoom: acceptRoom,
      onStatus: (status) => setRealtimeStatus(status),
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
    const initialRefresh = window.setTimeout(() => {
      void refreshMatch().catch((error: unknown) => {
        setMessage(getErrorMessage(error, 'Не удалось обновить состояние матча.'))
      })
    }, 0)
    const timer = window.setInterval(() => {
      void refreshMatch().catch((error: unknown) => {
        setMessage(getErrorMessage(error, 'Не удалось обновить состояние матча.'))
      })
    }, 1200)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(timer)
    }
  }, [room?.roomId, room?.status, refreshMatch])

  useEffect(() => {
    if (!match || match.status !== 'playing' || room?.status !== 'playing') return
    const endAt = Date.parse(match.roundStartedAt) + 10_000
    const update = () => setRemaining(Math.max(0, Math.ceil((endAt - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [match?.matchId, match?.roundNumber, match?.roundStartedAt, match?.status, room?.status])

  useEffect(() => {
    if (!match || match.status !== 'playing' || room?.status !== 'playing' || remaining > 0) return
    const requestKey = match.matchId + ':' + match.roundNumber
    if (finishRequestedRef.current === requestKey) return
    finishRequestedRef.current = requestKey

    void invokeGame<{
      completedRound: number
      roundResults: ReactionRushResult[]
      roundNumber?: number
      roundStartedAt?: string
      matchFinished: boolean
      finalResults?: ReactionRushResult[]
      winnerUserId?: string | null
      room?: MultiplayerRoom
    }>({
      action: 'finish_round',
      roomId: room.roomId,
      matchId: match.matchId,
      roundNumber: match.roundNumber,
    }).then((response) => {
      setRoundResults(response.roundResults ?? [])
      if (response.matchFinished) {
        setMatch({
          ...match,
          status: 'completed',
          finalResults: response.finalResults ?? [],
          winnerUserId: response.winnerUserId ?? null,
        })
        if (response.room) acceptRoom(response.room)
        setShowFinalResults(true)
      } else if (response.roundNumber && response.roundStartedAt) {
        setMatch({
          ...match,
          roundNumber: response.roundNumber,
          roundStartedAt: response.roundStartedAt,
          myScore: 0,
        })
        setMyScore(0)
        setRemaining(10)
      }
    }).catch((error: unknown) => {
      // Another participant may have advanced the round first. Refresh the
      // authoritative match state instead of treating that race as a failure.
      void refreshMatch().catch(() => {
        setMessage(getErrorMessage(error, 'Не удалось завершить раунд.'))
      })
    })
  }, [match, room, remaining, invokeGame, acceptRoom, refreshMatch])

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
      setRoundResults([])
      setShowFinalResults(true)
      finishRequestedRef.current = null
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
      setRoundResults([])
      setShowFinalResults(true)
      finishRequestedRef.current = null
      setRoom(joined)
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось присоединиться к комнате.'))
    } finally {
      setLoading(false)
    }
  }

  async function selectGame(gameId: 'reaction-rush') {
    if (!room) return
    setLoading(true)
    setMessage('')
    try {
      const updated = await multiplayer.selectGame(auth, { roomId: room.roomId, gameId })
      acceptRoom(updated)
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось выбрать игру.'))
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
        roundNumber: number
        roundStartedAt: string
        room: MultiplayerRoom
      }>({ action: 'start_match', roomId: room.roomId })
      setRoundResults([])
      setMyScore(0)
      setRemaining(10)
      setMatch({
        matchId: started.matchId,
        roundNumber: started.roundNumber,
        roundStartedAt: started.roundStartedAt,
        startedAt: started.roundStartedAt,
        status: 'playing',
        myScore: 0,
      })
      finishRequestedRef.current = null
      acceptRoom(started.room)
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось начать матч.'))
    } finally {
      setLoading(false)
    }
  }

  async function tap() {
    if (!room || !match || match.status !== 'playing' || room.status !== 'playing' || remaining <= 0) return
    try {
      const response = await invokeGame<{ score: number }>({
        action: 'tap',
        roomId: room.roomId,
        matchId: match.matchId,
        roundNumber: match.roundNumber,
      })
      setMyScore((current) => Math.max(current, response.score))
    } catch (error) {
      setMessage(getErrorMessage(error, 'Нажатие не засчитано.'))
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
      setRoundResults([])
      setMessage('')
      setLoading(false)
    }
    onBack()
  }

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

  function shareInvite() {
    if (!room) return
    const inviteUrl = `https://t.me/yourpartygame_bot/FriendBattle?startapp=rr_${room.inviteCode}`
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent('Сразись со мной в Friend Battle! ⚔️')}`
    window.open(shareUrl, '_blank')
  }

  const me = room?.players.find((player) => player.userId === telegramId)
  const allReady = Boolean(room?.players.length && room.players.every((player) => player.isReady))
  const canStart = Boolean(room?.gameId === 'reaction-rush' && room.players.length >= 2 && room.players.length <= 4 && allReady)
  const isHost = Boolean(me?.isHost)
  const finalResults = match?.status === 'completed' ? match.finalResults ?? [] : []

  return (
    <main className="app">
      <header className="topbar">
        <button className="leaderboard-button" onClick={() => void leaveRoom()} disabled={loading}>
          ← Назад
        </button>
        <div className="logo">FRIEND <span>BATTLE</span></div>
      </header>

      <section className="hero">
        <div className="eyebrow">ИГРА С ДРУЗЬЯМИ</div>
        <div className="game-icon">⚔️</div>
        <h1>ИГРОВАЯ<br /><span>КОМНАТА</span></h1>
        <p>Соберите компанию и выберите игру</p>
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
            <div className="invite-icon">⚔️</div>
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
                  <h2>МАТЧ ЗАВЕРШЁН</h2>
                  {finalResults.map((result) => (
                    <p key={result.userId}>
                      {result.userId === match.winnerUserId ? '🏆 ' : ''}
                      {result.displayName}: <strong>{result.score}</strong>
                    </p>
                  ))}
                  <p>{match.winnerUserId ? 'Победитель получает победу в счёте комнаты!' : 'Ничья! В этот раз без победителя.'}</p>
                  <button className="invite-button" onClick={() => setShowFinalResults(false)}>ЗАВЕРШИТЬ</button>
                  <button className="play-button" onClick={() => void toggleReady()} disabled={loading}>
                    {me?.isReady ? 'ОТМЕНИТЬ ГОТОВНОСТЬ' : 'РЕВАНШ — Я ГОТОВ'}
                  </button>
                </section>
              )}

              <section className="game-card">
                <h2>ВЫБОР ИГРЫ</h2>
                {isHost ? (
                  <select
                    className="invite-input"
                    value={room.gameId ?? ''}
                    onChange={(event) => {
                      if (event.target.value === 'reaction-rush') void selectGame('reaction-rush')
                    }}
                    disabled={loading}
                  >
                    <option value="">Выбери игру</option>
                    <option value="reaction-rush">Reaction Rush</option>
                  </select>
                ) : (
                  <p>Выбрана игра: {room.gameId === 'reaction-rush' ? 'Reaction Rush' : 'Пока не выбрана'}</p>
                )}
                {room.gameId === 'reaction-rush' && <p>Reaction Rush: от 2 до 4 игроков, матч из трёх раундов по 10 секунд.</p>}
                <button className="invite-button" onClick={() => void toggleReady()} disabled={loading || !room.gameId}>
                  {me?.isReady ? 'ОТМЕНИТЬ ГОТОВНОСТЬ' : 'Я ГОТОВ ⚔️'}
                </button>
                {isHost ? (
                  <button className="play-button" onClick={() => void startMatch()} disabled={loading || !canStart}>
                    {room.status === 'finished' ? 'НАЧАТЬ РЕВАНШ' : 'НАЧАТЬ МАТЧ'}
                  </button>
                ) : (
                  <p>Ожидаем, пока ведущий начнёт матч.</p>
                )}
                {room.players.length < 2 && <p>Для начала матча нужен хотя бы ещё один игрок.</p>}
              </section>
            </>
          )}

          {room.status === 'playing' && match?.status === 'playing' && (
            <>
              <section className="stats">
                <div className="stat-card"><span>⚡</span><div><small>ТВОИ ОЧКИ</small><strong>{myScore}</strong></div></div>
                <div className="stat-card"><span>⏱️</span><div><small>ОСТАЛОСЬ</small><strong>{remaining}</strong></div></div>
                <div className="stat-card"><span>🏁</span><div><small>РАУНД</small><strong>{match.roundNumber} / 3</strong></div></div>
              </section>
              {roundResults.length > 0 && (
                <section className="game-card">
                  <h2>РАУНД {match.roundNumber - 1}</h2>
                  {roundResults.map((result) => <p key={result.userId}>{result.displayName}: <strong>{result.score}</strong></p>)}
                </section>
              )}
              <section className="game-card">
                <button className="play-button" onClick={() => void tap()} disabled={remaining <= 0}>
                  ЖМИ! ⚡
                </button>
              </section>
            </>
          )}

          <button className="leaderboard-button" onClick={() => void loadLeaderboard()} disabled={loading}>
            🏆 ЛИДЕРБОРД REACTION RUSH
          </button>
        </>
      )}

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

      {message && <section className="game-card"><p>{message}</p></section>}
    </main>
  )
}

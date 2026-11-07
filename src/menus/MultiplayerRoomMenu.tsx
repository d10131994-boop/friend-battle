import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createDatabaseMultiplayerAdapter,
  createMultiplayerRoomSession,
} from '../multiplayer'
import type { MultiplayerRoom } from '../multiplayer'
import { telegramUser } from '../services/telegram'
import BrainBattleMatch from '../games/BrainBattle/BrainBattleMatch'
import ReactionRushMatch from '../games/ReactionRush/ReactionRushMatch'
import NoCountItMatch from '../games/NoCountIt/NoCountItMatch'

const multiplayer = createDatabaseMultiplayerAdapter({ functionName: 'multiplayer' })

type MultiplayerRoomMenuProps = {
  initData: string | undefined
  inviteCode?: string
  onBack: () => void
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function MultiplayerRoomMenu({ initData, inviteCode, onBack }: MultiplayerRoomMenuProps) {
  const auth = useMemo(() => ({ initData: initData ?? '' }), [initData])
  const [room, setRoom] = useState<MultiplayerRoom | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [realtimeStatus, setRealtimeStatus] = useState('Подключаемся...')
  const [startRequested, setStartRequested] = useState(false)
  const [gameScreen, setGameScreen] = useState(false)
  const [activeGameId, setActiveGameId] = useState<MultiplayerRoom['gameId']>(null)
  const sessionRef = useRef<ReturnType<typeof createMultiplayerRoomSession> | null>(null)
  const autoReadyKeyRef = useRef<string | null>(null)
  const inviteAttemptedRef = useRef(false)
  const telegramId = telegramUser?.id ? String(telegramUser.id) : ''

  const acceptRoom = useCallback((nextRoom: MultiplayerRoom) => {
    setRoom(nextRoom)
    if (nextRoom.gameId) setActiveGameId(nextRoom.gameId)
    if (nextRoom.status === 'playing') setGameScreen(true)
    if (nextRoom.status === 'finished') {
      setGameScreen(false)
      setStartRequested(false)
    }
    if (nextRoom.status === 'cancelled') {
      setGameScreen(false)
      setMessage('Эта комната закрыта.')
    }
  }, [])

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
      setMessage(errorMessage(error, 'Не удалось подключить комнату.'))
    })
    return () => {
      sessionRef.current = null
      void session.stop()
    }
  }, [room?.roomId, auth, acceptRoom])

  useEffect(() => {
    if (!room?.roomId || gameScreen || room.status === 'cancelled' || realtimeStatus === 'SUBSCRIBED') return
    let active = true
    const refreshRoom = async () => {
      try {
        const snapshot = await multiplayer.getRoom(auth, { roomId: room.roomId })
        if (active) acceptRoom(snapshot)
      } catch (error) {
        if (active) setMessage(errorMessage(error, 'Не удалось обновить комнату.'))
      }
    }
    const timer = window.setInterval(() => { void refreshRoom() }, 4000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [room?.roomId, room?.status, gameScreen, realtimeStatus, auth, acceptRoom])

  useEffect(() => {
    if (!room || !auth.initData || (room.status !== 'waiting' && room.status !== 'finished')) return
    const me = room.players.find((player) => player.userId === telegramId)
    if (!me?.isHost || me.isReady) return
    const key = room.roomId + ':' + room.status + ':' + (room.startedAt ?? 'not-started') + ':' + me.userId
    if (autoReadyKeyRef.current === key) return
    autoReadyKeyRef.current = key
    void multiplayer.setReady(auth, { roomId: room.roomId, isReady: true })
      .then(acceptRoom)
      .catch((error: unknown) => {
        autoReadyKeyRef.current = null
        setMessage(errorMessage(error, 'Не удалось подтвердить готовность ведущего.'))
      })
  }, [room, auth, telegramId, acceptRoom])

  const createRoom = useCallback(async () => {
    if (!auth.initData) {
      setMessage('Открой игру через Telegram, чтобы создать комнату.')
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const created = await multiplayer.createRoom(auth, { maxPlayers: 4 })
      acceptRoom(created)
    } catch (error) {
      setMessage(errorMessage(error, 'Не удалось создать комнату.'))
    } finally {
      setLoading(false)
    }
  }, [auth, acceptRoom])

  const joinRoom = useCallback(async (code: string) => {
    if (!auth.initData) {
      setMessage('Открой игру через Telegram, чтобы присоединиться к комнате.')
      return
    }
    if (!code.trim()) {
      setMessage('Не найден код приглашения.')
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const joined = await multiplayer.joinRoom(auth, { inviteCode: code })
      acceptRoom(joined)
    } catch (error) {
      setMessage(errorMessage(error, 'Не удалось присоединиться к комнате.'))
    } finally {
      setLoading(false)
    }
  }, [auth, acceptRoom])

  useEffect(() => {
    if (!inviteCode || inviteAttemptedRef.current || room) return
    inviteAttemptedRef.current = true
    void joinRoom(inviteCode)
  }, [inviteCode, room, joinRoom])

  async function selectGame(gameId: 'reaction-rush' | 'brain-battle' | 'no-count-it') {
    if (!room) return
    setLoading(true)
    setMessage('')
    try {
      const updated = await multiplayer.selectGame(auth, { roomId: room.roomId, gameId })
      setActiveGameId(gameId)
      acceptRoom(updated)
    } catch (error) {
      setMessage(errorMessage(error, 'Не удалось выбрать игру.'))
    } finally {
      setLoading(false)
    }
  }

  async function toggleReady() {
    if (!room) return
    const me = room.players.find((player) => player.userId === telegramId)
    setLoading(true)
    setMessage('')
    try {
      const updated = await multiplayer.setReady(auth, {
        roomId: room.roomId,
        isReady: !me?.isReady,
      })
      acceptRoom(updated)
    } catch (error) {
      setMessage(errorMessage(error, 'Не удалось изменить готовность.'))
    } finally {
      setLoading(false)
    }
  }

  async function leaveRoom() {
    if (!room) {
      onBack()
      return
    }
    setLoading(true)
    setMessage('')
    try {
      await multiplayer.leaveRoom(auth, { roomId: room.roomId })
      await sessionRef.current?.stop()
      setRoom(null)
      setActiveGameId(null)
      setGameScreen(false)
      setStartRequested(false)
      onBack()
    } catch (error) {
      setMessage(errorMessage(error, 'Не удалось выйти из комнаты.'))
    } finally {
      setLoading(false)
    }
  }

  function shareInvite() {
    if (!room) return
    const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'yourpartygame_bot'
    const app = import.meta.env.VITE_TELEGRAM_APP_SHORT_NAME || 'FriendBattle'
    const inviteUrl = `https://t.me/${bot}/${app}?startapp=fb_${room.inviteCode}`
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent('Присоединяйся к моей комнате в Friend Battle! ⚔️')}`
    window.open(shareUrl, '_blank')
  }

  const startGame = useCallback(() => {
    setMessage('')
    setStartRequested(true)
    setGameScreen(true)
  }, [])

  function returnToRoom() {
    setGameScreen(false)
    setStartRequested(false)
  }

  const me = room?.players.find((player) => player.userId === telegramId)
  const isHost = Boolean(me?.isHost)
  const allReady = Boolean(room?.players.length && room.players.every((player) => player.isReady))
  const canStart = Boolean(
    isHost &&
    room?.gameId &&
    room.status !== 'playing' &&
    room.status !== 'cancelled' &&
    room.players.length >= 2 &&
    room.players.length <= 4 &&
    allReady,
  )

  if (gameScreen && room?.gameId === 'brain-battle') {
    return (
      <BrainBattleMatch
        initData={initData}
        room={room}
        startRequested={startRequested}
        onRoomUpdate={acceptRoom}
        onReturnToRoom={returnToRoom}
        onStartRequestHandled={() => setStartRequested(false)}
      />
    )
  }

  if (gameScreen && (room?.gameId === 'no-count-it' || (activeGameId === 'no-count-it' && room?.status === 'waiting'))) {
    return (
      <NoCountItMatch
        initData={initData}
        room={room}
        startRequested={startRequested}
        onRoomUpdate={acceptRoom}
        onReturnToRoom={returnToRoom}
        onStartRequestHandled={() => setStartRequested(false)}
      />
    )
  }

  if (gameScreen && room?.gameId === 'reaction-rush') {
    return (
      <ReactionRushMatch
        initData={initData}
        room={room}
        startRequested={startRequested}
        onRoomUpdate={acceptRoom}
        onReturnToRoom={returnToRoom}
        onStartRequestHandled={() => setStartRequested(false)}
      />
    )
  }

  return (
    <main className="app">
      <header className="topbar">
        <button className="leaderboard-button menu-back-button" onClick={() => void leaveRoom()} disabled={loading}>← НАЗАД</button>
        <div className="logo">FRIEND <span>BATTLE</span></div>
      </header>
      <section className="hero">
        <div className="eyebrow">СОВМЕСТНАЯ ИГРА</div>
        <div className="game-icon">⚔️</div>
        <h1>ИГРАЙ <span>ВМЕСТЕ</span></h1>
        <p>Создай комнату или присоединись к друзьям</p>
      </section>

      {!room && (
        <section className="game-card">
          <button className="play-button" onClick={() => void createRoom()} disabled={loading}>
            {loading ? 'СОЗДАЁМ...' : 'СОЗДАТЬ КОМНАТУ'}
          </button>
          {inviteCode && <p>Подключаемся по приглашению {inviteCode}…</p>}
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
            </div>
            <button className="invite-button" onClick={shareInvite}>ПРИГЛАСИТЬ</button>
          </section>

          <section className="game-card">
            <h2>УЧАСТНИКИ</h2>
            <div className="room-player-list">
              {room.players.map((player) => (
                <div className="room-player-row" key={player.userId}>
                  <div className="room-player-main">
                    <strong>{player.displayName}{player.userId === telegramId ? ' (ты)' : ''}{player.isHost ? ' 👑' : ''}</strong>
                    <span>{player.isHost ? 'Ведущий' : player.isReady ? 'Готов' : 'Ожидает'}</span>
                  </div>
                  <div className="room-player-stats">
                    <strong>{player.wins} побед</strong>
                    <span>{player.matchesPlayed} матчей</span>
                  </div>
                </div>
              ))}
            </div>
            <p>Победа в матче приносит 1 победу в общий счёт комнаты.</p>
          </section>

          {room.status !== 'playing' && room.status !== 'cancelled' && (
            <section className="game-card">
              <h2>ВЫБОР ИГРЫ</h2>
              {isHost ? (
                <select
                  className="invite-input"
                  value={room.gameId ?? ''}
                  onChange={(event) => {
                    if (event.target.value === 'reaction-rush' || event.target.value === 'brain-battle' || event.target.value === 'no-count-it') {
                      void selectGame(event.target.value)
                    }
                  }}
                  disabled={loading}
                >
                  <option value="">Выбери игру</option>
                  <option value="reaction-rush">Reaction Rush</option>
                  <option value="brain-battle">Brain Battle</option>
                  <option value="no-count-it">NoCountIt</option>
                </select>
              ) : (
                <p>Выбрана игра: {room.gameId === 'reaction-rush' ? 'Reaction Rush' : room.gameId === 'brain-battle' ? 'Brain Battle' : room.gameId === 'no-count-it' ? 'NoCountIt' : 'Пока не выбрана'}</p>
              )}
              {room.gameId === 'reaction-rush' && <p>Три раунда по 10 секунд. От 2 до 4 игроков.</p>}
              {room.gameId === 'brain-battle' && <p>10 вопросов, 15 секунд на ответ. От 2 до 4 игроков.</p>}
              {room.gameId === 'no-count-it' && <p>Три раунда на оценку количества конфет. От 2 до 4 игроков.</p>}
              {room.gameId && (
                <>
                  {!isHost && (
                    <button
                      className={`ready-button ${me?.isReady ? 'is-ready' : 'is-not-ready'}`}
                      onClick={() => void toggleReady()}
                      disabled={loading}
                    >
                      {me?.isReady ? 'ГОТОВ ✓' : 'Я ГОТОВ'}
                    </button>
                  )}
                  {isHost ? (
                    <button className="play-button" onClick={startGame} disabled={loading || !canStart}>
                      НАЧАТЬ
                    </button>
                  ) : (
                    <p>Ожидаем, пока ведущий начнёт игру.</p>
                  )}
                  {room.players.length < 2 && <p>Для начала нужен хотя бы ещё один игрок.</p>}
                  {room.players.length >= 2 && !allReady && <p>Ожидаем готовности участников.</p>}
                </>
              )}
            </section>
          )}
        </>
      )}

      {message && <section className="game-card" role="alert"><p>{message}</p></section>}
    </main>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { database } from '../../database'
import {
  createDatabaseMultiplayerAdapter,
} from '../../multiplayer'
import type { MultiplayerRoom } from '../../multiplayer'
import { createMultiplayerRoomSession } from '../../multiplayer/roomSession'
import { telegramUser } from '../../services/telegram'

const multiplayer = createDatabaseMultiplayerAdapter({ functionName: 'multiplayer' })

type ReactionRushResult = {
  userId: string
  displayName: string
  score: number
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
  const [inviteInput, setInviteInput] = useState(initialInviteCode ?? '')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [remaining, setRemaining] = useState(10)
  const [myScore, setMyScore] = useState(0)
  const [results, setResults] = useState<ReactionRushResult[]>([])
  const [realtimeStatus, setRealtimeStatus] = useState('Подключаемся...')
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
    if (nextRoom.status !== 'playing') {
      setMyScore(0)
      setRemaining(10)
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
      setMessage(getErrorMessage(error, 'Не удалось подключить комнату.'))
    })

    return () => {
      sessionRef.current = null
      void session.stop()
    }
  }, [room?.roomId, auth, acceptRoom])

  useEffect(() => {
    if (!room?.startedAt || room.status !== 'playing') return

    const startedAt = Date.parse(room.startedAt)
    const endAt = startedAt + 10_000
    const update = () => setRemaining(Math.max(0, Math.ceil((endAt - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 100)

    return () => window.clearInterval(timer)
  }, [room?.startedAt, room?.status])

  useEffect(() => {
    if (!room || room.status !== 'playing' || remaining > 0 || !room.startedAt) return
    if (finishRequestedRef.current === room.startedAt) return
    finishRequestedRef.current = room.startedAt

    void invokeGame<{ results: ReactionRushResult[] }>({
      action: 'finish_round',
      roomId: room.roomId,
      startedAt: room.startedAt,
    }).then((response) => {
      setResults(response.results ?? [])
    }).catch((error: unknown) => {
      finishRequestedRef.current = null
      setMessage(getErrorMessage(error, 'Не удалось завершить раунд.'))
    })
  }, [room, remaining, invokeGame])

  useEffect(() => {
    if (!room || room.status !== 'finished' || !room.startedAt) return
    if (finishRequestedRef.current === room.startedAt) return
    finishRequestedRef.current = room.startedAt
    void invokeGame<{ results: ReactionRushResult[] }>({
      action: 'finish_round',
      roomId: room.roomId,
      startedAt: room.startedAt,
    }).then((response) => setResults(response.results ?? []))
      .catch((error: unknown) => {
        finishRequestedRef.current = null
        setMessage(getErrorMessage(error, 'Не удалось загрузить результаты раунда.'))
      })
  }, [room, invokeGame])

  async function createRoom() {
    if (!auth.initData) {
      setMessage('Открой игру через Telegram, чтобы создать комнату.')
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const created = await multiplayer.createRoom(auth, {
        gameId: 'reaction-rush',
        maxPlayers: 2,
      })
      setResults([])
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
      if (joined.gameId !== 'reaction-rush') {
        throw new Error('Это приглашение относится к другой игре.')
      }
      setResults([])
      finishRequestedRef.current = null
      setRoom(joined)
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось присоединиться к комнате.'))
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

  async function startRound() {
    if (!room) return
    setLoading(true)
    setMessage('')
    try {
      const started = await invokeGame<MultiplayerRoom>({
        action: 'start_round',
        roomId: room.roomId,
      })
      setResults([])
      setMyScore(0)
      setRemaining(10)
      finishRequestedRef.current = null
      acceptRoom(started)
    } catch (error) {
      setMessage(getErrorMessage(error, 'Не удалось начать раунд.'))
    } finally {
      setLoading(false)
    }
  }

  async function tap() {
    if (!room?.startedAt || room.status !== 'playing' || remaining <= 0) return
    try {
      const response = await invokeGame<{ score: number }>({
        action: 'tap',
        roomId: room.roomId,
        startedAt: room.startedAt,
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
      setResults([])
      setMessage('')
      setLoading(false)
      onBack()
    } else {
      onBack()
    }
  }

  function shareInvite() {
    if (!room) return
    const inviteUrl = `https://t.me/yourpartygame_bot/FriendBattle?startapp=rr_${room.inviteCode}`
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent('Сразись со мной в Reaction Rush! ⚡')}`
    window.open(shareUrl, '_blank')
  }

  const me = room?.players.find((player) => player.userId === telegramId)
  const allReady = Boolean(room?.players.length && room.players.every((player) => player.isReady))
  const isHost = Boolean(me?.isHost)

  return (
    <main className="app">
      <header className="topbar">
        <button className="leaderboard-button" onClick={() => void leaveRoom()} disabled={loading || room?.status === 'playing'}>
          ← Назад
        </button>
        <div className="logo">FRIEND <span>BATTLE</span></div>
      </header>

      <section className="hero">
        <div className="eyebrow">БИТВА С ДРУГОМ</div>
        <div className="game-icon">⚡</div>
        <h1>REACTION<br /><span>RUSH</span></h1>
        <p>Кто быстрее нажмёт за 10 секунд?</p>
      </section>

      {!room && (
        <section className="game-card">
          <button className="play-button" onClick={() => void createRoom()} disabled={loading}>
            {loading ? 'СОЗДАЁМ...' : 'СОЗДАТЬ КОМНАТУ'}
          </button>
          <p>Или присоединись к другу по коду</p>
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
              <strong>Комната {room.inviteCode}</strong>
              <p>{realtimeStatus === 'SUBSCRIBED' ? 'Синхронизация активна' : realtimeStatus}</p>
              <p>{room.players.length} / {room.maxPlayers ?? '∞'} игроков</p>
              {room.players.map((player) => (
                <p key={player.userId}>
                  {player.displayName}{player.isHost ? ' 👑' : ''} — {player.isReady ? '✅ Готов' : '⏳ Не готов'}
                  {player.userId === telegramId ? ' (ты)' : ''}
                </p>
              ))}
            </div>
            <button className="invite-button" onClick={shareInvite}>ПРИГЛАСИТЬ ДРУГА</button>
          </section>

          {room.status === 'waiting' && (
            <section className="game-card">
              <button className="play-button" onClick={() => void toggleReady()} disabled={loading}>
                {me?.isReady ? 'ОТМЕНИТЬ ГОТОВНОСТЬ' : 'Я ГОТОВ ⚔️'}
              </button>
              {isHost && (
                <button className="invite-button" onClick={() => void startRound()} disabled={loading || !allReady}>
                  НАЧАТЬ РАУНД
                </button>
              )}
              {!isHost && <p>Ожидаем, пока создатель комнаты начнёт раунд.</p>}
            </section>
          )}

          {room.status === 'playing' && (
            <>
              <section className="stats">
                <div className="stat-card"><span>⚡</span><div><small>ТВОИ ОЧКИ</small><strong>{myScore}</strong></div></div>
                <div className="stat-card"><span>⏱️</span><div><small>ОСТАЛОСЬ</small><strong>{remaining}</strong></div></div>
              </section>
              <section className="game-card">
                <button className="play-button" onClick={() => void tap()} disabled={remaining <= 0}>
                  ЖМИ! ⚡
                </button>
              </section>
            </>
          )}

          {room.status === 'finished' && (
            <section className="game-card">
              <h2>РАУНД ЗАВЕРШЁН</h2>
              {results.length > 0 ? results.map((result) => (
                <p key={result.userId}>{result.displayName}: <strong>{result.score}</strong></p>
              )) : <p>Загружаем результаты...</p>}
              {isHost && (
                <button className="play-button" onClick={() => void startRound()} disabled={loading || !allReady}>
                  СЛЕДУЮЩИЙ РАУНД
                </button>
              )}
              <button className="invite-button" onClick={() => void toggleReady()} disabled={loading}>
                {me?.isReady ? 'ОТМЕНИТЬ ГОТОВНОСТЬ' : 'ГОТОВ К НОВОМУ РАУНДУ'}
              </button>
            </section>
          )}
        </>
      )}

      {message && <section className="game-card"><p>{message}</p></section>}
    </main>
  )
}

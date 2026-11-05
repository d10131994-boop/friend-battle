import { useState } from 'react'
import { telegramInitData, telegramUser } from '../services/telegram'
import { createDatabaseMultiplayerAdapter } from './databaseAdapter'
import { createMultiplayerRoomSession } from './roomSession'
import type { MultiplayerRoom } from './types'

const service = createDatabaseMultiplayerAdapter({ functionName: 'multiplayer' })

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(
      () => reject(new Error(`Тайм-аут: ${label}`)),
      timeoutMs,
    )
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}

/**
 * Temporary diagnostic surface. It is mounted only in Vite development mode
 * with ?multiplayer-smoke=1. Telegram initData and the issued JWT never leave
 * this browser context and are never rendered or logged.
 */
export default function DevMultiplayerSmokeTest() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState('Готов к проверке.')
  const [steps, setSteps] = useState<string[]>([])

  async function runTest() {
    if (running) return
    if (!telegramInitData) {
      setResult('Telegram initData не найден. Открой dev-версию внутри Telegram Mini App.')
      return
    }

    setRunning(true)
    setSteps([])
    setResult('Проверка выполняется…')

    const addStep = (step: string) => setSteps((current) => [...current, step])
    let room: MultiplayerRoom | null = null
    let session: ReturnType<typeof createMultiplayerRoomSession> | null = null
    const auth = { initData: telegramInitData }

    let resolveSubscribed!: () => void
    let resolveInitialSnapshot!: () => void
    let resolveReadySnapshot!: () => void
    let rejectWatcher!: (error: Error) => void
    const subscribed = new Promise<void>((resolve) => { resolveSubscribed = resolve })
    const initialSnapshot = new Promise<void>((resolve) => { resolveInitialSnapshot = resolve })
    const readySnapshot = new Promise<void>((resolve) => { resolveReadySnapshot = resolve })
    const watcherError = new Promise<never>((_, reject) => { rejectWatcher = reject })
    // The watcher can fail before the first await below; mark the rejection handled immediately.
    void watcherError.catch(() => undefined)

    try {
      addStep('Создаём отдельную тестовую комнату…')
      room = await service.createRoom(auth, {
        gameId: 'multiplayer-smoke-test',
        maxPlayers: 1,
      })
      addStep(`Комната создана: ${room.roomId}`)

      session = createMultiplayerRoomSession({
        roomId: room.roomId,
        auth,
        service,
        onRoom: (snapshot) => {
          if (snapshot.roomId !== room?.roomId) return
          resolveInitialSnapshot()
          if (snapshot.players.some((player) =>
            player.userId === String(telegramUser?.id) && player.isReady
          )) {
            resolveReadySnapshot()
          }
        },
        onStatus: (status, error) => {
          if (status === 'SUBSCRIBED') resolveSubscribed()
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            rejectWatcher(error ?? new Error(`Realtime status: ${status}`))
          }
        },
        onError: rejectWatcher,
      })

      addStep('Получаем JWT и подключаемся к приватному Realtime-каналу…')
      await session.start()
      await withTimeout(Promise.race([Promise.all([subscribed, initialSnapshot]), watcherError]), 'подписка Realtime')
      addStep('Realtime SUBSCRIBED; начальный снимок комнаты получен.')

      addStep('Меняем готовность игрока и ждём Broadcast → обновлённый снимок…')
      await service.setReady(auth, { roomId: room.roomId, isReady: true })
      await withTimeout(Promise.race([readySnapshot, watcherError]), 'Broadcast и обновление комнаты')
      addStep('Broadcast принят: клиент получил обновлённое состояние через get_room.')
      setResult('УСПЕХ: создание комнаты, выдача JWT, приватная Realtime-подписка и Broadcast работают.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
      setResult(`Проверка не пройдена: ${message}`)
    } finally {
      if (session) {
        try {
          await session.stop()
        } catch {
          addStep('Предупреждение: не удалось штатно закрыть Realtime-подписку.')
        }
      }
      if (room) {
        try {
          await service.closeRoom(auth, { roomId: room.roomId })
          addStep('Тестовая комната закрыта.')
        } catch {
          addStep('ВНИМАНИЕ: автоматическое закрытие комнаты не удалось; её очистит idle-cleanup.')
        }
      }
      setRunning(false)
    }
  }

  return (
    <aside style={{
      position: 'fixed',
      zIndex: 10000,
      left: 12,
      right: 12,
      bottom: 84,
      maxHeight: '55vh',
      overflow: 'auto',
      padding: 16,
      border: '1px solid #777',
      borderRadius: 12,
      background: '#171717',
      color: '#fff',
      fontSize: 13,
      boxShadow: '0 4px 24px #0008',
    }}>
      <strong>Multiplayer Core · dev smoke test</strong>
      <p style={{ margin: '8px 0' }}>{result}</p>
      {steps.length > 0 && (
        <ol style={{ margin: '8px 0', paddingLeft: 20 }}>
          {steps.map((step, index) => <li key={index}>{step}</li>)}
        </ol>
      )}
      <button type="button" disabled={running} onClick={() => void runTest()}>
        {running ? 'ПРОВЕРЯЕМ…' : 'ЗАПУСТИТЬ ПРОВЕРКУ'}
      </button>
    </aside>
  )
}

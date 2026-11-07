import { useCallback, useEffect, useRef, useState } from 'react'
import { telegramUser } from '../../services/telegram'
import type { MultiplayerRoom } from '../../multiplayer'
import {
  buyDemocracyMergeTool,
  getDemocracyMergeMatch,
  leaveDemocracyMergeMatch,
  placeDemocracyMergeCharacter,
  returnDemocracyMergeToRoom,
  startDemocracyMergeMatch,
  surrenderDemocracyMergeMatch,
  useDemocracyMergeTool,
  type DemocracyMergeActionResponse,
  type DemocracyMergeSnapshot,
} from './api'
import type { ToolType } from './logic/tools'
import './DemocracyMerge.css'

type Props = {
  initData: string | undefined
  room: MultiplayerRoom
  startRequested: boolean
  onRoomUpdate: (room: MultiplayerRoom) => void
  onReturnToRoom: () => void
  onLeaveMatch: () => void
  onMainMenu: () => void
  onStartRequestHandled: () => void
}

const toolLabels: Record<ToolType, string> = {
  saw: 'Пила',
  storage: 'Хранилище',
  swap: 'Перестановка',
  replace: 'Замена',
}
const toolIcons: Record<ToolType, string> = {
  saw: '🪚',
  storage: '📦',
  swap: '🔀',
  replace: '🔄',
}
const toolPrices: Record<ToolType, number> = {
  saw: 45,
  storage: 60,
  swap: 55,
  replace: 75,
}
const obstacleLabels = {
  barricade: 'Заграждение',
  police: 'Полицейский',
  rock: 'Камень',
}
const obstacleIcons = {
  barricade: '🧱',
  police: '👮',
  rock: '🪨',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие.'
}
function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
function createActionId(): string {
  return crypto.randomUUID()
}

export default function DemocracyMergeMatch({
  initData, room, startRequested, onRoomUpdate, onReturnToRoom, onLeaveMatch, onMainMenu, onStartRequestHandled,
}: Props) {
  const [snapshot, setSnapshot] = useState<DemocracyMergeSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(Date.now())
  const [selectedTool, setSelectedTool] = useState<ToolType | null>(null)
  const [swapFirstCell, setSwapFirstCell] = useState<number | null>(null)
  const [shopOpen, setShopOpen] = useState(false)
  const [surrenderConfirm, setSurrenderConfirm] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [oneMinuteNotice, setOneMinuteNotice] = useState(false)
  const startAttemptRef = useRef(false)
  const oneMinuteNoticeRef = useRef<string | null>(null)
  const oneMinuteTimeoutRef = useRef<number | null>(null)
  const telegramId = telegramUser?.id ? String(telegramUser.id) : ''

  const match = snapshot?.match ?? null
  const me = match?.me ?? null

  const refreshMatch = useCallback(async () => {
    const next = await getDemocracyMergeMatch(initData, room.roomId)
    onRoomUpdate(next.room)
    setSnapshot(next)
    return next
  }, [initData, room.roomId, onRoomUpdate])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const next = await getDemocracyMergeMatch(initData, room.roomId)
        if (!active) return
        onRoomUpdate(next.room)
        setSnapshot(next)
      } catch (error) {
        if (active) setMessage(errorMessage(error))
      }
    }
    void refresh()
    const interval = match?.status === 'completed' || match?.status === 'cancelled'
      ? null
      : window.setInterval(() => { void refresh() }, 1500)
    return () => {
      active = false
      if (interval !== null) window.clearInterval(interval)
    }
  }, [initData, room.roomId, match?.status, onRoomUpdate])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  const startMatch = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const response = await startDemocracyMergeMatch(initData, room.roomId)
      onRoomUpdate(response.room)
      await refreshMatch()
    } catch (error) {
      setMessage(errorMessage(error))
      onReturnToRoom()
    } finally {
      setLoading(false)
      onStartRequestHandled()
    }
  }, [initData, room.roomId, onRoomUpdate, refreshMatch, onReturnToRoom, onStartRequestHandled])

  const meInRoom = room.players.find((player) => player.userId === telegramId)
  useEffect(() => {
    if (!startRequested || !meInRoom?.isHost || room.status === 'playing' || startAttemptRef.current) return
    startAttemptRef.current = true
    void startMatch()
  }, [startRequested, meInRoom?.isHost, room.status, startMatch])

  useEffect(() => {
    if (!match?.deadlineAt) return
    const remaining = Date.parse(match.deadlineAt) - now
    if (remaining > 0 && remaining <= 60_000 && oneMinuteNoticeRef.current !== match.matchId) {
      oneMinuteNoticeRef.current = match.matchId
      setOneMinuteNotice(true)
      oneMinuteTimeoutRef.current = window.setTimeout(() => setOneMinuteNotice(false), 3000)
    }
  }, [match?.deadlineAt, match?.matchId, now])

  useEffect(() => () => {
    if (oneMinuteTimeoutRef.current !== null) window.clearTimeout(oneMinuteTimeoutRef.current)
  }, [])

  const isCountdown = Boolean(match?.gameStartedAt && Date.parse(match.gameStartedAt) > now)
  const countdown = match?.gameStartedAt
    ? Math.max(0, Math.ceil((Date.parse(match.gameStartedAt) - now) / 1000))
    : 0
  const remaining = match?.deadlineAt ? Date.parse(match.deadlineAt) - now : 0
  const timerLabel = formatTime(remaining)
  const deadlineReached = remaining <= 0
  const canAct = Boolean(match?.status === 'playing' && me?.status === 'active' && !loading && !isCountdown && !deadlineReached)

  const applyResponse = useCallback((response: DemocracyMergeActionResponse) => {
    onRoomUpdate(response.room)
    setSnapshot(response)
    setMessage('')
  }, [onRoomUpdate])

  const submitAction = useCallback(async (
    action: () => Promise<DemocracyMergeActionResponse>,
  ) => {
    if (loading) return
    setLoading(true)
    setMessage('')
    try {
      const response = await action()
      applyResponse(response)
      setSelectedTool(null)
      setSwapFirstCell(null)
    } catch (error) {
      setMessage(errorMessage(error))
      try { await refreshMatch() } catch { /* keep the original action error visible */ }
    } finally {
      setLoading(false)
    }
  }, [loading, applyResponse, refreshMatch])

  async function clickCell(index: number) {
    if (!canAct || !me || !match) return
    if (!selectedTool) {
      await submitAction(() => placeDemocracyMergeCharacter(initData, room.roomId, index, createActionId()))
      return
    }
    if (selectedTool === 'replace') return
    if (selectedTool === 'swap') {
      if (swapFirstCell === null) {
        setSwapFirstCell(index)
        setMessage('Выберите вторую клетку для перестановки.')
        return
      }
      await submitAction(() => useDemocracyMergeTool(initData, room.roomId, 'swap', createActionId(), {
        firstCellIndex: swapFirstCell,
        secondCellIndex: index,
      }))
      return
    }
    if (selectedTool === 'storage') {
      await submitAction(() => useDemocracyMergeTool(initData, room.roomId, 'storage', createActionId(), {
        cellIndex: index,
        storageAction: me.storage ? 'return' : 'store',
      }))
      return
    }
    await submitAction(() => useDemocracyMergeTool(initData, room.roomId, 'saw', createActionId(), {
      cellIndex: index,
    }))
  }

  function selectTool(tool: ToolType) {
    if (!canAct || !me) return
    if (me.inventory[tool] < 1) {
      setMessage(`Нет инструмента «${toolLabels[tool]}» в инвентаре.`)
      return
    }
    if (tool === 'replace') {
      void submitAction(() => useDemocracyMergeTool(initData, room.roomId, 'replace', createActionId()))
      return
    }
    setSelectedTool((previous) => previous === tool ? null : tool)
    setSwapFirstCell(null)
    setMessage(tool === 'storage' && me.storage
      ? 'Выберите свободную клетку, чтобы вернуть персонажа из хранилища.'
      : `Выберите клетку для инструмента «${toolLabels[tool]}».`)
  }

  async function buy(tool: ToolType) {
    await submitAction(() => buyDemocracyMergeTool(initData, room.roomId, tool, createActionId()))
  }

  async function surrender() {
    setSurrenderConfirm(false)
    await submitAction(() => surrenderDemocracyMergeMatch(initData, room.roomId, createActionId()))
  }

  async function leaveMatch() {
    setLeaveConfirm(false)
    setLoading(true)
    setMessage('')
    try {
      await leaveDemocracyMergeMatch(initData, room.roomId)
      onLeaveMatch()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  async function returnToRoom() {
    setLoading(true)
    setMessage('')
    try {
      const response = await returnDemocracyMergeToRoom(initData, room.roomId)
      onRoomUpdate(response.room)
      onReturnToRoom()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  if (!match || !me) {
    return (
      <main className="app dm-match-shell">
        <header className="topbar"><div className="logo">DEMOCRACY <span>MERGE</span></div></header>
        <section className="dm-waiting">
          <h1>DEMOCRACY MERGE</h1>
          <p>{room.status === 'playing' ? 'Загружаем состояние матча…' : 'Ожидаем запуска матча ведущим.'}</p>
          {message && <p className="dm-message">{message}</p>}
          <button className="dm-secondary-button" onClick={onReturnToRoom}>ВЕРНУТЬСЯ В КОМНАТУ</button>
        </section>
      </main>
    )
  }

  const ownRank = match.finalResults?.find((player) => player.userId === telegramId)?.rank ?? null
  const board = me.board

  return (
    <main className="app dm-match-shell">
      <header className="dm-header">
        <button className="dm-secondary-button" onClick={() => setLeaveConfirm(true)} disabled={!canAct}>ВЫЙТИ ИЗ МАТЧА</button>
        <div><div className="dm-eyebrow">FRIEND BATTLE</div><h1>DEMOCRACY <span>MERGE</span></h1></div>
        <div className={`dm-timer ${remaining <= 300_000 ? 'dm-timer-warning' : ''}`}>
          <small>ОСТАЛОСЬ</small><strong>{timerLabel}</strong>
        </div>
      </header>

      {isCountdown && (
        <div className="dm-countdown"><span>{countdown > 0 ? countdown : 'СТАРТ!'}</span></div>
      )}
      {oneMinuteNotice && <div className="dm-toast">До окончания матча осталась 1 минута</div>}
      {message && <div className="dm-message">{message}</div>}

      {match.status === 'completed' || match.status === 'cancelled' ? (
        <section className="dm-results">
          <h2>{match.status === 'completed' ? 'МАТЧ ЗАВЕРШЁН' : 'КОМНАТА ЗАКРЫТА'}</h2>
          {match.finalResults && (
            <table className="dm-results-table">
              <thead><tr><th>МЕСТО</th><th>ИГРОК</th><th>ОЧКИ</th><th>УРОВЕНЬ</th></tr></thead>
              <tbody>
                {match.finalResults.map((player) => (
                  <tr key={player.userId} className={player.userId === telegramId ? 'dm-own-result' : ''}>
                    <td>{player.rank ?? '—'}</td>
                    <td>{player.displayName}{player.status === 'left' ? ' · Вышел' : ''}</td>
                    <td>{player.score}</td><td>{player.maxLevel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="dm-personal-result">
            <h3>ТВОЙ РЕЗУЛЬТАТ</h3>
            <p>Очки: <strong>{me.score}</strong></p>
            <p>Максимальный уровень: <strong>{me.maxLevel}</strong></p>
            <p>Объединений: <strong>{me.mergeCount}</strong></p>
            <p>Цепных реакций: <strong>{me.chainReactions}</strong></p>
            <p>Использовано инструментов: <strong>{me.toolsUsed}</strong></p>
            <p>Осталось монет: <strong>{me.coins}</strong></p>
            <p>Место: <strong>{ownRank ?? 'Без места'}</strong></p>
          </div>
          {room.status === 'cancelled'
            ? <button className="dm-primary-button" onClick={onMainMenu}>В ГЛАВНОЕ МЕНЮ</button>
            : <button className="dm-primary-button" onClick={() => void returnToRoom()} disabled={loading}>ВЕРНУТЬСЯ В КОМНАТУ</button>}
        </section>
      ) : (
        <div className="dm-layout">
          <aside className="dm-side-panel">
            <div className="dm-current-card">
              <small>ТЕКУЩИЙ ПЕРСОНАЖ</small>
              <strong>{match.currentCharacter ?? '—'}</strong>
              <span>Следующий: {match.nextCharacter ?? '—'}</span>
            </div>
            <div className="dm-stats">
              <div><small>ОЧКИ</small><strong>{me.score}</strong></div>
              <div><small>МАКС. УРОВЕНЬ</small><strong>{me.maxLevel}</strong></div>
              <div><small>МОНЕТЫ</small><strong>🪙 {me.coins}</strong></div>
            </div>
            <button className="dm-primary-button" onClick={() => setShopOpen(true)} disabled={!canAct}>МАГАЗИН</button>
            <div className="dm-tools">
              <h3>ИНСТРУМЕНТЫ</h3>
              {(['saw', 'storage', 'swap', 'replace'] as ToolType[]).map((tool) => (
                <button
                  key={tool}
                  className={`dm-tool-button ${selectedTool === tool ? 'dm-tool-selected' : ''}`}
                  onClick={() => selectTool(tool)}
                  disabled={!canAct || me.inventory[tool] < 1}
                >
                  <span>{toolIcons[tool]} {toolLabels[tool]}</span>
                  <strong>{me.inventory[tool]}/3</strong>
                </button>
              ))}
              {me.storage && <p className="dm-storage-note">В хранилище: персонаж уровня {me.storage.level}</p>}
              {!me.storage && <p className="dm-storage-note">Хранилище пусто</p>}
            </div>
            {me.status === 'active' && (
              <button className="dm-danger-button" onClick={() => setSurrenderConfirm(true)} disabled={!canAct}>СДАТЬСЯ</button>
            )}
          </aside>

          <section className="dm-board-section">
            <div className="dm-board" aria-label="Игровое поле 6 на 6">
              {board.map((cell, index) => (
                <button
                  key={index}
                  className={`dm-cell ${cell?.kind === 'obstacle' ? 'dm-obstacle' : ''} ${swapFirstCell === index ? 'dm-cell-selected' : ''}`}
                  onClick={() => void clickCell(index)}
                  disabled={!canAct}
                  aria-label={cell === null ? `Свободная клетка ${index + 1}` : cell.kind === 'character'
                    ? `Персонаж уровня ${cell.level}`
                    : obstacleLabels[cell.obstacleType]}
                >
                  {cell === null ? '' : cell.kind === 'character'
                    ? <span className={`dm-character dm-level-${cell.level}`}>{cell.level}</span>
                    : <span className="dm-obstacle-icon" title={obstacleLabels[cell.obstacleType]}>{obstacleIcons[cell.obstacleType]}</span>}
                </button>
              ))}
            </div>
            <div className="dm-board-footer">
              {me.status !== 'active'
                ? 'Твоя партия завершена. Ожидаем остальных игроков.'
                : selectedTool
                  ? `Выбран инструмент: ${toolLabels[selectedTool]}`
                  : 'Выбери свободную клетку для размещения персонажа.'}
            </div>
          </section>

          <aside className="dm-side-panel dm-opponents">
            <h3>ИГРОКИ</h3>
            {match.players.map((player) => (
              <div className="dm-opponent" key={player.userId}>
                <span>{player.displayName}</span>
                <strong>{player.score}</strong>
                <small>ур. {player.maxLevel}</small>
              </div>
            ))}
            <div className="dm-personal-mini">
              <strong>{me.displayName} (ты)</strong>
              <span>{me.score} очков · ур. {me.maxLevel}</span>
            </div>
          </aside>
        </div>
      )}

      {shopOpen && (
        <div className="dm-modal-backdrop" role="presentation" onClick={() => setShopOpen(false)}>
          <section className="dm-shop-modal" role="dialog" aria-modal="true" aria-label="Магазин инструментов" onClick={(event) => event.stopPropagation()}>
            <header><h2>МАГАЗИН</h2><button onClick={() => setShopOpen(false)}>✕</button></header>
            <p>Баланс: 🪙 {me.coins}</p>
            {(['saw', 'storage', 'swap', 'replace'] as ToolType[]).map((tool) => (
              <div className="dm-shop-row" key={tool}>
                <span>{toolIcons[tool]} {toolLabels[tool]}</span>
                <small>{me.inventory[tool]}/3 · 🪙 {toolPrices[tool]}</small>
                <button
                  onClick={() => void buy(tool)}
                  disabled={!canAct || me.inventory[tool] >= 3 || me.coins < toolPrices[tool] || loading}
                >КУПИТЬ</button>
              </div>
            ))}
            <p className="dm-shop-note">Мешок с монетами можно получить только в награду.</p>
          </section>
        </div>
      )}

      {surrenderConfirm && (
        <div className="dm-modal-backdrop">
          <section className="dm-confirm-modal" role="dialog" aria-modal="true">
            <h2>Сдаться?</h2>
            <p>Текущий результат будет сохранён и учтён в общем зачёте. Продолжить партию будет нельзя.</p>
            <div><button onClick={() => setSurrenderConfirm(false)}>ПРОДОЛЖИТЬ</button><button className="dm-danger-button" onClick={() => void surrender()} disabled={loading}>СДАТЬСЯ</button></div>
          </section>
        </div>
      )}

      {leaveConfirm && (
        <div className="dm-modal-backdrop">
          <section className="dm-confirm-modal" role="dialog" aria-modal="true">
            <h2>Выйти из матча?</h2>
            <p>Твой результат не будет учтён. Вернуться в этот матч будет нельзя.</p>
            <div><button onClick={() => setLeaveConfirm(false)}>ОСТАТЬСЯ</button><button className="dm-danger-button" onClick={() => void leaveMatch()} disabled={loading}>ВЫЙТИ</button></div>
          </section>
        </div>
      )}
    </main>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'
import { telegramUser } from '../../services/telegram'
import type { MultiplayerRoom } from '../../multiplayer'
import {
  buyDemocracyMergeTool,
  getDemocracyMergeHistory,
  deleteDemocracyMergeHistoryRecord,
  type DemocracyMergeHistoryResponse,
  getDemocracyMergeMatch,
  leaveDemocracyMergeMatch,
  placeDemocracyMergeCharacter,
  returnDemocracyMergeToRoom,
  startDemocracyMergeMatch,
  surrenderDemocracyMergeMatch,
  executeDemocracyMergeTool,
  type DemocracyMergeActionResponse,
  type DemocracyMergeSnapshot,
} from './api'
import type { ToolType } from './logic/tools'
import { useDemocracyMergeSettings } from './settings'
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
const toolDescriptions: Record<ToolType, string> = {
  saw: 'Удаляет персонажа, заграждение или полицейского бесплатно; камень — за 50 монет.',
  storage: 'Переносит персонажа в хранилище. Инструмент расходуется только при возврате персонажа.',
  swap: 'Меняет местами двух обычных персонажей. Препятствия выбирать нельзя.',
  replace: 'Заменяет текущего персонажа случайным персонажем того же уровня.',
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
function isPlayerDeparture(error: unknown): boolean {
  return /not a current room member|not a room member|не участник комнаты|исключены из матча/i.test(errorMessage(error))
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
  const [now, setNow] = useState(0)
  const [selectedTool, setSelectedTool] = useState<ToolType | null>(null)
  const [swapFirstCell, setSwapFirstCell] = useState<number | null>(null)
  const [shopOpen, setShopOpen] = useState(false)
  const [surrenderConfirm, setSurrenderConfirm] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyData, setHistoryData] = useState<DemocracyMergeHistoryResponse | null>(null)
  const [historyMessage, setHistoryMessage] = useState('')
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<DemocracyMergeHistoryResponse['history'][number] | null>(null)
  const [deleteHistoryId, setDeleteHistoryId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [boardZoom, setBoardZoom] = useState(1)
  const pinchStartDistanceRef = useRef<number | null>(null)
  const pinchStartZoomRef = useRef(1)
  const dragStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
  const dragMovedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const [visualEvents, setVisualEvents] = useState<DemocracyMergeActionResponse['visualEvents']>(null)
  const [rewardToast, setRewardToast] = useState<string[]>([])
  const visualEventTimeoutRef = useRef<number | null>(null)
  const rewardTimeoutRef = useRef<number | null>(null)
  const { settings, updateSettings } = useDemocracyMergeSettings()
  const [oneMinuteNotice, setOneMinuteNotice] = useState(false)
  const startAttemptRef = useRef(false)
  const oneMinuteNoticeRef = useRef<string | null>(null)
  const oneMinuteTimeoutRef = useRef<number | null>(null)
  const telegramId = telegramUser?.id ? String(telegramUser.id) : ''

  const match = snapshot?.match ?? null
  const me = match?.me ?? null

  const refreshMatch = useCallback(async () => {
    try {
      const next = await getDemocracyMergeMatch(initData, room.roomId)
      onRoomUpdate(next.room)
      setSnapshot(next)
      return next
    } catch (error) {
      if (isPlayerDeparture(error)) {
        onLeaveMatch()
      }
      throw error
    }
  }, [initData, room.roomId, onRoomUpdate, onLeaveMatch])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const next = await getDemocracyMergeMatch(initData, room.roomId)
        if (!active) return
        onRoomUpdate(next.room)
        setSnapshot(next)
      } catch (error) {
        if (active && isPlayerDeparture(error)) onLeaveMatch()
        else if (active) setMessage(errorMessage(error))
      }
    }
    void refresh()
    const interval = snapshot?.match?.status === 'completed' || snapshot?.match?.status === 'cancelled'
      ? null
      : window.setInterval(() => { void refresh() }, 1500)
    return () => {
      active = false
      if (interval !== null) window.clearInterval(interval)
    }
  }, [initData, room.roomId, snapshot?.match?.status, onRoomUpdate, onLeaveMatch])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
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
    const deadlineAt = snapshot?.match?.deadlineAt
    const matchId = snapshot?.match?.matchId
    if (!deadlineAt || !matchId) return
    const remaining = Date.parse(deadlineAt) - now
    if (remaining > 0 && remaining <= 60_000 && oneMinuteNoticeRef.current !== matchId) {
      oneMinuteNoticeRef.current = matchId
      setOneMinuteNotice(true)
      oneMinuteTimeoutRef.current = window.setTimeout(() => setOneMinuteNotice(false), 3000)
    }
  }, [snapshot?.match?.deadlineAt, snapshot?.match?.matchId, now])

  useEffect(() => () => {
    if (oneMinuteTimeoutRef.current !== null) window.clearTimeout(oneMinuteTimeoutRef.current)
    if (visualEventTimeoutRef.current !== null) window.clearTimeout(visualEventTimeoutRef.current)
    if (rewardTimeoutRef.current !== null) window.clearTimeout(rewardTimeoutRef.current)
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
    if (settings.animationsEnabled && response.visualEvents) {
      setVisualEvents(response.visualEvents)
      if (visualEventTimeoutRef.current !== null) window.clearTimeout(visualEventTimeoutRef.current)
      const mergeCount = response.visualEvents.merges?.length ?? 0
      const duration = settings.animationSpeed === 'fast' ? 500 : 1000
      visualEventTimeoutRef.current = window.setTimeout(() => setVisualEvents(null), duration + Math.max(0, mergeCount - 1) * (duration / 2))
    } else {
      setVisualEvents(null)
    }
    if (response.rewards?.length) {
      setRewardToast(response.rewards.map((reward) => reward.kind === 'money_bag'
        ? `+ ${reward.coins} монет`
        : `Инструмент: ${toolLabels[reward.tool]}`))
      if (rewardTimeoutRef.current !== null) window.clearTimeout(rewardTimeoutRef.current)
      rewardTimeoutRef.current = window.setTimeout(() => setRewardToast([]), 3000)
    } else if (response.visualEvents?.kind === 'purchase' && response.visualEvents.tool) {
      setRewardToast([`Куплено: ${toolLabels[response.visualEvents.tool]}`])
      if (rewardTimeoutRef.current !== null) window.clearTimeout(rewardTimeoutRef.current)
      rewardTimeoutRef.current = window.setTimeout(() => setRewardToast([]), 3000)
    }
  }, [onRoomUpdate, settings.animationsEnabled, settings.animationSpeed])

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
      const target = me.board[index]
      if (target?.kind === 'obstacle') {
        setMessage(`${obstacleLabels[target.obstacleType]}. ${target.obstacleType === 'rock' ? 'Удаляется пилой за 50 монет.' : 'Удаляется пилой бесплатно.'}`)
        return
      }
      if (target?.kind === 'character') {
        setMessage('Клетка занята. Выберите свободную клетку.')
        return
      }
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
      await submitAction(() => executeDemocracyMergeTool(initData, room.roomId, 'swap', createActionId(), {
        firstCellIndex: swapFirstCell,
        secondCellIndex: index,
      }))
      return
    }
    if (selectedTool === 'storage') {
      await submitAction(() => executeDemocracyMergeTool(initData, room.roomId, 'storage', createActionId(), {
        cellIndex: index,
        storageAction: me.storage ? 'return' : 'store',
      }))
      return
    }
    await submitAction(() => executeDemocracyMergeTool(initData, room.roomId, 'saw', createActionId(), {
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
      void submitAction(() => executeDemocracyMergeTool(initData, room.roomId, 'replace', createActionId()))
      return
    }
    setSelectedTool((previous) => previous === tool ? null : tool)
    setSwapFirstCell(null)
    setMessage(`${toolDescriptions[tool]} ${tool === 'storage' && me.storage
      ? 'Выберите свободную клетку, чтобы вернуть персонажа из хранилища.'
      : tool === 'storage'
        ? 'Выберите персонажа, которого нужно сохранить.'
        : tool === 'swap'
          ? 'Выберите первую клетку, затем вторую.'
          : 'Выберите клетку для удаления.'}`)
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

  async function openHistory() {
    setHistoryOpen(true)
    setHistoryLoading(true)
    setHistoryMessage('')
    try {
      setHistoryData(await getDemocracyMergeHistory(initData))
    } catch (error) {
      setHistoryMessage(errorMessage(error))
    } finally {
      setHistoryLoading(false)
    }
  }

  async function confirmDeleteHistory() {
    if (!deleteHistoryId || !historyData) return
    setHistoryLoading(true)
    setHistoryMessage('')
    try {
      const result = await deleteDemocracyMergeHistoryRecord(initData, deleteHistoryId)
      if (result.deleted) {
        setHistoryData({
          ...historyData,
          history: historyData.history.filter((record) => record.id !== deleteHistoryId),
        })
      }
      if (result.deleted && selectedHistoryRecord?.id === deleteHistoryId) setSelectedHistoryRecord(null)
      setDeleteHistoryId(null)
    } catch (error) {
      setHistoryMessage(errorMessage(error))
    } finally {
      setHistoryLoading(false)
    }
  }

  const animationClasses = `${settings.animationsEnabled ? '': 'dm-animations-off'} ${settings.animationSpeed === 'fast' ? 'dm-animation-fast' : ''}`

  const touchDistance = (touches: ReactTouchEvent<HTMLDivElement>['touches']) => Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  )
  const handleBoardTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      pinchStartDistanceRef.current = touchDistance(event.touches)
      pinchStartZoomRef.current = boardZoom
    }
  }
  const handleBoardTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && pinchStartDistanceRef.current) {
      event.preventDefault()
      const factor = touchDistance(event.touches) / pinchStartDistanceRef.current
      setBoardZoom(Math.min(1.6, Math.max(0.7, pinchStartZoomRef.current * factor)))
    }
  }
  const handleBoardTouchEnd = () => { pinchStartDistanceRef.current = null }
  const handleBoardMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (boardZoom <= 1 || event.button !== 0) return
    dragStartRef.current = {
      x: event.clientX, y: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    }
    dragMovedRef.current = false
    event.currentTarget.style.cursor = 'grabbing'
  }
  const handleBoardMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      dragMovedRef.current = true
      event.preventDefault()
      event.currentTarget.scrollLeft = start.scrollLeft - dx
      event.currentTarget.scrollTop = start.scrollTop - dy
    }
  }
  const handleBoardMouseUp = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (dragMovedRef.current) suppressClickRef.current = true
    dragStartRef.current = null
    event.currentTarget.style.cursor = boardZoom > 1 ? 'grab' : 'auto'
  }
  const handleBoardClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }



  if (!match || !me) {
    return (
      <main className={`app dm-match-shell ${animationClasses}`}>
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
    <main className={`app dm-match-shell ${animationClasses}`}>
      <header className="dm-header">
        <button className="dm-secondary-button" onClick={() => setLeaveConfirm(true)} disabled={!canAct}>ВЫЙТИ ИЗ МАТЧА</button>
        <div><div className="dm-eyebrow">FRIEND BATTLE</div><h1>DEMOCRACY <span>MERGE</span></h1><button className="dm-secondary-button dm-settings-trigger" onClick={() => setSettingsOpen(true)}>НАСТРОЙКИ</button></div>
        <div className={`dm-timer ${remaining <= 300_000 ? 'dm-timer-warning' : ''}`}>
          <small>ОСТАЛОСЬ</small><strong>{timerLabel}</strong>
        </div>
      </header>

      {isCountdown && (
        <div className="dm-countdown"><span>{countdown > 0 ? countdown : 'СТАРТ!'}</span></div>
      )}
      {oneMinuteNotice && <div className="dm-toast">До окончания матча осталась 1 минута</div>}
      {rewardToast.length > 0 && <div className="dm-toast dm-reward-toast">{rewardToast.join(' · ')}</div>}
      {message && <div className="dm-message">{message}</div>}

      {match.status === 'completed' || match.status === 'cancelled' || me.status !== 'active' ? (
        <section className="dm-results">
          <h2>{match.status === 'completed' ? 'МАТЧ ЗАВЕРШЁН' : match.status === 'cancelled' ? 'КОМНАТА ЗАКРЫТА' : 'ТВОЯ ПАРТИЯ ЗАВЕРШЕНА'}</h2>
          {match.finalResults ? (
            <table className="dm-results-table">
              <thead><tr><th>МЕСТО</th><th>ИГРОК</th><th>ОЧКИ</th><th>УРОВЕНЬ</th></tr></thead>
              <tbody>
                {match.finalResults.map((player) => (
                  <tr key={player.userId} className={`${player.userId === telegramId ? 'dm-own-result' : ''} ${player.rank === 1 ? 'dm-rank-gold' : player.rank === 2 ? 'dm-rank-silver' : player.rank === 3 ? 'dm-rank-bronze' : ''}`}>
                    <td>{player.rank ?? '—'}</td>
                    <td>{player.displayName}{player.status === 'left' ? ' · Вышел' : ''}</td>
                    <td>{player.score}</td><td>{player.maxLevel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <section className="dm-live-results">
              <h3>ТЕКУЩИЕ РЕЗУЛЬТАТЫ ИГРОКОВ</h3>
              <table className="dm-results-table">
                <thead><tr><th>ИГРОК</th><th>ОЧКИ</th><th>УРОВЕНЬ</th></tr></thead>
                <tbody>
                  <tr className="dm-own-result"><td>{me.displayName} · Ты</td><td>{me.score}</td><td>{me.maxLevel}</td></tr>
                  {match.players.map((player) => (
                    <tr key={player.userId}><td>{player.displayName}</td><td>{player.score}</td><td>{player.maxLevel}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
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
          {(match.status === 'completed' || match.status === 'cancelled') && (
            <button className="dm-secondary-button" onClick={() => void openHistory()}>ИСТОРИЯ МАТЧЕЙ</button>
          )}
          {room.status === 'cancelled'
            ? <button className="dm-primary-button" onClick={onMainMenu}>В ГЛАВНОЕ МЕНЮ</button>
            : <button className="dm-primary-button" onClick={() => void returnToRoom()} disabled={loading}>ВЫЙТИ В МЕНЮ КОМНАТЫ</button>}
          {match.status === 'playing' && <p className="dm-waiting-note">Твоя партия завершена. Остальные игроки ещё играют. Результат сохранён.</p>}
        </section>
      ) : (
        <div className="dm-layout">
          <aside className="dm-side-panel">
            <div className="dm-current-card">
              <small>ТЕКУЩИЙ ПЕРСОНАЖ · ХОД {me.turnNumber + 1}</small>
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
                  title={toolDescriptions[tool]}
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
            <div className="dm-board-zoom-controls">
              <button onClick={() => setBoardZoom((zoom) => Math.max(0.7, Math.round((zoom - 0.1) * 10) / 10))} aria-label="Уменьшить поле">−</button>
              <span>{Math.round(boardZoom * 100)}%</span>
              <button onClick={() => setBoardZoom((zoom) => Math.min(1.6, Math.round((zoom + 0.1) * 10) / 10))} aria-label="Увеличить поле">+</button>
              <button onClick={() => setBoardZoom(1)}>СБРОС</button>
            </div>
            <div className="dm-board-viewport" style={{ cursor: boardZoom > 1 ? 'grab' : 'auto' }} onTouchStart={handleBoardTouchStart} onTouchMove={handleBoardTouchMove} onTouchEnd={handleBoardTouchEnd} onMouseDown={handleBoardMouseDown} onMouseMove={handleBoardMouseMove} onMouseUp={handleBoardMouseUp} onMouseLeave={handleBoardMouseUp} onClickCapture={handleBoardClickCapture}>
            <div className="dm-board" style={{ transform: `scale(${boardZoom})` }} aria-label="Игровое поле 6 на 6">
              {board.map((cell, index) => {
                const mergeIndex = visualEvents?.kind === 'placement'
                  ? visualEvents.merges?.findIndex((merge) => merge.cells.includes(index)) ?? -1
                  : -1
                const placed = visualEvents?.kind === 'placement' && visualEvents.placementCellIndex === index
                const obstacle = visualEvents?.kind === 'placement' && visualEvents.obstacleCellIndex === index
                return (
                <button
                  key={index}
                  className={`dm-cell ${cell?.kind === 'obstacle' ? 'dm-obstacle' : ''} ${swapFirstCell === index ? 'dm-cell-selected' : ''} ${placed ? 'dm-cell-placed' : ''} ${mergeIndex >= 0 ? 'dm-cell-merge' : ''} ${obstacle ? 'dm-cell-obstacle' : ''}`}
                  style={mergeIndex >= 0 ? { animationDelay: `${mergeIndex * (settings.animationSpeed === 'fast' ? 250 : 500)}ms` } : undefined}
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
                )
              })}
            </div>
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
                {(me.inventory[tool] >= 3 || me.coins < toolPrices[tool]) && (
                  <small className="dm-purchase-reason">{me.inventory[tool] >= 3 ? 'Инвентарь заполнен' : 'Недостаточно монет'}</small>
                )}
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


      {settingsOpen && (
        <div className="dm-modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section className="dm-settings-modal" role="dialog" aria-modal="true" aria-label="Настройки Democracy Merge" onClick={(event) => event.stopPropagation()}>
            <header><h2>НАСТРОЙКИ</h2><button onClick={() => setSettingsOpen(false)}>✕</button></header>
            <label className="dm-settings-toggle">
              <input type="checkbox" checked={settings.animationsEnabled} onChange={(event) => updateSettings({ animationsEnabled: event.target.checked })} />
              <span>Анимации</span>
            </label>
            <label className="dm-settings-field">
              <span>Скорость анимаций</span>
              <select value={settings.animationSpeed} onChange={(event) => updateSettings({ animationSpeed: event.target.value === 'fast' ? 'fast' : 'normal' })} disabled={!settings.animationsEnabled}>
                <option value="normal">Обычная</option>
                <option value="fast">Быстрая</option>
              </select>
            </label>
            <p>Настройки общие для одиночного и многопользовательского режимов.</p>
            <button className="dm-primary-button" onClick={() => setSettingsOpen(false)}>ГОТОВО</button>
          </section>
        </div>
      )}

      {historyOpen && (
        <div className="dm-modal-backdrop" role="presentation" onClick={() => setHistoryOpen(false)}>
          <section className="dm-history-modal" role="dialog" aria-modal="true" aria-label="История матчей" onClick={(event) => event.stopPropagation()}>
            <header><h2>ИСТОРИЯ МАТЧЕЙ</h2><button onClick={() => setHistoryOpen(false)}>✕</button></header>
            {historyLoading && <p>Загружаем историю…</p>}
            {historyMessage && <p className="dm-message" role="alert">{historyMessage}</p>}
            {historyData && (
              <>
                <div className="dm-history-stats">
                  <div><small>МАТЧЕЙ</small><strong>{historyData.stats.totalGames}</strong></div>
                  <div><small>ПОБЕД</small><strong>{historyData.stats.wins}</strong></div>
                  <div><small>ПОРАЖЕНИЙ</small><strong>{historyData.stats.losses}</strong></div>
                  <div><small>НИЧЬИХ</small><strong>{historyData.stats.draws}</strong></div>
                  <div><small>ОЧКОВ ВСЕГО</small><strong>{historyData.stats.totalPoints}</strong></div>
                  <div><small>РЕКОРД</small><strong>{historyData.stats.bestScore}</strong></div>
                  <div><small>МАКС. УРОВЕНЬ</small><strong>{historyData.stats.maxLevel}</strong></div>
                </div>
                {historyData.history.length === 0 ? <p>Завершённых матчей пока нет.</p> : (
                  <div className="dm-history-list">
                    {historyData.history.map((record) => (
                      <article className="dm-history-entry" key={record.id}>
                        <button className="dm-history-entry-main" onClick={() => setSelectedHistoryRecord(record)}>
                          <strong>{new Date(record.completedAt).toLocaleString()}</strong>
                          <small>{record.playerCount} игрока · {record.opponents.map((opponent) => opponent.displayName).join(', ') || 'без соперников'}</small>
                          <small>{record.status === 'surrendered' ? 'Сдача' : 'Завершён'} · место {record.rank} · {record.score} очков · ур. {record.maxLevel}</small>
                        </button>
                        <button className="dm-danger-button" onClick={() => setDeleteHistoryId(record.id)} disabled={historyLoading}>УДАЛИТЬ</button>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {selectedHistoryRecord && (
        <div className="dm-modal-backdrop">
          <section className="dm-confirm-modal" role="dialog" aria-modal="true">
            <h2>РЕЗУЛЬТАТ МАТЧА</h2>
            <p>Дата: {new Date(selectedHistoryRecord.completedAt).toLocaleString()}</p>
            <p>Место: <strong>{selectedHistoryRecord.rank}</strong></p>
            <p>Игроков: {selectedHistoryRecord.playerCount}</p>
            <p>Соперники: {selectedHistoryRecord.opponents.map((opponent) => opponent.displayName).join(', ') || '—'}</p>
            <p>Очки: {selectedHistoryRecord.score}</p>
            <p>Максимальный уровень: {selectedHistoryRecord.maxLevel}</p>
            <p>Объединений: {selectedHistoryRecord.mergeCount}</p>
            <p>Цепных реакций: {selectedHistoryRecord.chainReactions}</p>
            <p>Использовано инструментов: {selectedHistoryRecord.toolsUsed}</p>
            <p>Осталось монет: {selectedHistoryRecord.coins}</p>
            <div><button onClick={() => setSelectedHistoryRecord(null)}>ЗАКРЫТЬ</button></div>
          </section>
        </div>
      )}

      {deleteHistoryId && (
        <div className="dm-modal-backdrop">
          <section className="dm-confirm-modal" role="dialog" aria-modal="true">
            <h2>Удалить запись?</h2>
            <p>Удалится только запись из истории. Общая статистика и результат матча останутся без изменений.</p>
            <div>
              <button onClick={() => setDeleteHistoryId(null)}>ОТМЕНА</button>
              <button className="dm-danger-button" onClick={() => void confirmDeleteHistory()} disabled={historyLoading}>УДАЛИТЬ</button>
            </div>
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

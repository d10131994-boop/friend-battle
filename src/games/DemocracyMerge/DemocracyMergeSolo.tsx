import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'
import { telegramUser } from '../../services/telegram'
import {
  buySoloTool,
  createEmptySoloProfile,
  createSoloGameState,
  currentSoloCharacter,
  deleteSoloHistoryRecord,
  finalizeSoloDeadline,
  placeSoloCharacter,
  recordSoloResult,
  surrenderSoloGame,
  applySoloTool,
  type SoloGameState,
  type SoloHistoryRecord,
  type SoloProfile,
} from './logic/solo'
import type { ToolType } from './logic/tools'
import type { MergeEvent } from './logic/gameEngine'
import { assertBoard } from './logic/gameEngine'
import { TOOL_PRICES } from './logic/events'
import { useDemocracyMergeSettings } from './settings'
import CharacterPortrait from './CharacterPortrait'
import './DemocracyMerge.css'

type StoredSoloData = {
  version: 1
  checkpoint: SoloGameState | null
  profile: SoloProfile
}

type Props = { onBack: () => void }

const toolLabels: Record<ToolType, string> = {
  saw: 'Пила',
  storage: 'Хранилище',
  swap: 'Перестановка',
  replace: 'Замена',
}
const toolDescriptions: Record<ToolType, string> = {
  saw: 'Удаляет персонажа, заграждение или полицейского бесплатно; камень — за 50 монет.',
  storage: 'Переносит персонажа в хранилище. Инструмент расходуется только при возврате персонажа.',
  swap: 'Меняет местами двух обычных персонажей. Препятствия выбирать нельзя.',
  replace: 'Заменяет текущего персонажа случайным персонажем того же уровня.',
}
const obstacleLabels = { barricade: 'Заграждение', police: 'Полицейский', rock: 'Камень' }

function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
function formatDate(value: string): string {
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие.'
}
function validStoredData(value: unknown): value is StoredSoloData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<StoredSoloData>
  if (
    data.version !== 1 || !data.profile || !Array.isArray(data.profile.history) ||
    !Number.isInteger(data.profile.totalGames) || data.profile.totalGames < 0 ||
    !Number.isFinite(data.profile.totalPoints) || data.profile.totalPoints < 0 ||
    !Number.isFinite(data.profile.bestScore) || data.profile.bestScore < 0 ||
    !Number.isInteger(data.profile.maxLevel) || data.profile.maxLevel < 1 || data.profile.maxLevel > 10
  ) return false
  if (data.checkpoint === null) return true
  const state = data.checkpoint
  if (
    !state || state.version !== 1 || !Array.isArray(state.board) || state.board.length !== 36 ||
    !Array.isArray(state.characterSequence) || state.characterSequence.length < 2 ||
    !Array.isArray(state.obstacleSequence) || state.obstacleSequence.length !== state.characterSequence.length ||
    !Number.isInteger(state.turnNumber) || state.turnNumber < 0 ||
    !Number.isFinite(state.score) || state.score < 0 ||
    !Number.isInteger(state.maxLevel) || state.maxLevel < 1 || state.maxLevel > 10 ||
    !Number.isInteger(state.coins) || state.coins < 0 ||
    !['active', 'completed', 'surrendered'].includes(state.status) ||
    !Number.isFinite(Date.parse(state.startedAt)) || !Number.isFinite(Date.parse(state.deadlineAt)) ||
    state.characterSequence.some((level) => !Number.isInteger(level) || level < 1 || level > 6) ||
    state.obstacleSequence.some((event) => event !== null && !['barricade', 'police', 'rock'].includes(event)) ||
    !state.inventory || !['saw', 'storage', 'swap', 'replace'].every((tool) =>
      Number.isInteger(state.inventory[tool as ToolType]) &&
      state.inventory[tool as ToolType] >= 0 && state.inventory[tool as ToolType] <= 3) ||
    (state.storage !== null && (!Number.isInteger(state.storage?.level) ||
      state.storage.level < 1 || state.storage.level > 10))
  ) return false
  try {
    assertBoard(state.board)
  } catch {
    return false
  }
  return true
}

function appendResult(profile: SoloProfile, state: SoloGameState): SoloProfile {
  if (!state.result || profile.history.some((record) => record.completedAt === state.result?.completedAt)) {
    return profile
  }
  return recordSoloResult(profile, state)
}

export default function DemocracyMergeSolo({ onBack }: Props) {
  const userKey = telegramUser?.id ? String(telegramUser.id) : 'guest'
  const storageKey = `friend-battle.democracy-merge.solo.v1:${userKey}`
  const [profile, setProfile] = useState<SoloProfile>(createEmptySoloProfile())
  const [checkpoint, setCheckpoint] = useState<SoloGameState | null>(null)
  const [game, setGame] = useState<SoloGameState | null>(null)
  const [loading, setLoading] = useState(true)
  const [resumePrompt, setResumePrompt] = useState(false)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(0)
  const [selectedTool, setSelectedTool] = useState<ToolType | null>(null)
  const [swapFirstCell, setSwapFirstCell] = useState<number | null>(null)
  const [shopOpen, setShopOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedHistory, setSelectedHistory] = useState<SoloHistoryRecord | null>(null)
  const [surrenderConfirm, setSurrenderConfirm] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [newRecordToast, setNewRecordToast] = useState(false)
  const [recordBroken, setRecordBroken] = useState(false)
  const [rewardToast, setRewardToast] = useState<string[]>([])
  const [deleteHistoryConfirm, setDeleteHistoryConfirm] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [boardZoom, setBoardZoom] = useState(1)
  const pinchStartDistanceRef = useRef<number | null>(null)
  const pinchStartZoomRef = useRef(1)
  const dragStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
  const dragMovedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const { settings, updateSettings } = useDemocracyMergeSettings()
  const notificationTimeoutRef = useRef<number | null>(null)
  const animationTimeoutRef = useRef<number | null>(null)
  const [lastPlacedCell, setLastPlacedCell] = useState<number | null>(null)
  const [mergeEvents, setMergeEvents] = useState<MergeEvent[]>([])
  const [obstacleCell, setObstacleCell] = useState<number | null>(null)

  const persist = useCallback((nextCheckpoint: SoloGameState | null, nextProfile: SoloProfile) => {
    const payload: StoredSoloData = { version: 1, checkpoint: nextCheckpoint, profile: nextProfile }
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload))
    } catch {
      setMessage('Не удалось сохранить игру на устройстве.')
    }
  }, [storageKey])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      let nextProfile = createEmptySoloProfile()
      let nextCheckpoint: SoloGameState | null = null
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const parsed: unknown = JSON.parse(raw)
          if (validStoredData(parsed)) {
            nextProfile = parsed.profile
            nextCheckpoint = parsed.checkpoint
          }
        }
      } catch {
        if (active) setMessage('Сохранение не удалось прочитать. Можно начать новую партию.')
      }
      if (!active) return
      if (nextCheckpoint?.status === 'active' && Date.parse(nextCheckpoint.deadlineAt) <= Date.now()) {
        nextCheckpoint = finalizeSoloDeadline(nextCheckpoint, Date.now())
        const previousBest = nextProfile.bestScore
        nextProfile = appendResult(nextProfile, nextCheckpoint)
        if (nextCheckpoint.result && nextCheckpoint.result.score > previousBest) {
          setRecordBroken(true)
          setNewRecordToast(true)
          window.setTimeout(() => setNewRecordToast(false), 3000)
        }
        setGame(nextCheckpoint)
        setResumePrompt(false)
        persist(nextCheckpoint, nextProfile)
      } else if (nextCheckpoint?.status === 'active') {
        setResumePrompt(true)
      } else if (nextCheckpoint) {
        setGame(nextCheckpoint)
      }
      setCheckpoint(nextCheckpoint)
      setProfile(nextProfile)
      setLoading(false)
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [storageKey, persist])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!game || game.status !== 'active' || !game.deadlineAt || now === 0) return
    if (now < Date.parse(game.deadlineAt)) return
    const timer = window.setTimeout(() => {
      if (game.status !== 'active') return
      const finalized = finalizeSoloDeadline(game, Date.now())
      const nextProfile = appendResult(profile, finalized)
      setGame(finalized)
      setCheckpoint(finalized)
      setProfile(nextProfile)
      persist(finalized, nextProfile)
      if (finalized.result && finalized.result.score > profile.bestScore) {
        setRecordBroken(true)
        setNewRecordToast(true)
        window.setTimeout(() => setNewRecordToast(false), 3000)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [game, now, profile, persist])

  useEffect(() => () => {
    if (notificationTimeoutRef.current !== null) window.clearTimeout(notificationTimeoutRef.current)
    if (animationTimeoutRef.current !== null) window.clearTimeout(animationTimeoutRef.current)
  }, [])

  const startNewGame = useCallback(() => {
    const created = createSoloGameState(Date.now())
    setCheckpoint(created)
    setGame(created)
    setRecordBroken(false)
    setResumePrompt(false)
    setSelectedTool(null)
    setSwapFirstCell(null)
    setMessage('')
    persist(created, profile)
  }, [persist, profile])

  const continueGame = useCallback(() => {
    if (!checkpoint) return
    if (Date.parse(checkpoint.deadlineAt) <= Date.now()) {
      const finalized = finalizeSoloDeadline(checkpoint, Date.now())
      const brokeRecord = Boolean(finalized.result && finalized.result.score > profile.bestScore)
      const nextProfile = appendResult(profile, finalized)
      if (brokeRecord) {
        setRecordBroken(true)
        setNewRecordToast(true)
        window.setTimeout(() => setNewRecordToast(false), 3000)
      }
      setCheckpoint(finalized)
      setGame(finalized)
      setProfile(nextProfile)
      persist(finalized, nextProfile)
    } else {
      setGame(checkpoint)
    }
    setResumePrompt(false)
    setMessage('')
  }, [checkpoint, profile, persist])

  const saveResult = useCallback((next: SoloGameState) => {
    const isNewRecord = Boolean(next.result && next.result.score > profile.bestScore)
    const nextProfile = appendResult(profile, next)
    setRecordBroken(isNewRecord)
    setCheckpoint(next)
    setGame(next)
    setProfile(nextProfile)
    persist(next, nextProfile)
    if (isNewRecord) {
      setNewRecordToast(true)
      window.setTimeout(() => setNewRecordToast(false), 3000)
    }
  }, [profile, persist])

  const saveCheckpoint = useCallback((next: SoloGameState) => {
    setCheckpoint(next)
    setGame(next)
    persist(next, profile)
  }, [persist, profile])

  const handlePlacement = useCallback((cellIndex: number) => {
    if (!game || game.status !== 'active' || loading || now >= Date.parse(game.deadlineAt)) return
    try {
      const placed = placeSoloCharacter(game, cellIndex, Date.now())
      if (settings.animationsEnabled) {
        setLastPlacedCell(placed.placementCellIndex)
        setMergeEvents(placed.merges)
        setObstacleCell(placed.obstacleCellIndex)
        if (animationTimeoutRef.current !== null) window.clearTimeout(animationTimeoutRef.current)
        animationTimeoutRef.current = window.setTimeout(() => {
          setLastPlacedCell(null)
          setMergeEvents([])
          setObstacleCell(null)
        }, settings.animationSpeed === 'fast' ? 500 : 1000)
      } else {
        setLastPlacedCell(null)
        setMergeEvents([])
        setObstacleCell(null)
      }
      if (placed.state.score > profile.bestScore && !recordBroken) {
        setRecordBroken(true)
        setNewRecordToast(true)
        window.setTimeout(() => setNewRecordToast(false), 3000)
      }
      if (placed.state.result) saveResult(placed.state)
      else saveCheckpoint(placed.state)
      const notifications = placed.rewards.map((reward) =>
        reward.kind === 'money_bag' ? `+ ${reward.coins} монет` : `Инструмент: ${toolLabels[reward.tool]}`
      )
      if (notifications.length) {
        setRewardToast(notifications)
        if (notificationTimeoutRef.current !== null) window.clearTimeout(notificationTimeoutRef.current)
        notificationTimeoutRef.current = window.setTimeout(() => setRewardToast([]), 3000)
      }
      setSelectedTool(null)
      setSwapFirstCell(null)
      setMessage('')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }, [game, loading, now, profile.bestScore, recordBroken, saveResult, saveCheckpoint, settings.animationsEnabled, settings.animationSpeed])

  const handleTool = useCallback((tool: ToolType, options: {
    cellIndex?: number
    firstCellIndex?: number
    secondCellIndex?: number
    storageAction?: 'store' | 'return'
  } = {}) => {
    if (!game || game.status !== 'active' || loading || now >= Date.parse(game.deadlineAt)) return
    try {
      const next = applySoloTool(game, tool, options, Date.now())
      if (next.result) saveResult(next)
      else saveCheckpoint(next)
      setSelectedTool(null)
      setSwapFirstCell(null)
      setMessage('')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }, [game, loading, now, saveResult, saveCheckpoint])

  const handleBuy = useCallback((tool: ToolType) => {
    if (!game || game.status !== 'active' || loading || now >= Date.parse(game.deadlineAt)) return
    try {
      saveCheckpoint(buySoloTool(game, tool, Date.now()))
      setMessage('')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }, [game, loading, now, saveCheckpoint])

  function clickCell(index: number) {
    if (!game || game.status !== 'active') return
    if (!selectedTool) {
      const target = game.board[index]
      if (target?.kind === 'obstacle') {
        setMessage(`${obstacleLabels[target.obstacleType]}. ${target.obstacleType === 'rock' ? 'Удаляется пилой за 50 монет.' : 'Удаляется пилой бесплатно.'}`)
        return
      }
      if (target?.kind === 'character') {
        setMessage('Клетка занята. Выберите свободную клетку.')
        return
      }
      handlePlacement(index)
      return
    }
    if (selectedTool === 'saw') {
      handleTool('saw', { cellIndex: index })
    } else if (selectedTool === 'storage') {
      handleTool('storage', { cellIndex: index, storageAction: game.storage ? 'return' : 'store' })
    } else if (selectedTool === 'swap') {
      if (game.board[index]?.kind !== 'character') {
        setMessage('Переставлять можно только двух персонажей. Выберите клетку с персонажем.')
        return
      }
      if (swapFirstCell === null) {
        setSwapFirstCell(index)
        setMessage('Выберите вторую клетку с персонажем для перестановки.')
      } else if (swapFirstCell === index) {
        setSwapFirstCell(null)
        setMessage('Выбор первой клетки отменён. Выберите персонажа заново.')
      } else {
        handleTool('swap', { firstCellIndex: swapFirstCell, secondCellIndex: index })
      }
    }
  }

  function selectTool(tool: ToolType) {
    if (!game || game.status !== 'active') return
    if (game.inventory[tool] < 1) {
      setMessage(`Нет инструмента «${toolLabels[tool]}» в инвентаре.`)
      return
    }
    if (tool === 'replace') {
      handleTool('replace')
      return
    }
    if (selectedTool === tool) {
      setSelectedTool(null)
      setSwapFirstCell(null)
      setMessage('Инструмент отменён. Выберите свободную клетку для размещения персонажа.')
      return
    }
    setSelectedTool(tool)
    setSwapFirstCell(null)
    setMessage(`${toolDescriptions[tool]} ${tool === 'storage' && game.storage
      ? 'Выберите свободную клетку, чтобы вернуть персонажа из хранилища.'
      : tool === 'storage'
        ? 'Выберите персонажа, которого нужно сохранить.'
        : tool === 'swap'
          ? 'Выберите первую клетку, затем вторую.'
          : 'Выберите клетку для удаления.'}`)
  }

  function handleSurrender() {
    if (!game) return
    try {
      const next = surrenderSoloGame(game, Date.now())
      saveResult(next)
      setSurrenderConfirm(false)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  function leaveToMenu() {
    if (checkpoint) persist(checkpoint, profile)
    setGame(checkpoint)
    setLeaveConfirm(false)
    onBack()
  }

  function deleteSelectedHistory() {
    if (!selectedHistory) return
    const nextProfile = deleteSoloHistoryRecord(profile, selectedHistory.id)
    setProfile(nextProfile)
    persist(checkpoint, nextProfile)
    setSelectedHistory(null)
    setDeleteHistoryConfirm(false)
  }

  const current = game ? currentSoloCharacter(game) : null
  const remaining = game ? Date.parse(game.deadlineAt) - now : 0
  const canAct = Boolean(game?.status === 'active' && now < Date.parse(game.deadlineAt) && !loading)
  const isNewRecord = recordBroken
  const animationClasses = `${settings.animationsEnabled ? '' : 'dm-animations-off'} ${settings.animationSpeed === 'fast' ? 'dm-animation-fast' : ''}`

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



  if (loading) {
    return <main className={`app dm-match-shell dm-solo-screen ${animationClasses}`}><div className="dm-waiting">Загружаем одиночную игру…</div></main>
  }

  if (!game && resumePrompt && checkpoint) {
    return (
      <main className="app dm-match-shell dm-solo-screen">
        <section className="dm-confirm-modal">
          <h2>Продолжить партию?</h2>
          <p>У тебя есть незавершённая партия. Таймер продолжает идти, даже когда игра закрыта.</p>
          <div>
            <button onClick={onBack}>ОТМЕНА</button>
            <button onClick={continueGame}>ПРОДОЛЖИТЬ</button>
            <button className="dm-danger-button" onClick={startNewGame}>НОВАЯ ИГРА</button>
          </div>
        </section>
      </main>
    )
  }

  if (!game) {
    return (
      <main className="app dm-match-shell dm-solo-screen">
        <header className="topbar">
          <button className="dm-secondary-button" onClick={onBack}>← НАЗАД</button>
          <div className="logo">DEMOCRACY <span>MERGE</span></div>
        </header>
        <section className="dm-solo-home">
          <h1>ОДИНОЧНАЯ ИГРА</h1>
          <div className="dm-solo-stats">
            <div><small>ВСЕГО ПАРТИЙ</small><strong>{profile.totalGames}</strong></div>
            <div><small>ОЧКИ ВСЕГО</small><strong>{profile.totalPoints}</strong></div>
            <div><small>ЛУЧШИЙ РЕЗУЛЬТАТ</small><strong>{profile.bestScore}</strong></div>
            <div><small>МАКС. УРОВЕНЬ</small><strong>{profile.maxLevel}</strong></div>
          </div>
          <button className="dm-primary-button" onClick={startNewGame}>НОВАЯ ИГРА</button>
          <button className="dm-secondary-button" onClick={() => setHistoryOpen(true)}>ИСТОРИЯ ПАРТИЙ ({profile.history.length})</button>
        </section>
        {historyOpen && (
          <div className="dm-modal-backdrop" onClick={() => setHistoryOpen(false)}>
            <section className="dm-shop-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <header><h2>ИСТОРИЯ ПАРТИЙ</h2><button onClick={() => setHistoryOpen(false)}>✕</button></header>
              {profile.history.length === 0 ? <p>Завершённых партий пока нет.</p> : profile.history.map((record) => (
                <button className="dm-history-row" key={record.id} onClick={() => setSelectedHistory(record)}>
                  <span>{formatDate(record.completedAt)}</span><strong>{record.score} очков</strong><small>ур. {record.maxLevel} · объединений {record.mergeCount}</small>
                </button>
              ))}
            </section>
          </div>
        )}
        {selectedHistory && (
          <div className="dm-modal-backdrop">
            <section className="dm-confirm-modal" role="dialog" aria-modal="true">
              <h2>РЕЗУЛЬТАТ ПАРТИИ</h2>
              <p>Дата: {formatDate(selectedHistory.completedAt)}</p>
              <p>Очки: {selectedHistory.score}</p>
              <p>Максимальный уровень: {selectedHistory.maxLevel}</p>
              <p>Объединений: {selectedHistory.mergeCount}</p>
              <p>Цепных реакций: {selectedHistory.chainReactions}</p>
              <p>Использовано инструментов: {selectedHistory.toolsUsed}</p>
              <p>Осталось монет: {selectedHistory.coins}</p>
              <div><button onClick={() => setSelectedHistory(null)}>ЗАКРЫТЬ</button><button className="dm-danger-button" onClick={() => setDeleteHistoryConfirm(true)}>УДАЛИТЬ</button></div>
            </section>
          </div>
        )}
        {deleteHistoryConfirm && (
          <div className="dm-modal-backdrop">
            <section className="dm-confirm-modal" role="dialog" aria-modal="true">
              <h2>Удалить запись?</h2><p>Будет удалена только запись истории. Рекорд и общая статистика сохранятся.</p>
              <div><button onClick={() => setDeleteHistoryConfirm(false)}>ОТМЕНА</button><button className="dm-danger-button" onClick={deleteSelectedHistory}>УДАЛИТЬ</button></div>
            </section>
          </div>
        )}
      </main>
    )
  }

  const isComplete = game.status !== 'active'

  return (
    <main className={`app dm-match-shell dm-solo-screen ${animationClasses}`}>
      <header className="dm-header">
        <button className="dm-secondary-button" onClick={() => setLeaveConfirm(true)}>В ГЛАВНОЕ МЕНЮ</button>
        <div><div className="dm-eyebrow">ОДИНОЧНАЯ ИГРА</div><h1>DEMOCRACY <span>MERGE</span></h1><button className="dm-secondary-button dm-settings-trigger" onClick={() => setSettingsOpen(true)}>НАСТРОЙКИ</button></div>
        <div className={`dm-timer ${remaining <= 300000 ? 'dm-timer-warning' : ''}`}><small>ОСТАЛОСЬ</small><strong>{formatTime(remaining)}</strong></div>
      </header>

      {message && <div className="dm-message">{message}</div>}
      {newRecordToast && <div className="dm-toast">Новый рекорд!</div>}
      {rewardToast.length > 0 && <div className="dm-toast dm-reward-toast">{rewardToast.join(' · ')}</div>}

      {isComplete ? (
        <section className="dm-results">
          <h2>{game.status === 'surrendered' ? 'ПАРТИЯ ЗАВЕРШЕНА' : game.result?.timedOut ? 'ВРЕМЯ ИСТЕКЛО' : 'ПАРТИЯ ЗАВЕРШЕНА'}</h2>
          <div className={`dm-personal-result ${isNewRecord ? 'dm-record-highlight' : ''}`}>
            <h3>ТВОЙ РЕЗУЛЬТАТ</h3>
            <p>Очки: <strong>{game.result?.score ?? game.score}</strong></p>
            <p>Максимальный уровень: <strong>{game.result?.maxLevel ?? game.maxLevel}</strong></p>
            <p>Объединений: <strong>{game.result?.mergeCount ?? game.mergeCount}</strong></p>
            <p>Цепных реакций: <strong>{game.result?.chainReactions ?? game.chainReactions}</strong></p>
            <p>Использовано инструментов: <strong>{game.result?.toolsUsed ?? game.toolsUsed}</strong></p>
            <p>Осталось монет: <strong>{game.result?.coins ?? game.coins}</strong></p>
          </div>
          <div className="dm-solo-stats">
            <div><small>ВСЕГО ПАРТИЙ</small><strong>{profile.totalGames}</strong></div>
            <div><small>ЛУЧШИЙ РЕЗУЛЬТАТ</small><strong>{profile.bestScore}</strong></div>
            <div><small>МАКС. УРОВЕНЬ</small><strong>{profile.maxLevel}</strong></div>
          </div>
          <button className="dm-secondary-button" onClick={() => setHistoryOpen(true)}>ИСТОРИЯ ПАРТИЙ</button>
          <button className="dm-secondary-button" onClick={leaveToMenu}>В ГЛАВНОЕ МЕНЮ</button>
        </section>
      ) : (
        <div className="dm-layout dm-solo-layout">
          <aside className="dm-side-panel">
            <div className="dm-current-card"><small>ПЕРСОНАЖ · ХОД {game.turnNumber + 1}</small><strong className="dm-v3-next-character-frame">{current !== null ? <CharacterPortrait level={current} /> : '—'}</strong></div>
            <div className="dm-stats">
              <div><small>ОЧКИ</small><strong>{game.score}</strong></div>
              <div><small>МАКС. УРОВЕНЬ</small><strong>{game.maxLevel}</strong></div>
              <div><small>МОНЕТЫ</small><strong>🪙 {game.coins}</strong></div>
              <div className={game.score > profile.bestScore ? 'dm-record-highlight' : ''}><small>РЕКОРД</small><strong>{Math.max(profile.bestScore, game.score)}</strong></div>
            </div>
            <button className="dm-primary-button" onClick={() => setShopOpen(true)} disabled={!canAct}>МАГАЗИН</button>
            <div className="dm-tools">
              <h3>ИНСТРУМЕНТЫ</h3>
              {(['saw', 'storage', 'swap', 'replace'] as ToolType[]).map((tool) => (
                <button key={tool} title={toolDescriptions[tool]} className={`dm-tool-button ${selectedTool === tool ? 'dm-tool-selected' : ''}`}
                  onClick={() => selectTool(tool)} aria-pressed={selectedTool === tool} aria-label={`${toolLabels[tool]}. В инвентаре ${game.inventory[tool]} из 3. Цена покупки ${TOOL_PRICES[tool]} монет. ${toolDescriptions[tool]}`} disabled={!canAct || game.inventory[tool] < 1}>
                  <span className="dm-tool-icon" aria-hidden="true"><img src={`/democracy-merge/v3/tool-${tool}.webp`} alt="" draggable={false} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = `/democracy-merge/tools/${tool}.svg` }} /></span><span className="dm-tool-label">{toolLabels[tool]}</span><strong>{game.inventory[tool]}/3</strong><small className="dm-tool-price">В магазине: 🪙 {TOOL_PRICES[tool]}</small>
                </button>
              ))}
              <p className="dm-storage-note">{game.storage ? `В хранилище: уровень ${game.storage.level}` : 'Хранилище пусто'}</p>
            </div>
            <button className="dm-danger-button" onClick={() => setSurrenderConfirm(true)} disabled={!canAct}>СДАТЬСЯ</button>
            <button className="dm-secondary-button" onClick={() => setHistoryOpen(true)}>ИСТОРИЯ</button>
          </aside>

          <section className="dm-board-section">
            <div className="dm-board-zoom-controls">
              <button onClick={() => setBoardZoom((zoom) => Math.max(0.7, Math.round((zoom - 0.1) * 10) / 10))} aria-label="Уменьшить поле">−</button>
              <span>{Math.round(boardZoom * 100)}%</span>
              <button onClick={() => setBoardZoom((zoom) => Math.min(1.6, Math.round((zoom + 0.1) * 10) / 10))} aria-label="Увеличить поле">+</button>
              <button onClick={() => setBoardZoom(1)} aria-label="Сбросить масштаб поля до 100 процентов">СБРОС</button>
            </div>
            <div className="dm-board-viewport" style={{ cursor: boardZoom > 1 ? 'grab' : 'auto' }} onTouchStart={handleBoardTouchStart} onTouchMove={handleBoardTouchMove} onTouchEnd={handleBoardTouchEnd} onMouseDown={handleBoardMouseDown} onMouseMove={handleBoardMouseMove} onMouseUp={handleBoardMouseUp} onMouseLeave={handleBoardMouseUp} onClickCapture={handleBoardClickCapture}>
            <div className="dm-board" style={{ transform: `scale(${boardZoom})` }} aria-label="Игровое поле 6 на 6">
              {game.board.map((cell, index) => (
                <button key={index} className={`dm-cell ${lastPlacedCell === index ? 'dm-cell-placed' : ''} ${mergeEvents.some((merge) => merge.cells.includes(index)) ? 'dm-cell-merge' : ''} ${obstacleCell === index ? 'dm-cell-obstacle' : ''} ${selectedTool === 'swap' && swapFirstCell === index ? 'dm-cell-selected' : ''}`} style={mergeEvents.findIndex((merge) => merge.cells.includes(index)) >= 0 ? { animationDelay: `${mergeEvents.findIndex((merge) => merge.cells.includes(index)) * (settings.animationSpeed === 'fast' ? 250 : 500)}ms` } : undefined} onClick={() => clickCell(index)} disabled={!canAct}
                  aria-pressed={selectedTool === 'swap' ? swapFirstCell === index : undefined}
                  aria-label={`${selectedTool === 'swap' && swapFirstCell === index ? 'Первая клетка перестановки. ' : ''}Клетка ${index + 1}: ${cell === null ? 'свободна' : cell.kind === 'character'
                    ? `персонаж уровня ${cell.level}` : obstacleLabels[cell.obstacleType]}`}>
                  {cell === null ? '' : cell.kind === 'character'
                    ? <span className={`dm-character dm-level-${cell.level}`}><CharacterPortrait level={cell.level} /></span>
                    : <span className="dm-obstacle-icon" title={obstacleLabels[cell.obstacleType]}><img src={`/democracy-merge/obstacles/${cell.obstacleType}.svg`} alt="" aria-hidden="true" draggable={false} /></span>}
                </button>
              ))}
            </div>
            </div>
            <div className="dm-board-footer" role="status" aria-live="polite">{selectedTool === 'swap' && swapFirstCell !== null ? `Выбрана клетка ${swapFirstCell + 1}. Выберите вторую клетку для перестановки.` : selectedTool ? `Выбран инструмент: ${toolLabels[selectedTool]}` : 'Выбери свободную клетку для размещения персонажа.'}</div>
          </section>
          <aside className="dm-side-panel">
            <h3>СТАТИСТИКА</h3>
            <p>Объединений: <strong>{game.mergeCount}</strong></p>
            <p>Цепных реакций: <strong>{game.chainReactions}</strong></p>
            <p>Использовано инструментов: <strong>{game.toolsUsed}</strong></p>
            <p>Лучший результат: <strong>{profile.bestScore}</strong></p>
          </aside>
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

      {shopOpen && (
        <div className="dm-modal-backdrop" onClick={() => setShopOpen(false)}>
          <section className="dm-shop-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header><h2>МАГАЗИН</h2><button onClick={() => setShopOpen(false)}>✕</button></header>
            <p>Баланс: 🪙 {game.coins}</p>
            {(['saw', 'storage', 'swap', 'replace'] as ToolType[]).map((tool) => (
              <div className="dm-shop-row" key={tool}>
                <span><img className="dm-v3-shop-tool-icon" src={`/democracy-merge/v3/tool-${tool}.webp`} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = `/democracy-merge/tools/${tool}.svg` }} /> {toolLabels[tool]}</span><small>{game.inventory[tool]}/3 · 🪙 {TOOL_PRICES[tool]}</small>
                {(game.inventory[tool] >= 3 || game.coins < TOOL_PRICES[tool]) && <small className="dm-purchase-reason">{game.inventory[tool] >= 3 ? 'Инвентарь заполнен' : 'Недостаточно монет'}</small>}
                <button onClick={() => handleBuy(tool)} disabled={!canAct || game.inventory[tool] >= 3 || game.coins < TOOL_PRICES[tool]}>КУПИТЬ</button>
              </div>
            ))}
            <p className="dm-shop-note">Мешок с монетами можно получить только в награду.</p>
          </section>
        </div>
      )}

      {surrenderConfirm && (
        <div className="dm-modal-backdrop"><section className="dm-confirm-modal" role="dialog" aria-modal="true">
          <h2>Сдаться?</h2><p>Текущий результат будет сохранён. Продолжить партию будет нельзя.</p>
          <div><button onClick={() => setSurrenderConfirm(false)}>ПРОДОЛЖИТЬ</button><button className="dm-danger-button" onClick={handleSurrender}>СДАТЬСЯ</button></div>
        </section></div>
      )}
      {leaveConfirm && (
        <div className="dm-modal-backdrop"><section className="dm-confirm-modal" role="dialog" aria-modal="true">
          <h2>В главное меню?</h2><p>Сохранится последнее полностью завершённое состояние. Таймер продолжит идти.</p>
          <div><button onClick={() => setLeaveConfirm(false)}>ОСТАТЬСЯ</button><button className="dm-danger-button" onClick={leaveToMenu}>ВЫЙТИ</button></div>
        </section></div>
      )}
      {historyOpen && (
        <div className="dm-modal-backdrop" onClick={() => setHistoryOpen(false)}>
          <section className="dm-shop-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header><h2>ИСТОРИЯ ПАРТИЙ</h2><button onClick={() => setHistoryOpen(false)}>✕</button></header>
            {profile.history.length === 0 ? <p>Завершённых партий пока нет.</p> : profile.history.map((record) => (
              <button className="dm-history-row" key={record.id} onClick={() => setSelectedHistory(record)}>
                <span>{formatDate(record.completedAt)}</span><strong>{record.score} очков</strong><small>ур. {record.maxLevel} · объединений {record.mergeCount}</small>
              </button>
            ))}
          </section>
        </div>
      )}
      {selectedHistory && (
        <div className="dm-modal-backdrop"><section className="dm-confirm-modal" role="dialog" aria-modal="true">
          <h2>РЕЗУЛЬТАТ ПАРТИИ</h2><p>Дата: {formatDate(selectedHistory.completedAt)}</p>
          <p>Очки: {selectedHistory.score}</p><p>Максимальный уровень: {selectedHistory.maxLevel}</p>
          <p>Объединений: {selectedHistory.mergeCount}</p><p>Цепных реакций: {selectedHistory.chainReactions}</p>
          <p>Использовано инструментов: {selectedHistory.toolsUsed}</p><p>Осталось монет: {selectedHistory.coins}</p>
          <div><button onClick={() => setSelectedHistory(null)}>ЗАКРЫТЬ</button><button className="dm-danger-button" onClick={() => setDeleteHistoryConfirm(true)}>УДАЛИТЬ</button></div>
        </section></div>
      )}
      {deleteHistoryConfirm && (
        <div className="dm-modal-backdrop"><section className="dm-confirm-modal" role="dialog" aria-modal="true">
          <h2>Удалить запись?</h2><p>Рекорд и общая статистика сохранятся.</p>
          <div><button onClick={() => setDeleteHistoryConfirm(false)}>ОТМЕНА</button><button className="dm-danger-button" onClick={deleteSelectedHistory}>УДАЛИТЬ</button></div>
        </section></div>
      )}
    </main>
  )
}

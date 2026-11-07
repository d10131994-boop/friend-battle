import { useCallback, useEffect, useRef, useState } from 'react'
import { telegramUser } from '../../services/telegram'
import {
  buySoloTool,
  createEmptySoloProfile,
  createSoloGameState,
  currentSoloCharacter,
  deleteSoloHistoryRecord,
  finalizeSoloDeadline,
  nextSoloCharacter,
  placeSoloCharacter,
  recordSoloResult,
  surrenderSoloGame,
  useSoloTool,
  type SoloGameState,
  type SoloHistoryRecord,
  type SoloProfile,
} from './logic/solo'
import type { ToolType } from './logic/tools'
import { TOOL_PRICES } from './logic/events'
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
const toolIcons: Record<ToolType, string> = {
  saw: '🪚',
  storage: '📦',
  swap: '🔀',
  replace: '🔄',
}
const obstacleIcons = { barricade: '🧱', police: '👮', rock: '🪨' }
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
  return data.version === 1 && !!data.profile && Array.isArray(data.profile.history) &&
    typeof data.profile.totalGames === 'number' && typeof data.profile.totalPoints === 'number' &&
    typeof data.profile.bestScore === 'number' && typeof data.profile.maxLevel === 'number' &&
    (data.checkpoint === null || (!!data.checkpoint && data.checkpoint.version === 1 &&
      Array.isArray(data.checkpoint.board) && data.checkpoint.board.length === 36 &&
      Array.isArray(data.checkpoint.characterSequence) && Array.isArray(data.checkpoint.obstacleSequence) &&
      typeof data.checkpoint.deadlineAt === 'string'))
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
  const notificationTimeoutRef = useRef<number | null>(null)
  const telegramId = telegramUser?.id ? String(telegramUser.id) : ''

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
        nextProfile = appendResult(nextProfile, nextCheckpoint)
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
    const timer = window.setInterval(() => setNow(Date.now()), 250)
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
  }, [game?.status, game?.deadlineAt, now, profile, persist])

  useEffect(() => () => {
    if (notificationTimeoutRef.current !== null) window.clearTimeout(notificationTimeoutRef.current)
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
      const nextProfile = appendResult(profile, finalized)
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
  }, [game, loading, now, saveResult, saveCheckpoint])

  const handleTool = useCallback((tool: ToolType, options: {
    cellIndex?: number
    firstCellIndex?: number
    secondCellIndex?: number
    storageAction?: 'store' | 'return'
  } = {}) => {
    if (!game || game.status !== 'active' || loading || now >= Date.parse(game.deadlineAt)) return
    try {
      const next = useSoloTool(game, tool, options, Date.now())
      if (next.result) saveResult(next)
      else setGame(next)
      setSelectedTool(null)
      setSwapFirstCell(null)
      setMessage('')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }, [game, loading, now, saveResult])

  const handleBuy = useCallback((tool: ToolType) => {
    if (!game || game.status !== 'active' || loading || now >= Date.parse(game.deadlineAt)) return
    try {
      setGame(buySoloTool(game, tool, Date.now()))
      setMessage('')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }, [game, loading, now])

  function clickCell(index: number) {
    if (!game || game.status !== 'active') return
    if (!selectedTool) {
      handlePlacement(index)
      return
    }
    if (selectedTool === 'saw') {
      handleTool('saw', { cellIndex: index })
    } else if (selectedTool === 'storage') {
      handleTool('storage', { cellIndex: index, storageAction: game.storage ? 'return' : 'store' })
    } else if (selectedTool === 'swap') {
      if (swapFirstCell === null) {
        setSwapFirstCell(index)
        setMessage('Выберите вторую клетку для перестановки.')
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
    setSelectedTool((previous) => previous === tool ? null : tool)
    setSwapFirstCell(null)
    setMessage(tool === 'storage' && game.storage
      ? 'Выберите свободную клетку, чтобы вернуть персонажа из хранилища.'
      : `Выберите клетку для инструмента «${toolLabels[tool]}».`)
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
  const next = game ? nextSoloCharacter(game) : null
  const remaining = game ? Date.parse(game.deadlineAt) - now : 0
  const canAct = Boolean(game?.status === 'active' && now < Date.parse(game.deadlineAt) && !loading)
  const isNewRecord = recordBroken

  if (loading) {
    return <main className="app dm-match-shell"><div className="dm-waiting">Загружаем одиночную игру…</div></main>
  }

  if (!game && resumePrompt && checkpoint) {
    return (
      <main className="app dm-match-shell">
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
      <main className="app dm-match-shell">
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
    <main className="app dm-match-shell">
      <header className="dm-header">
        <button className="dm-secondary-button" onClick={() => setLeaveConfirm(true)}>В ГЛАВНОЕ МЕНЮ</button>
        <div><div className="dm-eyebrow">ОДИНОЧНАЯ ИГРА</div><h1>DEMOCRACY <span>MERGE</span></h1></div>
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
          <button className="dm-primary-button" onClick={startNewGame}>НОВАЯ ИГРА</button>
          <button className="dm-secondary-button" onClick={() => setHistoryOpen(true)}>ИСТОРИЯ ПАРТИЙ</button>
          <button className="dm-secondary-button" onClick={leaveToMenu}>В ГЛАВНОЕ МЕНЮ</button>
        </section>
      ) : (
        <div className="dm-layout dm-solo-layout">
          <aside className="dm-side-panel">
            <div className="dm-current-card"><small>ТЕКУЩИЙ ПЕРСОНАЖ</small><strong>{current ?? '—'}</strong><span>Следующий: {next ?? '—'}</span></div>
            <div className="dm-stats">
              <div><small>ОЧКИ</small><strong>{game.score}</strong></div>
              <div><small>МАКС. УРОВЕНЬ</small><strong>{game.maxLevel}</strong></div>
              <div><small>МОНЕТЫ</small><strong>🪙 {game.coins}</strong></div>
              <div><small>РЕКОРД</small><strong>{profile.bestScore}</strong></div>
            </div>
            <button className="dm-primary-button" onClick={() => setShopOpen(true)} disabled={!canAct}>МАГАЗИН</button>
            <div className="dm-tools">
              <h3>ИНСТРУМЕНТЫ</h3>
              {(['saw', 'storage', 'swap', 'replace'] as ToolType[]).map((tool) => (
                <button key={tool} className={`dm-tool-button ${selectedTool === tool ? 'dm-tool-selected' : ''}`}
                  onClick={() => selectTool(tool)} disabled={!canAct || game.inventory[tool] < 1}>
                  <span>{toolIcons[tool]} {toolLabels[tool]}</span><strong>{game.inventory[tool]}/3</strong>
                </button>
              ))}
              <p className="dm-storage-note">{game.storage ? `В хранилище: уровень ${game.storage.level}` : 'Хранилище пусто'}</p>
            </div>
            <button className="dm-danger-button" onClick={() => setSurrenderConfirm(true)} disabled={!canAct}>СДАТЬСЯ</button>
            <button className="dm-secondary-button" onClick={() => setHistoryOpen(true)}>ИСТОРИЯ</button>
          </aside>

          <section className="dm-board-section">
            <div className="dm-board" aria-label="Игровое поле 6 на 6">
              {game.board.map((cell, index) => (
                <button key={index} className="dm-cell" onClick={() => clickCell(index)} disabled={!canAct}
                  aria-label={cell === null ? `Свободная клетка ${index + 1}` : cell.kind === 'character'
                    ? `Персонаж уровня ${cell.level}` : obstacleLabels[cell.obstacleType]}>
                  {cell === null ? '' : cell.kind === 'character'
                    ? <span className={`dm-character dm-level-${cell.level}`}>{cell.level}</span>
                    : <span className="dm-obstacle-icon" title={obstacleLabels[cell.obstacleType]}>{obstacleIcons[cell.obstacleType]}</span>}
                </button>
              ))}
            </div>
            <div className="dm-board-footer">{selectedTool ? `Выбран инструмент: ${toolLabels[selectedTool]}` : 'Выбери свободную клетку для размещения персонажа.'}</div>
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

      {shopOpen && (
        <div className="dm-modal-backdrop" onClick={() => setShopOpen(false)}>
          <section className="dm-shop-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header><h2>МАГАЗИН</h2><button onClick={() => setShopOpen(false)}>✕</button></header>
            <p>Баланс: 🪙 {game.coins}</p>
            {(['saw', 'storage', 'swap', 'replace'] as ToolType[]).map((tool) => (
              <div className="dm-shop-row" key={tool}>
                <span>{toolIcons[tool]} {toolLabels[tool]}</span><small>{game.inventory[tool]}/3 · 🪙 {TOOL_PRICES[tool]}</small>
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

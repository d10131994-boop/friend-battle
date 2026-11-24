import CharacterPortrait from './CharacterPortrait'
import type { Board, MergeEvent } from './logic/gameEngine'
import type { ToolType, ToolInventory } from './logic/tools'
import { TOOL_PRICES } from './logic/events'
const toolLabels: Record<ToolType, string> = {
  saw: 'Пила',
  storage: 'Хранилище',
  swap: 'Перестановка',
  replace: 'Замена',
}
const toolDescriptions: Record<ToolType, string> = {
  saw: 'Удаляет персонажа бесплатно; камень — за 50 монет.',
  storage: 'Переносит персонажа в хранилище. Инструмент расходуется только при возврате персонажа.',
  swap: 'Меняет местами двух обычных персонажей. Препятствия выбирать нельзя.',
  replace: 'Заменяет текущего персонажа случайным персонажем того же уровня.',
}
const GRASS_VARIANTS = [1, 4, 2, 6, 3, 5, 3, 1, 5, 2, 6, 4, 6, 3, 4, 1, 5, 2, 2, 5, 1, 4, 3, 6, 4, 2, 6, 5, 1, 3, 5, 6, 3, 2, 4, 1] as const

const obstacleLabels = { barricade: 'Колючий куст', police: 'Старая бабка', rock: 'Камень' }


export function LevelGuide({onClose}: {onClose: () => void}) { return (
        <div className="dm-modal-backdrop">
          <section className="dm-level-guide" role="dialog" aria-modal="true" aria-labelledby="dm-level-guide-title">
            <h2 id="dm-level-guide-title">УРОВНИ ПЕРСОНАЖЕЙ</h2>
            <p>Соединяй три или больше одинаковых персонажей, чтобы получить следующий уровень.</p>
            <ol className="dm-level-guide-list">
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <li key={level}>
                  <span className="dm-level-guide-art"><CharacterPortrait level={level} /></span>
                  <strong>Уровень {level}</strong>
                  {level < 6 && level !== 3 && <span className="dm-level-guide-arrow" aria-hidden="true">→</span>}
                </li>
              ))}
            </ol>
            <button type="button" className="dm-level-guide-close" onClick={onClose}>ЗАКРЫТЬ</button>
          </section>
        </div>

) }
type Props = { state: {board: Board; score: number; coins: number; turnNumber: number; inventory: ToolInventory}; current: number | null; remaining: number; timerLabel: string; record: number; recordLabel: string; selectedTool: ToolType | null; swapFirstCell: number | null; lastPlacedCell: number | null; obstacleCell: number | null; mergeEvents: MergeEvent[]; animationDelay: number; canAct: boolean; onHome: () => void; onShop: () => void; selectTool: (tool: ToolType) => void; clickCell: (index: number) => void }
export function GameLayout({state,current,remaining,timerLabel,record,recordLabel,selectedTool,swapFirstCell,lastPlacedCell,obstacleCell,mergeEvents,animationDelay,canAct,onHome,onShop,selectTool,clickCell}: Props) { return (
        <div className="dm-layout dm-solo-layout">
          <aside className="dm-side-panel">
            <div className="dm-current-card"><div className="dm-next-character"><strong className="dm-v3-next-character-frame">{current !== null ? <CharacterPortrait level={current} /> : '—'}</strong><div className={`dm-timer ${remaining <= 300000 ? 'dm-timer-warning' : ''}`}><small>ОСТАЛОСЬ</small><strong>{timerLabel}</strong></div></div><small>ПЕРСОНАЖ · ХОД {state.turnNumber + 1}</small></div>
            <div className="dm-stats">
              <div><small>ОЧКИ</small><strong>{state.score}</strong></div>
              <div><small>МОНЕТЫ</small><strong>🪙 {state.coins}</strong></div>
              <div className={state.score > record ? 'dm-record-highlight' : ''}><small>{recordLabel}</small><strong>{record}</strong></div>
            </div>
            <div className="dm-tools">
              <button className="dm-home-icon-button" type="button" onClick={() => onHome()} aria-label="В главное меню" title="В главное меню"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 11.5 12 3l10 8.5h-2.5V22h-6v-7h-3v7h-6V11.5H2Z" fill="currentColor" /></svg></button>
              {(['saw', 'storage', 'swap', 'replace'] as ToolType[]).map((tool) => (
                <button key={tool} title={toolDescriptions[tool]} className={`dm-tool-button ${selectedTool === tool ? 'dm-tool-selected' : ''}`}
                  onClick={() => selectTool(tool)} aria-pressed={selectedTool === tool} aria-label={`${toolLabels[tool]}. В инвентаре ${state.inventory[tool]} из 3. Цена покупки ${TOOL_PRICES[tool]} монет. ${toolDescriptions[tool]}`} disabled={!canAct || state.inventory[tool] < 1}>
                  <span className="dm-tool-icon" aria-hidden="true"><img src={`/democracy-merge/picture/v3/tool-${tool}.webp`} alt="" draggable={false} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = `/democracy-merge/tools/${tool}.svg` }} /></span>
                  <span className="dm-tool-count" aria-hidden="true">{state.inventory[tool]}</span>
                </button>
              ))}
              <button className="dm-shop-icon-button" type="button" onClick={() => onShop()} disabled={!canAct} aria-label="Открыть магазин" title="Магазин"><img src="/democracy-merge/picture/v3/icon-gift-celebration.webp" alt="" draggable={false} /></button>
            </div>
          </aside>

          <section className="dm-board-section">
            <div className="dm-board-viewport">
            <div className="dm-board" aria-label="Игровое поле 6 на 6">
              {state.board.map((cell, index) => (
                <button key={index} className={`dm-cell dm-grass-${GRASS_VARIANTS[index]} ${lastPlacedCell === index ? 'dm-cell-placed' : ''} ${mergeEvents.some((merge) => merge.cells.includes(index)) ? 'dm-cell-merge' : ''} ${obstacleCell === index ? 'dm-cell-obstacle' : ''} ${selectedTool === 'swap' && swapFirstCell === index ? 'dm-cell-selected' : ''}`} style={mergeEvents.findIndex((merge) => merge.cells.includes(index)) >= 0 ? { animationDelay: `${mergeEvents.findIndex((merge) => merge.cells.includes(index)) * animationDelay}ms` } : undefined} onClick={() => clickCell(index)} disabled={!canAct}
                  aria-pressed={selectedTool === 'swap' ? swapFirstCell === index : undefined}
                  aria-label={`${selectedTool === 'swap' && swapFirstCell === index ? 'Первая клетка перестановки. ' : ''}Клетка ${index + 1}: ${cell === null ? 'свободна' : cell.kind === 'character'
                    ? `персонаж уровня ${cell.level}` : obstacleLabels[cell.obstacleType]}`}>
                  {cell === null ? '' : cell.kind === 'character'
                    ? <span className={`dm-character dm-level-${cell.level}`}><CharacterPortrait level={cell.level} /></span>
                    : <span className="dm-obstacle-icon" title={obstacleLabels[cell.obstacleType]}><img src={`/democracy-merge/obstacles/${cell.obstacleType}.png`} alt="" aria-hidden="true" draggable={false} /></span>}
                </button>
              ))}
            </div>
            </div>
          </section>

        </div>
) }

import {
  assertBoard,
  cloneBoard,
  countFreeCells,
  type Board,
  type CharacterLevel,
} from './gameEngine.ts'

export type ToolType = 'saw' | 'storage' | 'swap' | 'replace'
export type ToolInventory = Record<ToolType, number>
export type StoredCharacter = { level: CharacterLevel } | null

export const TOOL_CAPACITY = 3
export const ROCK_REMOVAL_COST = 50

export function emptyToolInventory(): ToolInventory {
  return { saw: 0, storage: 0, swap: 0, replace: 0 }
}

export function addTool(inventory: ToolInventory, tool: ToolType): ToolInventory {
  const count = inventory[tool]
  if (!Number.isInteger(count) || count < 0 || count > TOOL_CAPACITY) {
    throw new RangeError('Tool inventory count is invalid.')
  }
  if (count >= TOOL_CAPACITY) return { ...inventory }
  return { ...inventory, [tool]: count + 1 }
}

function requireTool(inventory: ToolInventory, tool: ToolType): void {
  const count = inventory[tool]
  if (!Number.isInteger(count) || count < 1 || count > TOOL_CAPACITY) {
    throw new Error(`No ${tool} tool is available.`)
  }
}

function validIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < 36
}

export function applySaw(
  source: Board,
  index: number,
  inventory: ToolInventory,
  coins: number,
): { board: Board; inventory: ToolInventory; coins: number } {
  assertBoard(source)
  requireTool(inventory, 'saw')
  if (!validIndex(index) || source[index] === null) throw new Error('Select an occupied cell.')
  const target = source[index]!
  const cost = target.kind === 'obstacle' && target.obstacleType === 'rock' ? ROCK_REMOVAL_COST : 0
  if (!Number.isInteger(coins) || coins < cost) throw new Error('Not enough coins to remove this rock.')
  const board = cloneBoard(source)
  board[index] = null
  return {
    board,
    inventory: { ...inventory, saw: inventory.saw - 1 },
    coins: coins - cost,
  }
}

export function storeCharacter(
  source: Board,
  index: number,
  storage: StoredCharacter,
  inventory: ToolInventory,
): { board: Board; storage: StoredCharacter; inventory: ToolInventory } {
  assertBoard(source)
  requireTool(inventory, 'storage')
  if (storage !== null) throw new Error('Storage is already occupied.')
  if (!validIndex(index) || source[index]?.kind !== 'character') {
    throw new Error('Only a character can be placed into storage.')
  }
  const board = cloneBoard(source)
  const stored = board[index]
  if (stored?.kind !== 'character') throw new Error('Selected cell is not a character.')
  board[index] = null
  return { board, storage: { level: stored.level }, inventory: { ...inventory } }
}

export function returnStoredCharacter(
  source: Board,
  index: number,
  storage: StoredCharacter,
  inventory: ToolInventory,
): { board: Board; storage: StoredCharacter; inventory: ToolInventory } {
  assertBoard(source)
  requireTool(inventory, 'storage')
  if (storage === null) throw new Error('Storage is empty.')
  if (!validIndex(index) || source[index] !== null) throw new Error('Select an empty cell.')
  const board = cloneBoard(source)
  board[index] = { kind: 'character', level: storage.level }
  return {
    board,
    storage: null,
    inventory: { ...inventory, storage: inventory.storage - 1 },
  }
}

export function swapCharacters(
  source: Board,
  firstIndex: number,
  secondIndex: number,
  inventory: ToolInventory,
): { board: Board; inventory: ToolInventory } {
  assertBoard(source)
  requireTool(inventory, 'swap')
  if (!validIndex(firstIndex) || !validIndex(secondIndex) || firstIndex === secondIndex) {
    throw new Error('Choose two different cells.')
  }
  if (source[firstIndex]?.kind !== 'character' || source[secondIndex]?.kind !== 'character') {
    throw new Error('Swap can target only two normal characters.')
  }
  const board = cloneBoard(source)
  const first = board[firstIndex]!
  board[firstIndex] = board[secondIndex]
  board[secondIndex] = first
  return { board, inventory: { ...inventory, swap: inventory.swap - 1 } }
}

export function replaceCurrentCharacter(
  currentLevel: CharacterLevel,
  inventory: ToolInventory,
): { level: CharacterLevel; inventory: ToolInventory } {
  requireTool(inventory, 'replace')
  if (!Number.isInteger(currentLevel) || currentLevel < 1 || currentLevel > 6) {
    throw new RangeError('Current character level must be between 1 and 6.')
  }
  // V1 uses one placeholder character identity per level. The server still
  // consumes the tool; the shared sequence itself is never advanced.
  return {
    level: currentLevel,
    inventory: { ...inventory, replace: inventory.replace - 1 },
  }
}

export function canFreeCellWithTools(
  board: Board,
  inventory: ToolInventory,
  storage: StoredCharacter,
  coins: number,
): boolean {
  assertBoard(board)
  if (countFreeCells(board) > 0) return true
  if (inventory.saw > 0 && board.some((cell) => {
    if (cell === null) return false
    if (cell.kind === 'character') return true
    return cell.obstacleType !== 'rock' || coins >= ROCK_REMOVAL_COST
  })) return true
  return inventory.storage > 0 && storage === null &&
    board.some((cell) => cell?.kind === 'character')
}

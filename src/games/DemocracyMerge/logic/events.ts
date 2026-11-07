import { assertBoard, cloneBoard, type Board, type ObstacleType } from './gameEngine.ts'
import { addTool, TOOL_CAPACITY, type ToolInventory, type ToolType } from './tools.ts'

export const TOOL_PRICES: Record<ToolType, number> = {
  saw: 45,
  storage: 60,
  swap: 55,
  replace: 75,
}

export type MergeReward =
  | { kind: 'money_bag'; coins: number }
  | { kind: 'tool'; tool: ToolType }

function randomUnit(random: () => number): number {
  const value = random()
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Random source must return a number in [0, 1).')
  }
  return value
}

export function buyTool(
  inventory: ToolInventory,
  tool: ToolType,
  coins: number,
): { inventory: ToolInventory; coins: number } {
  const count = inventory[tool]
  if (!Number.isInteger(count) || count < 0 || count > TOOL_CAPACITY) {
    throw new RangeError('Tool inventory count is invalid.')
  }
  if (count >= TOOL_CAPACITY) throw new Error('Tool inventory is full.')
  const price = TOOL_PRICES[tool]
  if (!Number.isInteger(coins) || coins < price) throw new Error('Not enough coins.')
  return { inventory: addTool(inventory, tool), coins: coins - price }
}

export function rollMergeRewards(
  mergeCount: number,
  random: () => number = Math.random,
): MergeReward[] {
  if (!Number.isInteger(mergeCount) || mergeCount < 0 || mergeCount > 1000) {
    throw new RangeError('Merge count must be an integer between 0 and 1000.')
  }
  const rewards: MergeReward[] = []
  const tools: ToolType[] = ['saw', 'storage', 'swap', 'replace']
  for (let merge = 0; merge < mergeCount; merge++) {
    if (randomUnit(random) < 0.05) {
      rewards.push({ kind: 'money_bag', coins: 10 + Math.floor(randomUnit(random) * 41) })
    }
    if (randomUnit(random) < 0.05) {
      rewards.push({ kind: 'tool', tool: tools[Math.floor(randomUnit(random) * tools.length)] })
    }
  }
  return rewards
}

export function rollObstacleEvent(random: () => number = Math.random): ObstacleType | null {
  if (randomUnit(random) >= 0.05) return null
  const types: ObstacleType[] = ['barricade', 'police', 'rock']
  return types[Math.floor(randomUnit(random) * types.length)]
}

export function generateObstacleSequence(
  turnCount: number,
  random: () => number = Math.random,
): (ObstacleType | null)[] {
  if (!Number.isInteger(turnCount) || turnCount < 0 || turnCount > 10000) {
    throw new RangeError('Turn count must be an integer between 0 and 10000.')
  }
  return Array.from({ length: turnCount }, () => rollObstacleEvent(random))
}

/** Event type is shared by the match; its free-cell location is player-specific. */
export function placeObstacleAtRandomFreeCell(
  source: Board,
  obstacleType: ObstacleType,
  random: () => number = Math.random,
): { board: Board; cellIndex: number | null } {
  assertBoard(source)
  const free = source.flatMap((cell, index) => cell === null ? [index] : [])
  if (!free.length) return { board: cloneBoard(source), cellIndex: null }
  const selected = free[Math.floor(randomUnit(random) * free.length)]
  const board = cloneBoard(source)
  board[selected] = { kind: 'obstacle', obstacleType }
  return { board, cellIndex: selected }
}

export function applyToolReward(
  inventory: ToolInventory,
  tool: ToolType,
): { inventory: ToolInventory; awarded: boolean } {
  if (inventory[tool] >= TOOL_CAPACITY) return { inventory: { ...inventory }, awarded: false }
  return { inventory: addTool(inventory, tool), awarded: true }
}

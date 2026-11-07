import {
  applyToolReward,
  buyTool,
  generateObstacleSequence,
  placeObstacleAtRandomFreeCell,
  rollMergeRewards,
} from '../../../src/games/DemocracyMerge/logic/events.ts'
import { createEmptyBoard } from '../../../src/games/DemocracyMerge/logic/gameEngine.ts'
import { emptyToolInventory } from '../../../src/games/DemocracyMerge/logic/tools.ts'

Deno.test('shop prices and inventory limits are enforced', () => {
  const bought = buyTool(emptyToolInventory(), 'saw', 200)
  if (bought.coins !== 155 || bought.inventory.saw !== 1) {
    throw new Error('Buying a saw must cost 45 coins.')
  }
  let blocked = false
  try { buyTool({ ...bought.inventory, saw: 3 }, 'saw', 200) } catch { blocked = true }
  if (!blocked) throw new Error('The shop must reject purchases at the inventory cap.')
})

Deno.test('each merge rolls bag and tool rewards independently', () => {
  const values = [0.01, 0.5, 0.01, 0.75, 0.9, 0.9]
  let index = 0
  const rewards = rollMergeRewards(2, () => values[index++])
  if (rewards.length !== 3 ||
      rewards[0].kind !== 'money_bag' || rewards[0].coins !== 31 ||
      rewards[1].kind !== 'tool' || rewards[1].tool !== 'replace' ||
      rewards[2].kind !== 'money_bag' || rewards[2].coins !== 46) {
    throw new Error('Merge reward checks must be independent for each merge.')
  }
})

Deno.test('obstacle event is low-frequency and uses equal type slots', () => {
  const noEvent = generateObstacleSequence(1, () => 0.5)
  if (noEvent[0] !== null) throw new Error('A roll above 5% must not produce an obstacle.')
  const sequence = generateObstacleSequence(3, (() => {
    const values = [0, 0, 0.01, 0.34, 0.01, 0.67]
    let index = 0
    return () => values[index++]
  })())
  if (sequence[0] !== 'barricade' || sequence[1] !== 'police' || sequence[2] !== 'rock') {
    throw new Error('Obstacle type slots must be equally distributed.')
  }
})

Deno.test('obstacle location is chosen from free cells and is player-specific', () => {
  const board = createEmptyBoard()
  board[0] = { kind: 'character', level: 1 }
  const result = placeObstacleAtRandomFreeCell(board, 'police', () => 0)
  if (result.cellIndex !== 1 || result.board[1]?.kind !== 'obstacle') {
    throw new Error('Obstacle should be placed in the selected free cell.')
  }
  const full = createEmptyBoard()
  full.fill({ kind: 'obstacle', obstacleType: 'rock' })
  const skipped = placeObstacleAtRandomFreeCell(full, 'barricade', () => 0)
  if (skipped.cellIndex !== null || skipped.board.some((cell) => cell?.kind !== 'obstacle')) {
    throw new Error('An obstacle event must be skipped when no free cell exists.')
  }
})

Deno.test('tool reward is silently skipped at capacity', () => {
  const inventory = { ...emptyToolInventory(), swap: 3 }
  const result = applyToolReward(inventory, 'swap')
  if (result.awarded || result.inventory.swap !== 3) {
    throw new Error('A full inventory must skip the reward without compensation.')
  }
})

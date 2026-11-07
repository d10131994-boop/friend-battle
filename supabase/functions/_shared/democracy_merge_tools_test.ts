import {
  addTool,
  canFreeCellWithTools,
  emptyToolInventory,
  returnStoredCharacter,
  storeCharacter,
  swapCharacters,
  useSaw,
} from '../../../src/games/DemocracyMerge/logic/tools.ts'
import { createEmptyBoard } from '../../../src/games/DemocracyMerge/logic/gameEngine.ts'

Deno.test('saw removes a normal cell for free and consumes one saw', () => {
  const board = createEmptyBoard()
  board[0] = { kind: 'character', level: 2 }
  const result = useSaw(board, 0, { ...emptyToolInventory(), saw: 1 }, 0)
  if (result.board[0] !== null || result.inventory.saw !== 0 || result.coins !== 0) {
    throw new Error('Saw must remove the character without coins and be consumed.')
  }
})

Deno.test('saw removes a rock for 50 coins', () => {
  const board = createEmptyBoard()
  board[0] = { kind: 'obstacle', obstacleType: 'rock' }
  const result = useSaw(board, 0, { ...emptyToolInventory(), saw: 1 }, 70)
  if (result.board[0] !== null || result.coins !== 20 || result.inventory.saw !== 0) {
    throw new Error('Rock removal must charge 50 coins and consume the saw.')
  }
})

Deno.test('storage is consumed only when the stored character is returned', () => {
  const board = createEmptyBoard()
  board[0] = { kind: 'character', level: 4 }
  const inventory = { ...emptyToolInventory(), storage: 1 }
  const stored = storeCharacter(board, 0, null, inventory)
  if (stored.board[0] !== null || stored.storage?.level !== 4 || stored.inventory.storage !== 1) {
    throw new Error('Storing must free the cell without consuming storage.')
  }
  const returned = returnStoredCharacter(stored.board, 5, stored.storage, stored.inventory)
  if (returned.board[5]?.kind !== 'character' || returned.board[5].level !== 4 ||
      returned.storage !== null || returned.inventory.storage !== 0) {
    throw new Error('Returning must restore the character and consume storage.')
  }
})

Deno.test('swap exchanges only normal characters and consumes one tool', () => {
  const board = createEmptyBoard()
  board[0] = { kind: 'character', level: 1 }
  board[1] = { kind: 'character', level: 5 }
  const result = swapCharacters(board, 0, 1, { ...emptyToolInventory(), swap: 1 })
  if (result.board[0]?.kind !== 'character' || result.board[0].level !== 5 ||
      result.board[1]?.kind !== 'character' || result.board[1].level !== 1 ||
      result.inventory.swap !== 0) {
    throw new Error('Swap must exchange the two characters and consume one tool.')
  }
})

Deno.test('tool rewards respect the inventory cap and board escape checks', () => {
  const board = createEmptyBoard()
  board.fill({ kind: 'obstacle', obstacleType: 'barricade' })
  const capped = { ...emptyToolInventory(), saw: 3 }
  if (addTool(capped, 'saw').saw !== 3) throw new Error('Tool inventory must be capped at three.')
  if (!canFreeCellWithTools(board, capped, null, 0)) throw new Error('Saw can free a barricade cell.')
  if (canFreeCellWithTools(board, emptyToolInventory(), null, 0)) {
    throw new Error('A full board with no freeing tool must be terminal.')
  }
})

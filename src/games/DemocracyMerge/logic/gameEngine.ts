export const BOARD_SIZE = 6
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE

export type CharacterLevel = 1 | 2 | 3 | 4 | 5 | 6
export type ObstacleType = 'barricade' | 'police' | 'rock'

export type CharacterCell = { kind: 'character'; level: CharacterLevel }
export type ObstacleCell = { kind: 'obstacle'; obstacleType: ObstacleType }
export type BoardCell = CharacterCell | ObstacleCell | null
export type Board = BoardCell[]

export type MergeEvent = {
  fromLevel: CharacterLevel
  toLevel: CharacterLevel
  cells: number[]
  points: number
}

export type PlacementResult = {
  board: Board
  merges: MergeEvent[]
  scoreDelta: number
  level6MergeCount: number
}

const LEVEL_WEIGHTS = [50, 25, 12, 7, 4, 2] as const
const MERGE_POINTS: Record<CharacterLevel, number> = {
  1: 0,
  2: 10,
  3: 30,
  4: 90,
  5: 270,
  6: 810,
}

function assertRandom(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Random source must return a number in [0, 1).')
  }
  return value
}

function isCharacter(cell: BoardCell): cell is CharacterCell {
  return cell?.kind === 'character'
}

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_CELLS }, () => null)
}

export function cloneBoard(board: Board): Board {
  assertBoard(board)
  return board.map((cell) => cell === null ? null : { ...cell })
}

export function assertBoard(board: Board): void {
  if (!Array.isArray(board) || board.length !== BOARD_CELLS) {
    throw new RangeError(`A Democracy Merge board must contain exactly ${BOARD_CELLS} cells.`)
  }
  for (const cell of board) {
    if (cell === null) continue
    if (typeof cell !== 'object') throw new TypeError('Board contains an invalid cell.')
    if (cell.kind === 'character' && Number.isInteger(cell.level) && cell.level >= 1 && cell.level <= 6) continue
    if (cell.kind === 'obstacle' && ['barricade', 'police', 'rock'].includes(cell.obstacleType)) continue
    throw new TypeError('Board contains an invalid cell.')
  }
}

export function generateCharacterLevel(random: () => number = Math.random): CharacterLevel {
  let roll = assertRandom(random()) * 100
  for (let index = 0; index < LEVEL_WEIGHTS.length; index++) {
    roll -= LEVEL_WEIGHTS[index]
    if (roll < 0) return (index + 1) as CharacterLevel
  }
  return 6
}

export function generateCharacterSequence(
  count: number,
  random: () => number = Math.random,
): CharacterLevel[] {
  if (!Number.isInteger(count) || count < 0 || count > 10000) {
    throw new RangeError('Sequence length must be an integer between 0 and 10000.')
  }
  return Array.from({ length: count }, () => generateCharacterLevel(random))
}

export function orthogonalNeighbors(index: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS) {
    throw new RangeError('Cell index is outside the board.')
  }
  const row = Math.floor(index / BOARD_SIZE)
  const column = index % BOARD_SIZE
  const neighbors: number[] = []
  if (row > 0) neighbors.push(index - BOARD_SIZE)
  if (column < BOARD_SIZE - 1) neighbors.push(index + 1)
  if (row < BOARD_SIZE - 1) neighbors.push(index + BOARD_SIZE)
  if (column > 0) neighbors.push(index - 1)
  return neighbors
}

export function connectedCharacterGroup(board: Board, startIndex: number): number[] {
  assertBoard(board)
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= BOARD_CELLS) {
    throw new RangeError('Cell index is outside the board.')
  }
  const start = board[startIndex]
  if (!isCharacter(start)) return []
  const visited = new Set<number>([startIndex])
  const pending = [startIndex]
  while (pending.length) {
    const current = pending.pop()!
    for (const neighbor of orthogonalNeighbors(current)) {
      const cell = board[neighbor]
      if (!visited.has(neighbor) && isCharacter(cell) && cell.level === start.level) {
        visited.add(neighbor)
        pending.push(neighbor)
      }
    }
  }
  return [...visited].sort((a, b) => a - b)
}

export function placeCharacter(
  source: Board,
  index: number,
  level: CharacterLevel,
  previousLevel6MergeCount = 0,
): PlacementResult {
  assertBoard(source)
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS) {
    throw new RangeError('Cell index is outside the board.')
  }
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new RangeError('Character level must be between 1 and 6.')
  }
  if (!Number.isInteger(previousLevel6MergeCount) || previousLevel6MergeCount < 0) {
    throw new RangeError('Level 6 merge count cannot be negative.')
  }
  if (source[index] !== null) throw new Error('The selected cell is occupied.')

  const board = cloneBoard(source)
  board[index] = { kind: 'character', level }
  const merges: MergeEvent[] = []
  let currentLevel = level
  let level6MergeCount = previousLevel6MergeCount

  while (true) {
    const group = connectedCharacterGroup(board, index)
    if (group.length < 3) break

    const nextLevel = currentLevel === 6 ? 6 : (currentLevel + 1) as CharacterLevel
    let points = MERGE_POINTS[nextLevel]
    if (currentLevel === 6) {
      level6MergeCount += 1
      if (level6MergeCount > 1) points = 2430
    }

    for (const cellIndex of group) {
      if (cellIndex !== index) board[cellIndex] = null
    }
    board[index] = { kind: 'character', level: nextLevel }
    merges.push({
      fromLevel: currentLevel,
      toLevel: nextLevel,
      cells: group,
      points,
    })
    currentLevel = nextLevel
  }

  return {
    board,
    merges,
    scoreDelta: merges.reduce((sum, merge) => sum + merge.points, 0),
    level6MergeCount,
  }
}

export function isBoardFull(board: Board): boolean {
  assertBoard(board)
  return board.every((cell) => cell !== null)
}

export function countFreeCells(board: Board): number {
  assertBoard(board)
  return board.reduce((count, cell) => count + (cell === null ? 1 : 0), 0)
}

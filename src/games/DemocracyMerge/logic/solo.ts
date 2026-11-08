import {
  createEmptyBoard,
  generateCharacterSequence,
  isBoardFull,
  placeCharacter,
  type Board,
  type CharacterLevel,
  type ObstacleType,
} from './gameEngine.ts'
import {
  applyToolReward,
  buyTool,
  generateObstacleSequence,
  placeObstacleAtRandomFreeCell,
  rollMergeRewards,
  type MergeReward,
} from './events.ts'
import {
  canFreeCellWithTools,
  emptyToolInventory,
  replaceCurrentCharacter,
  returnStoredCharacter,
  storeCharacter,
  swapCharacters,
  applySaw,
  type StoredCharacter,
  type ToolInventory,
  type ToolType,
} from './tools.ts'

export const SOLO_SAVE_VERSION = 1
export const SOLO_DURATION_MS = 30 * 60 * 1000
export const SOLO_HISTORY_LIMIT = 50

export type SoloStatus = 'active' | 'completed' | 'surrendered'

export type SoloResult = {
  status: Exclude<SoloStatus, 'active'>
  score: number
  maxLevel: CharacterLevel
  mergeCount: number
  chainReactions: number
  toolsUsed: number
  coins: number
  completedAt: string
  timedOut?: boolean
}

export type SoloGameState = {
  version: typeof SOLO_SAVE_VERSION
  board: Board
  characterSequence: CharacterLevel[]
  obstacleSequence: (ObstacleType | null)[]
  turnNumber: number
  score: number
  maxLevel: CharacterLevel
  mergeCount: number
  chainReactions: number
  toolsUsed: number
  coins: number
  inventory: ToolInventory
  storage: StoredCharacter
  level6MergeCount: number
  startedAt: string
  deadlineAt: string
  status: SoloStatus
  result: SoloResult | null
}

export type SoloHistoryRecord = {
  id: string
  completedAt: string
  score: number
  maxLevel: CharacterLevel
  mergeCount: number
  chainReactions: number
  toolsUsed: number
  coins: number
  status: Exclude<SoloStatus, 'active'>
}

export type SoloProfile = {
  history: SoloHistoryRecord[]
  totalGames: number
  totalPoints: number
  bestScore: number
  maxLevel: CharacterLevel
}

function buildResult(
  state: Omit<SoloGameState, 'result'>,
  status: Exclude<SoloStatus, 'active'>,
  completedAt: string,
  timedOut = false,
): SoloResult {
  return {
    status,
    score: state.score,
    maxLevel: state.maxLevel,
    mergeCount: state.mergeCount,
    chainReactions: state.chainReactions,
    toolsUsed: state.toolsUsed,
    coins: state.coins,
    completedAt,
    ...(timedOut ? { timedOut: true } : {}),
  }
}

function withBoardTerminalCheck(
  state: Omit<SoloGameState, 'result'>,
  now: number,
): SoloGameState {
  const completed = isBoardFull(state.board) &&
    !canFreeCellWithTools(state.board, state.inventory, state.storage, state.coins)
  if (!completed) return { ...state, status: 'active', result: null }
  const completedAt = new Date(now).toISOString()
  return {
    ...state,
    status: 'completed',
    result: buildResult(state, 'completed', completedAt),
  }
}

function assertActiveAndBeforeDeadline(state: SoloGameState, now: number): void {
  if (state.version !== SOLO_SAVE_VERSION) throw new Error('Unsupported solo save version.')
  if (state.status !== 'active') throw new Error('This solo game is already finished.')
  if (now >= Date.parse(state.deadlineAt)) throw new Error('The solo game deadline has passed.')
}

export function createSoloGameState(
  now = Date.now(),
  random: () => number = Math.random,
): SoloGameState {
  const startedAt = new Date(now).toISOString()
  return {
    version: SOLO_SAVE_VERSION,
    board: createEmptyBoard(),
    characterSequence: generateCharacterSequence(10000, random),
    obstacleSequence: generateObstacleSequence(10000, random),
    turnNumber: 0,
    score: 0,
    maxLevel: 1,
    mergeCount: 0,
    chainReactions: 0,
    toolsUsed: 0,
    coins: 200,
    inventory: emptyToolInventory(),
    storage: null,
    level6MergeCount: 0,
    startedAt,
    deadlineAt: new Date(now + SOLO_DURATION_MS).toISOString(),
    status: 'active',
    result: null,
  }
}

export function currentSoloCharacter(state: SoloGameState): CharacterLevel | null {
  return state.characterSequence[state.turnNumber] ?? null
}

export function nextSoloCharacter(state: SoloGameState): CharacterLevel | null {
  return state.characterSequence[state.turnNumber + 1] ?? null
}

export function placeSoloCharacter(
  source: SoloGameState,
  cellIndex: number,
  now = Date.now(),
  random: () => number = Math.random,
): { state: SoloGameState; rewards: MergeReward[] } {
  assertActiveAndBeforeDeadline(source, now)
  const current = currentSoloCharacter(source)
  if (!current) throw new Error('The solo character sequence is exhausted.')
  const placement = placeCharacter(source.board, cellIndex, current, source.level6MergeCount)
  let board = placement.board
  let coins = source.coins
  let inventory = source.inventory
  const rolledRewards = rollMergeRewards(placement.merges.length, random)
  const rewards: MergeReward[] = []

  for (const reward of rolledRewards) {
    if (reward.kind === 'money_bag') {
      coins += reward.coins
      rewards.push(reward)
    } else {
      const awarded = applyToolReward(inventory, reward.tool)
      inventory = awarded.inventory
      if (awarded.awarded) rewards.push(reward)
    }
  }

  const obstacleType = source.obstacleSequence[source.turnNumber]
  if (obstacleType) board = placeObstacleAtRandomFreeCell(board, obstacleType, random).board

  const levels = board.flatMap((cell) =>
    cell?.kind === 'character' ? [cell.level] : [])
  const next = {
    ...source,
    board,
    turnNumber: source.turnNumber + 1,
    score: source.score + placement.scoreDelta,
    maxLevel: Math.max(source.maxLevel, ...levels, 1) as CharacterLevel,
    mergeCount: source.mergeCount + placement.merges.length,
    chainReactions: source.chainReactions + (placement.merges.length > 1 ? 1 : 0),
    coins,
    inventory,
    level6MergeCount: placement.level6MergeCount,
  }
  return { state: withBoardTerminalCheck(next, now), rewards }
}

export function applySoloTool(
  source: SoloGameState,
  tool: ToolType,
  options: {
    cellIndex?: number
    firstCellIndex?: number
    secondCellIndex?: number
    storageAction?: 'store' | 'return'
  } = {},
  now = Date.now(),
): SoloGameState {
  assertActiveAndBeforeDeadline(source, now)
  let board = source.board
  let inventory = source.inventory
  let storage = source.storage
  let coins = source.coins
  let toolsUsed = source.toolsUsed

  if (tool === 'saw') {
    const result = applySaw(board, options.cellIndex ?? -1, inventory, coins)
    board = result.board
    inventory = result.inventory
    coins = result.coins
    toolsUsed += 1
  } else if (tool === 'storage') {
    if (options.storageAction === 'store') {
      const result = storeCharacter(board, options.cellIndex ?? -1, storage, inventory)
      board = result.board
      storage = result.storage
      inventory = result.inventory
    } else if (options.storageAction === 'return') {
      const result = returnStoredCharacter(board, options.cellIndex ?? -1, storage, inventory)
      board = result.board
      storage = result.storage
      inventory = result.inventory
      toolsUsed += 1
    } else {
      throw new Error('Choose whether to store or return the character.')
    }
  } else if (tool === 'swap') {
    const result = swapCharacters(board, options.firstCellIndex ?? -1, options.secondCellIndex ?? -1, inventory)
    board = result.board
    inventory = result.inventory
    toolsUsed += 1
  } else {
    const replaced = replaceCurrentCharacter(currentSoloCharacter(source) ?? 1, inventory)
    inventory = replaced.inventory
    toolsUsed += 1
  }

  return withBoardTerminalCheck({
    ...source,
    board,
    inventory,
    storage,
    coins,
    toolsUsed,
  }, now)
}

export function buySoloTool(
  source: SoloGameState,
  tool: ToolType,
  now = Date.now(),
): SoloGameState {
  assertActiveAndBeforeDeadline(source, now)
  const purchase = buyTool(source.inventory, tool, source.coins)
  return { ...source, inventory: purchase.inventory, coins: purchase.coins }
}

export function surrenderSoloGame(source: SoloGameState, now = Date.now()): SoloGameState {
  if (source.status !== 'active') throw new Error('This solo game is already finished.')
  const completedAt = new Date(now).toISOString()
  return {
    ...source,
    status: 'surrendered',
    result: buildResult(source, 'surrendered', completedAt),
  }
}

export function finalizeSoloDeadline(source: SoloGameState, now = Date.now()): SoloGameState {
  if (source.status !== 'active' || now < Date.parse(source.deadlineAt)) return source
  const completedAt = new Date(now).toISOString()
  return {
    ...source,
    status: 'completed',
    result: buildResult(source, 'completed', completedAt, true),
  }
}

export function createEmptySoloProfile(): SoloProfile {
  return { history: [], totalGames: 0, totalPoints: 0, bestScore: 0, maxLevel: 1 }
}

export function recordSoloResult(
  profile: SoloProfile,
  state: SoloGameState,
): SoloProfile {
  if (!state.result) throw new Error('Only a completed or surrendered game can be recorded.')
  const record: SoloHistoryRecord = {
    id: crypto.randomUUID(),
    completedAt: state.result.completedAt,
    score: state.result.score,
    maxLevel: state.result.maxLevel,
    mergeCount: state.result.mergeCount,
    chainReactions: state.result.chainReactions,
    toolsUsed: state.result.toolsUsed,
    coins: state.result.coins,
    status: state.result.status,
  }
  return {
    history: [record, ...profile.history].slice(0, SOLO_HISTORY_LIMIT),
    totalGames: profile.totalGames + 1,
    totalPoints: profile.totalPoints + record.score,
    bestScore: Math.max(profile.bestScore, record.score),
    maxLevel: Math.max(profile.maxLevel, record.maxLevel) as CharacterLevel,
  }
}

export function deleteSoloHistoryRecord(profile: SoloProfile, recordId: string): SoloProfile {
  return { ...profile, history: profile.history.filter((record) => record.id !== recordId) }
}

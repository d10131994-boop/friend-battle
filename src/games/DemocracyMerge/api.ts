import { database } from '../../database'
import type { MultiplayerRoom } from '../../multiplayer'
import type { Board, CharacterLevel, ObstacleType } from './logic/gameEngine'
import type { ToolInventory, StoredCharacter, ToolType } from './logic/tools'

export type DemocracyMergePlayerStatus = 'active' | 'completed' | 'surrendered' | 'left'

export type DemocracyMergePublicPlayer = {
  userId: string
  displayName: string
  score: number
  maxLevel: CharacterLevel
}

export type DemocracyMergePersonalPlayer = DemocracyMergePublicPlayer & {
  status: DemocracyMergePlayerStatus
  board: Board
  turnNumber: number
  mergeCount: number
  chainReactions: number
  toolsUsed: number
  coins: number
  inventory: ToolInventory
  storage: StoredCharacter
  level6MergeCount: number
  revision: number
  result: Record<string, unknown> | null
}

export type DemocracyMergeFinalResult = {
  userId: string
  displayName: string
  status: Exclude<DemocracyMergePlayerStatus, 'active'>
  score: number
  maxLevel: CharacterLevel
  mergeCount: number
  chainReactions: number
  toolsUsed: number
  coins: number
  rank: number | null
}

export type DemocracyMergeMatch = {
  matchId: string
  startedAt: string
  gameStartedAt: string
  deadlineAt: string
  status: 'playing' | 'completed' | 'cancelled'
  completedAt: string | null
  currentCharacter: CharacterLevel | null
  nextCharacter: CharacterLevel | null
  obstacleEvent: ObstacleType | null
  players: DemocracyMergePublicPlayer[]
  me: DemocracyMergePersonalPlayer
  finalResults: DemocracyMergeFinalResult[] | null
}

export type DemocracyMergeSnapshot = {
  room: MultiplayerRoom
  match: DemocracyMergeMatch | null
  rewards?: Array<{ kind: 'money_bag'; coins: number } | { kind: 'tool'; tool: 'saw' | 'storage' | 'swap' | 'replace' }>
}

export type DemocracyMergeStartResponse = {
  room: MultiplayerRoom
  match: Pick<DemocracyMergeMatch, 'matchId' | 'startedAt' | 'gameStartedAt' | 'deadlineAt'>
}

export type DemocracyMergeRoomResponse = {
  room: MultiplayerRoom
  closed?: boolean
}

async function invoke<T>(
  initData: string | undefined,
  body: Record<string, unknown>,
): Promise<T> {
  if (!initData) throw new Error('Не удалось получить данные авторизации Telegram.')
  return database.invokeFunction<T, Record<string, unknown>>('democracy-merge', {
    ...body,
    initData,
  })
}

export function startDemocracyMergeMatch(
  initData: string | undefined,
  roomId: string,
): Promise<DemocracyMergeStartResponse> {
  return invoke(initData, { action: 'start_match', roomId })
}

export function getDemocracyMergeMatch(
  initData: string | undefined,
  roomId: string,
): Promise<DemocracyMergeSnapshot> {
  return invoke(initData, { action: 'get_match', roomId })
}

export function leaveDemocracyMergeMatch(
  initData: string | undefined,
  roomId: string,
): Promise<DemocracyMergeRoomResponse> {
  return invoke(initData, { action: 'leave_match', roomId })
}

export function returnDemocracyMergeToRoom(
  initData: string | undefined,
  roomId: string,
): Promise<DemocracyMergeRoomResponse> {
  return invoke(initData, { action: 'return_to_room', roomId })
}

export type DemocracyMergeActionResponse = DemocracyMergeSnapshot & {
  rewards?: Array<
    | { kind: 'money_bag'; coins: number }
    | { kind: 'tool'; tool: ToolType }
  >
}

export function placeDemocracyMergeCharacter(
  initData: string | undefined,
  roomId: string,
  cellIndex: number,
  actionId: string,
): Promise<DemocracyMergeActionResponse> {
  return invoke(initData, { action: 'place_character', roomId, cellIndex, actionId })
}

export function useDemocracyMergeTool(
  initData: string | undefined,
  roomId: string,
  tool: ToolType,
  actionId: string,
  options: { cellIndex?: number; firstCellIndex?: number; secondCellIndex?: number; storageAction?: 'store' | 'return' } = {},
): Promise<DemocracyMergeActionResponse> {
  return invoke(initData, { action: 'use_tool', roomId, tool, actionId, ...options })
}

export function buyDemocracyMergeTool(
  initData: string | undefined,
  roomId: string,
  tool: ToolType,
  actionId: string,
): Promise<DemocracyMergeActionResponse> {
  return invoke(initData, { action: 'buy_tool', roomId, tool, actionId })
}

export function surrenderDemocracyMergeMatch(
  initData: string | undefined,
  roomId: string,
  actionId: string,
): Promise<DemocracyMergeActionResponse> {
  return invoke(initData, { action: 'surrender', roomId, actionId })
}

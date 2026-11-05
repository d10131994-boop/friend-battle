import { database } from '../database'
import type { DatabaseRecord } from '../database'
import type {
  CloseRoomParams,
  CreateRoomParams,
  GetRoomParams,
  GetRoomTokenParams,
  HeartbeatRoomParams,
  JoinRoomParams,
  LeaveRoomParams,
  MultiplayerAuth,
  MultiplayerHeartbeatResult,
  MultiplayerPlayer,
  MultiplayerRoom,
  MultiplayerRoomStatus,
  MultiplayerRoomToken,
  MultiplayerService,
  SetPlayerReadyParams,
} from './types'
import { MultiplayerError } from './types'

/** Action names exposed by the trusted Multiplayer Edge Function. */
export interface DatabaseMultiplayerActions {
  createRoom: string
  joinRoom: string
  getRoom: string
  setReady: string
  leaveRoom: string
  closeRoom: string
  heartbeat: string
  getRoomToken: string
}

export interface DatabaseMultiplayerAdapterOptions {
  /** Name of the trusted Supabase Edge Function handling multiplayer requests. */
  functionName: string
  /** Optional mapping to the action names implemented by that function. */
  actions?: Partial<DatabaseMultiplayerActions>
}

const DEFAULT_ACTIONS: DatabaseMultiplayerActions = {
  createRoom: 'create_room',
  joinRoom: 'join_room',
  getRoom: 'get_room',
  setReady: 'set_ready',
  leaveRoom: 'leave_room',
  closeRoom: 'close_room',
  heartbeat: 'heartbeat',
  getRoomToken: 'get_room_token',
}

const ROOM_STATUSES: readonly MultiplayerRoomStatus[] = [
  'waiting',
  'starting',
  'playing',
  'finished',
  'cancelled',
]

type MultiplayerAction = keyof DatabaseMultiplayerActions

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  )
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value)
}

function isMultiplayerPlayer(value: unknown): value is MultiplayerPlayer {
  if (!isRecord(value)) return false

  return (
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.displayName) &&
    typeof value.isReady === 'boolean' &&
    typeof value.isHost === 'boolean' &&
    isNullableTimestamp(value.joinedAt) &&
    isNullableTimestamp(value.lastSeenAt)
  )
}

/**
 * Supabase's generic invoke type is compile-time only. Validate the untrusted
 * Edge Function payload before exposing it as a MultiplayerRoom.
 */
function parseMultiplayerRoom(value: unknown): MultiplayerRoom {
  if (!isRecord(value)) {
    throw new MultiplayerError('Сервер вернул некорректный ответ комнаты.')
  }

  const valid =
    isNonEmptyString(value.roomId) &&
    isNonEmptyString(value.gameId) &&
    isNonEmptyString(value.inviteCode) &&
    typeof value.status === 'string' &&
    ROOM_STATUSES.includes(value.status as MultiplayerRoomStatus) &&
    Array.isArray(value.players) &&
    value.players.every(isMultiplayerPlayer) &&
    (value.maxPlayers === null ||
      (typeof value.maxPlayers === 'number' && Number.isInteger(value.maxPlayers))) &&
    isNullableTimestamp(value.createdAt) &&
    isNullableTimestamp(value.startedAt) &&
    isNullableTimestamp(value.finishedAt)

  if (!valid) {
    throw new MultiplayerError(
      'Сервер вернул комнату в формате, несовместимом с контрактом Multiplayer Core.',
    )
  }

  return value as unknown as MultiplayerRoom
}

function parseHeartbeat(value: unknown): MultiplayerHeartbeatResult {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.roomId) ||
    !isTimestamp(value.lastSeenAt)
  ) {
    throw new MultiplayerError('Сервер вернул некорректное подтверждение heartbeat.')
  }

  return value as unknown as MultiplayerHeartbeatResult
}

function parseRoomToken(value: unknown): MultiplayerRoomToken {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.roomId) ||
    !isNonEmptyString(value.accessToken) ||
    !isTimestamp(value.expiresAt)
  ) {
    throw new MultiplayerError('Сервер вернул некорректный токен комнаты.')
  }

  return value as unknown as MultiplayerRoomToken
}

/**
 * Bridges the game-agnostic Multiplayer Core to Database.invokeFunction.
 * Telegram initData is forwarded unchanged and verified only by the server.
 */
export function createDatabaseMultiplayerAdapter(
  options: DatabaseMultiplayerAdapterOptions,
): MultiplayerService {
  if (!isNonEmptyString(options.functionName)) {
    throw new TypeError('A multiplayer Edge Function name is required.')
  }

  const actions = { ...DEFAULT_ACTIONS, ...options.actions }

  for (const [key, action] of Object.entries(actions)) {
    if (!isNonEmptyString(action)) {
      throw new TypeError(`A non-empty multiplayer action is required for ${key}.`)
    }
  }

  async function invoke(
    action: MultiplayerAction,
    auth: MultiplayerAuth,
    params: DatabaseRecord,
  ): Promise<unknown> {
    if (!isNonEmptyString(auth.initData)) {
      throw new TypeError('Telegram initData is required for multiplayer requests.')
    }

    return database.invokeFunction<unknown, DatabaseRecord>(
      options.functionName.trim(),
      {
        ...params,
        action: actions[action],
        initData: auth.initData,
      },
    )
  }

  async function invokeRoom(
    action: MultiplayerAction,
    auth: MultiplayerAuth,
    params: DatabaseRecord,
  ): Promise<MultiplayerRoom> {
    return parseMultiplayerRoom(await invoke(action, auth, params))
  }

  return {
    createRoom: (auth: MultiplayerAuth, params: CreateRoomParams) =>
      invokeRoom('createRoom', auth, {
        gameId: params.gameId,
        ...(params.maxPlayers === undefined ? {} : { maxPlayers: params.maxPlayers }),
      }),

    joinRoom: (auth: MultiplayerAuth, params: JoinRoomParams) =>
      invokeRoom('joinRoom', auth, { inviteCode: params.inviteCode }),

    getRoom: (auth: MultiplayerAuth, params: GetRoomParams) =>
      invokeRoom('getRoom', auth, { roomId: params.roomId }),

    setReady: (auth: MultiplayerAuth, params: SetPlayerReadyParams) =>
      invokeRoom('setReady', auth, {
        roomId: params.roomId,
        isReady: params.isReady,
      }),

    leaveRoom: (auth: MultiplayerAuth, params: LeaveRoomParams) =>
      invokeRoom('leaveRoom', auth, { roomId: params.roomId }),

    closeRoom: (auth: MultiplayerAuth, params: CloseRoomParams) =>
      invokeRoom('closeRoom', auth, { roomId: params.roomId }),

    heartbeat: async (auth: MultiplayerAuth, params: HeartbeatRoomParams) =>
      parseHeartbeat(await invoke('heartbeat', auth, { roomId: params.roomId })),

    getRoomToken: async (auth: MultiplayerAuth, params: GetRoomTokenParams) =>
      parseRoomToken(await invoke('getRoomToken', auth, { roomId: params.roomId })),
  }
}

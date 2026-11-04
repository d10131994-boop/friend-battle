import { database } from '../database'
import type { DatabaseRecord } from '../database'
import type {
  CreateRoomParams,
  GetRoomParams,
  JoinRoomParams,
  MultiplayerAuth,
  MultiplayerPlayer,
  MultiplayerRoom,
  MultiplayerRoomStatus,
  SetPlayerReadyParams,
} from './types'
import { MultiplayerError } from './types'
import type { RoomServiceAdapter } from './roomService'
import type { InviteServiceAdapter } from './inviteService'
import type { PlayerServiceAdapter } from './playerService'

/**
 * The action names are configurable because the shared server endpoint and its
 * public contract must be agreed independently from the client module.
 */
export interface DatabaseMultiplayerActions {
  createRoom: string
  joinRoom: string
  getRoom: string
  setReady: string
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

function isNullableTimestamp(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.trim().length > 0 &&
      Number.isFinite(Date.parse(value)))
  )
}

function isMultiplayerPlayer(value: unknown): value is MultiplayerPlayer {
  if (!isRecord(value)) return false

  return (
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.displayName) &&
    typeof value.isReady === 'boolean' &&
    typeof value.isHost === 'boolean' &&
    isNullableTimestamp(value.joinedAt)
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

/**
 * Bridges the generic Multiplayer Core contracts to Database.invokeFunction.
 *
 * The Edge Function is responsible for validating Telegram initData and for
 * enforcing authorization. The browser only forwards initData; it must never
 * attempt to validate it or use a service-role key.
 *
 * The function must return a normalized MultiplayerRoom object. Runtime
 * validation protects the core from malformed or outdated server responses.
 */
export function createDatabaseMultiplayerAdapter(
  options: DatabaseMultiplayerAdapterOptions,
): RoomServiceAdapter & InviteServiceAdapter & PlayerServiceAdapter {
  if (!isNonEmptyString(options.functionName)) {
    throw new TypeError('A multiplayer Edge Function name is required.')
  }

  const actions = { ...DEFAULT_ACTIONS, ...options.actions }

  for (const [key, action] of Object.entries(actions)) {
    if (!isNonEmptyString(action)) {
      throw new TypeError(`A non-empty multiplayer action is required for ${key}.`)
    }
  }

  async function execute(
    action: MultiplayerAction,
    auth: MultiplayerAuth,
    params: DatabaseRecord,
  ): Promise<MultiplayerRoom> {
    if (!isNonEmptyString(auth.initData)) {
      throw new TypeError('Telegram initData is required for multiplayer requests.')
    }

    const response = await database.invokeFunction<unknown, DatabaseRecord>(
      options.functionName.trim(),
      {
        ...params,
        action: actions[action],
        initData: auth.initData,
      },
    )

    return parseMultiplayerRoom(response)
  }

  return {
    createRoom: (auth: MultiplayerAuth, params: CreateRoomParams) =>
      execute('createRoom', auth, {
        gameId: params.gameId,
        ...(params.maxPlayers === undefined ? {} : { maxPlayers: params.maxPlayers }),
      }),

    joinRoom: (auth: MultiplayerAuth, params: JoinRoomParams) =>
      execute('joinRoom', auth, { inviteCode: params.inviteCode }),

    getRoom: (auth: MultiplayerAuth, params: GetRoomParams) =>
      execute('getRoom', auth, { roomId: params.roomId }),

    setReady: (auth: MultiplayerAuth, params: SetPlayerReadyParams) =>
      execute('setReady', auth, {
        roomId: params.roomId,
        isReady: params.isReady,
      }),
  }
}

import { database } from '../database'
import type { DatabaseRecord } from '../database'
import type {
  CreateRoomParams,
  GetRoomParams,
  JoinRoomParams,
  MultiplayerAuth,
  MultiplayerRoom,
  SetPlayerReadyParams,
} from './types'
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

type MultiplayerAction = keyof DatabaseMultiplayerActions

/**
 * Bridges the generic Multiplayer Core contracts to Database.invokeFunction.
 *
 * The Edge Function is responsible for validating Telegram initData and for
 * enforcing authorization. The browser only forwards initData; it must never
 * attempt to validate it or use a service-role key.
 *
 * The function is expected to return a normalized MultiplayerRoom object.
 * This adapter does not assume any PostgreSQL table names or schema.
 */
export function createDatabaseMultiplayerAdapter(
  options: DatabaseMultiplayerAdapterOptions,
): RoomServiceAdapter & InviteServiceAdapter & PlayerServiceAdapter {
  if (!options.functionName.trim()) {
    throw new TypeError('A multiplayer Edge Function name is required.')
  }

  const actions = { ...DEFAULT_ACTIONS, ...options.actions }

  async function execute(
    action: MultiplayerAction,
    auth: MultiplayerAuth,
    params: DatabaseRecord,
  ): Promise<MultiplayerRoom> {
    return database.invokeFunction<MultiplayerRoom, DatabaseRecord>(
      options.functionName,
      {
        action: actions[action],
        initData: auth.initData,
        ...params,
      },
    )
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

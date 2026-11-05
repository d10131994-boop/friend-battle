import type {
  CloseRoomParams,
  CreateRoomParams,
  GetRoomParams,
  MultiplayerAuth,
  MultiplayerRoom,
} from './types'
import { MultiplayerError } from './types'

/** Adapter boundary for room creation, lookup, and host-controlled closure. */
export interface RoomServiceAdapter {
  createRoom(auth: MultiplayerAuth, params: CreateRoomParams): Promise<MultiplayerRoom>
  getRoom(auth: MultiplayerAuth, params: GetRoomParams): Promise<MultiplayerRoom>
  closeRoom(auth: MultiplayerAuth, params: CloseRoomParams): Promise<MultiplayerRoom>
}

export function createRoomService(adapter: RoomServiceAdapter) {
  return {
    async create(auth: MultiplayerAuth, params: CreateRoomParams) {
      try {
        return await adapter.createRoom(auth, params)
      } catch (error) {
        throw new MultiplayerError('Не удалось создать игровую комнату.', error)
      }
    },

    async get(auth: MultiplayerAuth, params: GetRoomParams) {
      try {
        return await adapter.getRoom(auth, params)
      } catch (error) {
        throw new MultiplayerError('Не удалось получить игровую комнату.', error)
      }
    },

    async close(auth: MultiplayerAuth, params: CloseRoomParams) {
      try {
        return await adapter.closeRoom(auth, params)
      } catch (error) {
        throw new MultiplayerError('Не удалось закрыть игровую комнату.', error)
      }
    },
  }
}

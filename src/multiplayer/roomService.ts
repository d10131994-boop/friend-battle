import type {
  CreateRoomParams,
  GetRoomParams,
  MultiplayerAuth,
  MultiplayerRoom,
} from './types'
import { MultiplayerError } from './types'

/**
 * Адаптер — граница между общим модулем и конкретным серверным API игры.
 * Игры подключают свои текущие Edge Functions через этот интерфейс.
 */
export interface RoomServiceAdapter {
  createRoom(auth: MultiplayerAuth, params: CreateRoomParams): Promise<MultiplayerRoom>
  getRoom(auth: MultiplayerAuth, params: GetRoomParams): Promise<MultiplayerRoom>
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
  }
}

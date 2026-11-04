import type {
  MultiplayerAuth,
  MultiplayerPlayer,
  MultiplayerRoom,
  GetRoomParams,
  SetPlayerReadyParams,
} from './types'
import { MultiplayerError } from './types'

export interface PlayerServiceAdapter {
  setReady(auth: MultiplayerAuth, params: SetPlayerReadyParams): Promise<MultiplayerRoom>
  getRoom(auth: MultiplayerAuth, params: GetRoomParams): Promise<MultiplayerRoom>
}

export function createPlayerService(adapter: PlayerServiceAdapter) {
  return {
    async setReady(auth: MultiplayerAuth, params: SetPlayerReadyParams) {
      try {
        return await adapter.setReady(auth, params)
      } catch (error) {
        throw new MultiplayerError('Не удалось обновить готовность игрока.', error)
      }
    },

    async getPlayers(auth: MultiplayerAuth, roomId: string): Promise<MultiplayerPlayer[]> {
      try {
        const room = await adapter.getRoom(auth, { roomId })
        return room.players
      } catch (error) {
        throw new MultiplayerError('Не удалось получить список игроков.', error)
      }
    },
  }
}

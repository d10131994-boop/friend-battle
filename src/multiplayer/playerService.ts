import type {
  GetRoomParams,
  GetRoomTokenParams,
  HeartbeatRoomParams,
  LeaveRoomParams,
  MultiplayerAuth,
  MultiplayerHeartbeatResult,
  MultiplayerPlayer,
  MultiplayerRoom,
  MultiplayerRoomToken,
  SetPlayerReadyParams,
} from './types'
import { MultiplayerError } from './types'

export interface PlayerServiceAdapter {
  setReady(auth: MultiplayerAuth, params: SetPlayerReadyParams): Promise<MultiplayerRoom>
  getRoom(auth: MultiplayerAuth, params: GetRoomParams): Promise<MultiplayerRoom>
  leaveRoom(auth: MultiplayerAuth, params: LeaveRoomParams): Promise<MultiplayerRoom>
  heartbeat(auth: MultiplayerAuth, params: HeartbeatRoomParams): Promise<MultiplayerHeartbeatResult>
  getRoomToken(auth: MultiplayerAuth, params: GetRoomTokenParams): Promise<MultiplayerRoomToken>
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

    async leave(auth: MultiplayerAuth, params: LeaveRoomParams) {
      try {
        return await adapter.leaveRoom(auth, params)
      } catch (error) {
        throw new MultiplayerError('Не удалось выйти из игровой комнаты.', error)
      }
    },

    async heartbeat(auth: MultiplayerAuth, params: HeartbeatRoomParams) {
      try {
        return await adapter.heartbeat(auth, params)
      } catch (error) {
        throw new MultiplayerError('Не удалось отправить heartbeat комнаты.', error)
      }
    },

    async getRoomToken(auth: MultiplayerAuth, roomId: string): Promise<MultiplayerRoomToken> {
      try {
        return await adapter.getRoomToken(auth, { roomId })
      } catch (error) {
        throw new MultiplayerError('Не удалось получить токен игровой комнаты.', error)
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

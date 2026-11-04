import type {
  JoinRoomParams,
  MultiplayerAuth,
  MultiplayerRoom,
} from './types'
import { MultiplayerError } from './types'

export interface InviteServiceAdapter {
  joinRoom(auth: MultiplayerAuth, params: JoinRoomParams): Promise<MultiplayerRoom>
}

/** Нормализует код, чтобы пробелы и регистр не мешали подключению. */
export function normalizeInviteCode(code: string): string {
  return code.trim().replace(/\s+/g, '').toUpperCase()
}

export function createInviteService(adapter: InviteServiceAdapter) {
  return {
    async join(auth: MultiplayerAuth, params: JoinRoomParams) {
      const inviteCode = normalizeInviteCode(params.inviteCode)

      if (!inviteCode) {
        throw new MultiplayerError('Введи код приглашения.')
      }

      try {
        return await adapter.joinRoom(auth, { inviteCode })
      } catch (error) {
        throw new MultiplayerError('Не удалось подключиться к комнате по приглашению.', error)
      }
    },
  }
}

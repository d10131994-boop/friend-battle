/** Общие типы мультиплеера Friend Battle. Не зависят от Supabase и конкретной игры. */

export type MultiplayerGameId =
  | 'reaction-rush'
  | 'brain-battle'
  | (string & {})

export type MultiplayerRoomStatus =
  | 'waiting'
  | 'starting'
  | 'playing'
  | 'finished'
  | 'cancelled'

export interface MultiplayerPlayer {
  /** Telegram ID игрока в виде строки. */
  userId: string
  displayName: string
  isReady: boolean
  isHost: boolean
  joinedAt: string | null
}

export interface MultiplayerRoom {
  roomId: string
  gameId: MultiplayerGameId
  inviteCode: string
  status: MultiplayerRoomStatus
  players: MultiplayerPlayer[]
  /** Может быть неизвестно для старых игровых бэкендов. */
  maxPlayers: number | null
  createdAt: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface MultiplayerAuth {
  /** Telegram initData. Проверка подписи выполняется только на сервере. */
  initData: string
}

export interface CreateRoomParams {
  gameId: MultiplayerGameId
  maxPlayers?: number
}

export interface JoinRoomParams {
  inviteCode: string
}

export interface GetRoomParams {
  /** Идентификатор комнаты или inviteCode — формат определяет адаптер. */
  roomId: string
}

export interface SetPlayerReadyParams {
  roomId: string
  isReady: boolean
}

export interface MultiplayerService {
  createRoom(auth: MultiplayerAuth, params: CreateRoomParams): Promise<MultiplayerRoom>
  joinRoom(auth: MultiplayerAuth, params: JoinRoomParams): Promise<MultiplayerRoom>
  getRoom(auth: MultiplayerAuth, params: GetRoomParams): Promise<MultiplayerRoom>
  setReady(auth: MultiplayerAuth, params: SetPlayerReadyParams): Promise<MultiplayerRoom>
}

/** Общая ошибка слоя мультиплеера с исходной причиной для логирования. */
export class MultiplayerError extends Error {
  readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'MultiplayerError'
    this.cause = cause
  }
}

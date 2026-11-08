/** Общие типы мультиплеера Friend Battle. Не зависят от Supabase и конкретной игры. */

export type MultiplayerGameId =
  | 'reaction-rush'
  | 'brain-battle'
  | 'no-count-it'
  | 'rock-paper-scissors'
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
  /** Последний heartbeat, принятый сервером. */
  lastSeenAt: string | null
  wins: number
  matchesPlayed: number
}

export interface MultiplayerRoom {
  roomId: string
  gameId: MultiplayerGameId | null
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
  maxPlayers?: number
}

export interface SelectGameParams {
  roomId: string
  gameId: MultiplayerGameId
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

export interface LeaveRoomParams {
  roomId: string
}

export interface CloseRoomParams {
  roomId: string
}

export interface HeartbeatRoomParams {
  roomId: string
}

export interface MultiplayerHeartbeatResult {
  roomId: string
  lastSeenAt: string
  expired?: boolean
}

export interface GetRoomTokenParams {
  roomId: string
}

export interface MultiplayerRoomToken {
  roomId: string
  accessToken: string
  expiresAt: string
}

export interface MultiplayerService {
  createRoom(auth: MultiplayerAuth, params: CreateRoomParams): Promise<MultiplayerRoom>
  selectGame(auth: MultiplayerAuth, params: SelectGameParams): Promise<MultiplayerRoom>
  joinRoom(auth: MultiplayerAuth, params: JoinRoomParams): Promise<MultiplayerRoom>
  getRoom(auth: MultiplayerAuth, params: GetRoomParams): Promise<MultiplayerRoom>
  setReady(auth: MultiplayerAuth, params: SetPlayerReadyParams): Promise<MultiplayerRoom>
  leaveRoom(auth: MultiplayerAuth, params: LeaveRoomParams): Promise<MultiplayerRoom>
  closeRoom(auth: MultiplayerAuth, params: CloseRoomParams): Promise<MultiplayerRoom>
  heartbeat(auth: MultiplayerAuth, params: HeartbeatRoomParams): Promise<MultiplayerHeartbeatResult>
  getRoomToken(auth: MultiplayerAuth, params: GetRoomTokenParams): Promise<MultiplayerRoomToken>
}

/** Общая ошибка слоя мультиплеера с исходной причиной для логирования. */
export class MultiplayerError extends Error {
  override readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'MultiplayerError'
    this.cause = cause
  }
}

/**
 * Общие типы мультиплеера Friend Battle.
 *
 * Этот файл не зависит от конкретной игры,
 * Supabase или способа подключения игроков.
 */

/**
 * Идентификатор игры.
 *
 * Первые поддерживаемые игры:
 * - reaction-rush
 * - brain-battle
 *
 * В будущем можно добавлять новые игры
 * без изменения общей архитектуры.
 */
export type MultiplayerGameId =
  | 'reaction-rush'
  | 'brain-battle'
  | (string & {})

/**
 * Состояние игровой комнаты.
 *
 * waiting   — ожидаем игроков;
 * starting  — игроки готовы, начинается запуск;
 * playing   — игра идёт;
 * finished  — игра завершена;
 * cancelled — комната отменена.
 */
export type MultiplayerRoomStatus =
  | 'waiting'
  | 'starting'
  | 'playing'
  | 'finished'
  | 'cancelled'

/**
 * Данные игрока внутри комнаты.
 *
 * Здесь находятся только общие данные.
 * Игровые очки, ответы и другие игровые показатели
 * остаются внутри соответствующей игры.
 */
export interface MultiplayerPlayer {
  /** Telegram ID игрока в виде строки. */
  userId: string

  /** Имя игрока для отображения. */
  displayName: string

  /** Подтвердил ли игрок готовность. */
  isReady: boolean

  /** Является ли игрок создателем комнаты. */
  isHost: boolean

  /** Время подключения к комнате в ISO-формате. */
  joinedAt: string | null
}

/**
 * Общая модель игровой комнаты.
 */
export interface MultiplayerRoom {
  /** Уникальный ID комнаты. */
  roomId: string

  /** Игра, для которой создана комната. */
  gameId: MultiplayerGameId

  /** Код приглашения для подключения. */
  inviteCode: string

  /** Текущее состояние комнаты. */
  status: MultiplayerRoomStatus

  /** Список участников комнаты. */
  players: MultiplayerPlayer[]

  /** Максимальное количество игроков. */
  maxPlayers: number

  /** Время создания комнаты. */
  createdAt: string

  /** Время начала игры. */
  startedAt: string | null

  /** Время завершения игры. */
  finishedAt: string | null
}

/**
 * Данные для авторизации запросов.
 *
 * Сейчас используем Telegram initData.
 * Проверка initData должна выполняться на сервере.
 */
export interface MultiplayerAuth {
  initData: string
}

/**
 * Параметры создания комнаты.
 */
export interface CreateRoomParams {
  gameId: MultiplayerGameId
  maxPlayers?: number
}

/**
 * Параметры подключения к существующей комнате.
 */
export interface JoinRoomParams {
  inviteCode: string
}

/**
 * Параметры получения информации о комнате.
 */
export interface GetRoomParams {
  roomId: string
}

/**
 * Параметры изменения готовности игрока.
 */
export interface SetPlayerReadyParams {
  roomId: string
  isReady: boolean
}

/**
 * Общий интерфейс сервиса мультиплеера.
 *
 * Каждая игра будет обращаться к этому интерфейсу,
 * не зная, как именно устроено серверное подключение.
 */
export interface MultiplayerService {
  /** Создать новую комнату. */
  createRoom(
    auth: MultiplayerAuth,
    params: CreateRoomParams
  ): Promise<MultiplayerRoom>

  /** Подключиться к комнате по коду приглашения. */
  joinRoom(
    auth: MultiplayerAuth,
    params: JoinRoomParams
  ): Promise<MultiplayerRoom>

  /** Получить актуальное состояние комнаты. */
  getRoom(
    auth: MultiplayerAuth,
    params: GetRoomParams
  ): Promise<MultiplayerRoom>

  /** Изменить готовность текущего игрока. */
  setReady(
    auth: MultiplayerAuth,
    params: SetPlayerReadyParams
  ): Promise<MultiplayerRoom>
}
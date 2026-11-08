import { database } from '../database'

export type GameAvailability = Record<string, unknown> & {
  game_id: string
  is_solo_enabled: boolean
  is_multiplayer_enabled: boolean
  min_players: number
  max_players: number
  is_enabled: boolean
  sort_order: number
}

export const GAME_PRESENTATION = {
  'reaction-rush': {
    title: 'Reaction Rush',
    description: 'Три раунда по 10 секунд.',
  },
  'brain-battle': {
    title: 'Brain Battle',
    description: '10 вопросов, 15 секунд на ответ.',
  },
  'no-count-it': {
    title: 'NoCountIt',
    description: 'Три раунда на оценку количества конфет.',
  },
  'rock-paper-scissors': {
    title: 'Камень, ножницы, бумага',
    description: 'Классическая игра до трёх побед.',
  },
} as const

export type MultiplayerGameId = keyof typeof GAME_PRESENTATION
export type SoloGameId = Exclude<MultiplayerGameId, 'no-count-it'>
export type GameMode = 'solo' | 'multiplayer'

export async function loadGameAvailability(mode: GameMode): Promise<GameAvailability[]> {
  const modeColumn = mode === 'solo' ? 'is_solo_enabled' : 'is_multiplayer_enabled'
  const rows = await database.getMany<GameAvailability>('common_game_availability', {
    filters: [
      { column: 'is_enabled', operator: 'eq', value: true },
      { column: modeColumn, operator: 'eq', value: true },
    ],
    orderBy: { column: 'sort_order', ascending: true },
  })

  // A database row enables a game; this registry connects its stable ID to
  // the game UI that is actually shipped in this frontend build.
  return rows.filter((row) => row.game_id in GAME_PRESENTATION)
}

export function getGamePresentation(gameId: string) {
  return GAME_PRESENTATION[gameId as MultiplayerGameId]
}

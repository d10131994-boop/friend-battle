/**
 * Server-side and client-facing domain types for NoCountIt.
 *
 * Keep private scene metadata separate from public round snapshots:
 * clients must never receive object coordinates, the target count or the
 * correct answer before the round enters its reveal phase.
 */

export const NO_COUNT_IT_GAME_ID = 'no-count-it' as const

export const NO_COUNT_IT_RULES = {
  minPlayers: 2,
  maxPlayers: 4,
  roundsPerMatch: 3,
  preparationWindowMs: 30_000,
  imageDisplayMs: 5_000,
  answerWindowMs: 10_000,
  minCandies: 40,
  maxCandies: 120,
  minColors: 4,
  maxColors: 10,
  minCandiesPerColor: 3,
} as const

export type NoCountItMatchStatus =
  | 'preparing'
  | 'playing'
  | 'completed'
  | 'technical_aborted'
  | 'cancelled'

export type NoCountItRoundStatus =
  | 'preparing'
  | 'showing'
  | 'answering'
  | 'revealing'
  | 'completed'
  | 'technical_aborted'

export type NoCountItRoundPlayerStatus =
  | 'preparing'
  | 'ready'
  | 'active'
  | 'excluded_not_ready'
  | 'completed'

export type NoCountItMatchPlayerStatus = 'active' | 'left'

export type NoCountItCandyColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'teal'
  | 'white'
  | 'brown'

/** Private server-only scene description. Never serialize this to clients pre-reveal. */
export interface NoCountItScene {
  version: 1
  seed: string
  generator: 'candy-jar'
  objects: NoCountItSceneObject[]
  targetColor: NoCountItCandyColor
  correctCount: number
}

export interface NoCountItSceneObject {
  id: number
  x: number
  y: number
  rotation: number
  scale: number
  color: NoCountItCandyColor
  shape: 'round' | 'oval' | 'wrapped'
}

export interface NoCountItRoundPlayer {
  userId: string
  displayName: string
  status: NoCountItRoundPlayerStatus
  answer: number | null
  error: number | null
  answeredAt: string | null
}

export interface NoCountItPlayerResult {
  userId: string
  displayName: string
  totalError: number
  roundErrors: Array<number | null>
}

export interface NoCountItPublicRound {
  roundNumber: number
  status: NoCountItRoundStatus
  imageUrl: string | null
  targetColor: NoCountItCandyColor | null
  preparationDeadline: string | null
  showStartedAt: string | null
  answerDeadline: string | null
  correctCount: number | null
  players: NoCountItRoundPlayer[]
}

export interface NoCountItPublicMatch {
  matchId: string
  startedAt: string
  status: NoCountItMatchStatus
  currentRound: number
  round: NoCountItPublicRound | null
  players: NoCountItPlayerResult[]
  finalResults: NoCountItPlayerResult[] | null
  winnerUserId: string | null
}

export interface NoCountItSnapshot {
  room: import('../../multiplayer').MultiplayerRoom
  match: NoCountItPublicMatch | null
}

export interface NoCountItRoundReveal {
  roundNumber: number
  targetColor: NoCountItCandyColor
  correctCount: number
  players: NoCountItRoundPlayer[]
  accumulatedErrors: Array<{
    userId: string
    displayName: string
    totalError: number
  }>
}

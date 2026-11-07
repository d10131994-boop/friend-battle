export const ROCK_PAPER_SCISSORS_GAME_ID = 'rock-paper-scissors' as const

export const ROCK_PAPER_SCISSORS_RULES = {
  minPlayers: 2,
  maxPlayers: 2,
  winsToFinish: 3,
  choiceWindowMs: 3_000,
  revealWindowMs: 4_000,
  resultWindowMs: 4_000,
} as const

export type RockPaperScissorsChoice = 'rock' | 'scissors' | 'paper'
export type RockPaperScissorsPhase = 'choosing' | 'revealing' | 'result'

export interface RockPaperScissorsPlayer {
  userId: string
  displayName: string
  score: number
  joinedAt: string
}

export interface RockPaperScissorsRoundPlayer {
  userId: string
  displayName: string
  choice: RockPaperScissorsChoice | null
}

export interface RockPaperScissorsRound {
  roundNumber: number
  winnerUserId: string | null
  isDraw: boolean
  players: RockPaperScissorsRoundPlayer[]
}

export interface RockPaperScissorsFinalResult {
  userId: string
  displayName: string
  score: number
}

export interface RockPaperScissorsMatch {
  matchId: string
  startedAt: string
  completedAt: string | null
  status: 'playing' | 'completed' | 'cancelled'
  currentRound: number
  phase: RockPaperScissorsPhase
  phaseStartedAt: string
  phaseDeadline: string
  players: RockPaperScissorsPlayer[]
  round: RockPaperScissorsRound | null
  winnerUserId: string | null
  finalResults: RockPaperScissorsFinalResult[] | null
}

export interface RockPaperScissorsSnapshot {
  room: import('../../multiplayer').MultiplayerRoom
  match: RockPaperScissorsMatch | null
  advanced?: boolean
}

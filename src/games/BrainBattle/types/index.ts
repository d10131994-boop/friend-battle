
export type BrainBattleMode = 'solo' | 'multiplayer'

export type BrainBattleCategory =
  | 'logic'
  | 'math'
  | 'attention'
  | 'general'

export type BrainBattleQuestion = {
  id: number
  category: BrainBattleCategory
  question: string
  answers: string[]
  correctAnswer: number
  explanation?: string
}

export type BrainBattleGameState =
  | 'idle'
  | 'playing'
  | 'answering'
  | 'finished'

export type BrainBattleResult = {
  totalQuestions: number
  correctAnswers: number
  incorrectAnswers: number
  skippedQuestions: number
  totalScore: number
}

export type BrainBattleRoomStatus = 'waiting' | 'playing' | 'finished'

export type BrainBattleServerQuestion = {
  id: number
  category: BrainBattleCategory
  question: string
  answers: string[]
}

export type BrainBattlePlayer = {
  telegram_id: string
  player_name: string
  is_ready: boolean
  correct_answers: number
  incorrect_answers: number
  skipped_questions: number
  total_score: number
}

export type BrainBattleRoom = {
  id: string
  invite_code: string
  status: BrainBattleRoomStatus
  current_question_index: number
  started_at: string | null
  question_started_at: string | null
  question_ends_at: string | null
  winner_telegram_id: string | null
}

export type BrainBattleRoomResponse = {
  success: boolean
  room: BrainBattleRoom
  players: BrainBattlePlayer[]
  currentQuestion: BrainBattleServerQuestion | null
}

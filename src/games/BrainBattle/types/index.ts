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

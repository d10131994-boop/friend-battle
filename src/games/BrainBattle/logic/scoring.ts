const BASE_SCORE = 100
const MAX_SPEED_BONUS = 50
const QUESTION_TIME = 15

export function calculateQuestionScore(
  isCorrect: boolean,
  remainingTime: number,
): number {
  if (!isCorrect) return 0

  const speedBonus = Math.round(
    (Math.max(0, remainingTime) / QUESTION_TIME) *
      MAX_SPEED_BONUS,
  )

  return BASE_SCORE + speedBonus
}

export function calculateFinalScore(
  questionScores: number[],
): number {
  return questionScores.reduce(
    (total, score) => total + score,
    0,
  )
}
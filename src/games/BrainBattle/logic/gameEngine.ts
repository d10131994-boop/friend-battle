import type {
  BrainBattleQuestion,
  BrainBattleResult,
} from '../types'

import { calculateQuestionScore } from './scoring'

export function checkAnswer(
  question: BrainBattleQuestion,
  selectedAnswer: number,
): boolean {
  return selectedAnswer === question.correctAnswer
}

export function calculateGameResult(
  questions: BrainBattleQuestion[],
  answers: (number | null)[],
  remainingTimes: number[],
): BrainBattleResult {
  let correctAnswers = 0
  let incorrectAnswers = 0
  let skippedQuestions = 0

  const questionScores = questions.map((question, index) => {
    const answer = answers[index]

    if (answer === null || answer === undefined) {
      skippedQuestions++
      return 0
    }

    const isCorrect = checkAnswer(question, answer)

    if (!isCorrect) {
      incorrectAnswers++
      return 0
    }

    correctAnswers++

    return calculateQuestionScore(
      true,
      remainingTimes[index] ?? 0,
    )
  })

  return {
    totalQuestions: questions.length,
    correctAnswers,
    incorrectAnswers,
    skippedQuestions,
    totalScore: questionScores.reduce(
      (total, score) => total + score,
      0,
    ),
  }
}
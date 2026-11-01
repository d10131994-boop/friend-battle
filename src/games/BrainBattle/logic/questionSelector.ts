import type {
  BrainBattleCategory,
  BrainBattleQuestion,
} from '../types'

import { brainBattleQuestions } from '../data/questions'

export function selectQuestions(
  count: number = 10,
  category?: BrainBattleCategory,
): BrainBattleQuestion[] {
  const availableQuestions = category
    ? brainBattleQuestions.filter(
        (question) => question.category === category,
      )
    : brainBattleQuestions

  const shuffledQuestions = [...availableQuestions].sort(
    () => Math.random() - 0.5,
  )

  return shuffledQuestions.slice(
    0,
    Math.min(count, shuffledQuestions.length),
  )
}

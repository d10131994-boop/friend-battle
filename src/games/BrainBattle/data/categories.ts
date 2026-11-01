import type { BrainBattleCategory } from '../types'

export type BrainBattleCategoryInfo = {
  id: BrainBattleCategory
  title: string
  description: string
  icon: string
}

export const brainBattleCategories: BrainBattleCategoryInfo[] = [
  {
    id: 'logic',
    title: 'ЛОГИКА',
    description: 'Задачи на мышление и закономерности',
    icon: '🧩',
  },
  {
    id: 'math',
    title: 'МАТЕМАТИКА',
    description: 'Числа, вычисления и задачи',
    icon: '🔢',
  },
  {
    id: 'attention',
    title: 'ВНИМАТЕЛЬНОСТЬ',
    description: 'Проверь свою наблюдательность',
    icon: '👁️',
  },
  {
    id: 'general',
    title: 'ОБЩИЕ ЗНАНИЯ',
    description: 'Интересные факты и эрудиция',
    icon: '🌍',
  },
]

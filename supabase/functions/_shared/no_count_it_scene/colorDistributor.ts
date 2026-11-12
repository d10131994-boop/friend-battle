import type { NoCountItCandyColor } from './types.ts'

const COLORS: readonly NoCountItCandyColor[] = [
  'red', 'orange', 'yellow', 'green', 'blue',
  'purple', 'pink', 'teal', 'brown',
]

export interface ColorDistribution {
  colors: NoCountItCandyColor[]
  targetColor: NoCountItCandyColor
}

export function distributeCandyColors(
  count: number,
  random: () => number,
  minColors = 4,
  maxColors = 9,
  minPerColor = 3,
): ColorDistribution {
  if (!Number.isInteger(count) || count < minColors * minPerColor) {
    throw new Error('Candy count is too small for the requested color distribution.')
  }
  const colorCount = randomInteger(random, minColors, Math.min(maxColors, COLORS.length))
  const selected = shuffle([...COLORS], random).slice(0, colorCount)
  const colors: NoCountItCandyColor[] = []
  for (const color of selected) {
    for (let index = 0; index < minPerColor; index += 1) colors.push(color)
  }
  while (colors.length < count) colors.push(selected[randomInteger(random, 0, selected.length - 1)])
  return {
    colors: shuffle(colors, random),
    targetColor: selected[randomInteger(random, 0, selected.length - 1)],
  }
}

export function randomInteger(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(random, 0, index)
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

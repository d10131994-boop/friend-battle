import type { NoCountItCandyColor, NoCountItPaletteColor, NoCountItScene } from '../types'
import { CANDY_GENERATION_CONFIG } from '../generationConfig'
import { distributeCandyColors, randomInteger } from './colorDistributor'
import { placeCandies } from './placementEngine'

export interface SceneGenerationOptions {
  seed?: string
  minCandies?: number
  maxCandies?: number
  minColors?: number
  maxColors?: number
}

function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 0x6d2b79f5
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function generateCandyJarScene(options: SceneGenerationOptions = {}): NoCountItScene {
  const seed = options.seed ?? createRuntimeSeed()
  const random = createSeededRandom(seed)
  const minCandies = options.minCandies ?? CANDY_GENERATION_CONFIG.minCandyCount
  const maxCandies = options.maxCandies ?? CANDY_GENERATION_CONFIG.maxCandyCount
  if (
    !Number.isInteger(minCandies) || !Number.isInteger(maxCandies) ||
    minCandies < CANDY_GENERATION_CONFIG.minCandyCount ||
    maxCandies > CANDY_GENERATION_CONFIG.maxCandyCount ||
    minCandies > maxCandies
  ) {
    throw new Error(
      `Candy count bounds must be integers within the agreed ${CANDY_GENERATION_CONFIG.minCandyCount}–${CANDY_GENERATION_CONFIG.maxCandyCount} range.`,
    )
  }

  const count = randomInteger(random, minCandies, maxCandies)
  const distribution = distributeCandyColors(count, random, options.minColors ?? 4, options.maxColors ?? 10)
  const objects = placeCandies(distribution.colors, random)
  const backgroundColors: NoCountItPaletteColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'teal', 'white', 'brown']
  const availableBackgroundColors = backgroundColors.filter((color) => !distribution.colors.includes(color as NoCountItCandyColor))
  const backgroundColor = availableBackgroundColors[randomInteger(random, 0, availableBackgroundColors.length - 1)]
  return {
    version: 1,
    seed,
    generator: 'candy-jar',
    objects,
    backgroundColor,
    targetColor: distribution.targetColor,
    correctCount: objects.filter((object) => object.color === distribution.targetColor).length,
  }
}

function createRuntimeSeed(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

import type { NoCountItCandyColor, NoCountItSceneObject } from '../types'
import { randomInteger } from './colorDistributor'

const MAX_ATTEMPTS_PER_OBJECT = 700

interface PlacementCandidate extends NoCountItSceneObject {
  radius: number
}

function jarHalfWidth(y: number): number {
  if (y < 145 || y > 930) return 0
  if (y < 245) return 250 + ((y - 145) / 100) * 55
  if (y < 790) return 305
  return 305 - ((y - 790) / 140) * 45
}

function isInsideJar(x: number, y: number, radius: number): boolean {
  const edgeInset = Math.max(0, radius - 4)
  const leftRight = Math.abs(x - 500) + edgeInset
  return Boolean(
    jarHalfWidth(y) &&
    leftRight <= jarHalfWidth(y) &&
    leftRight <= jarHalfWidth(y - edgeInset) &&
    leftRight <= jarHalfWidth(y + edgeInset)
  )
}

function hasAcceptableOverlap(candidate: PlacementCandidate, placed: PlacementCandidate[]): boolean {
  return placed.every((other) => {
    const distance = Math.hypot(candidate.x - other.x, candidate.y - other.y)
    return distance >= (candidate.radius + other.radius) * 0.76
  })
}

export function placeCandies(colors: NoCountItCandyColor[], random: () => number): NoCountItSceneObject[] {
  const placed: PlacementCandidate[] = []
  for (let index = 0; index < colors.length; index += 1) {
    let accepted: PlacementCandidate | null = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_OBJECT; attempt += 1) {
      const radius = randomInteger(random, 23, 33)
      const y = randomInteger(random, 190, 875)
      const halfWidth = jarHalfWidth(y) - radius - 8
      if (halfWidth <= 0) continue
      const x = randomInteger(random, 500 - halfWidth, 500 + halfWidth)
      const candidate: PlacementCandidate = {
        id: index + 1,
        x, y,
        rotation: randomInteger(random, -180, 180),
        scale: radius / 28,
        color: colors[index],
        shape: (['round', 'oval', 'wrapped'] as const)[randomInteger(random, 0, 2)],
        radius,
      }
      if (!isInsideJar(x, y, radius) || !hasAcceptableOverlap(candidate, placed)) continue
      accepted = candidate
      break
    }
    if (!accepted) throw new Error(`Could not place candy ${index + 1} within scene constraints.`)
    placed.push(accepted)
  }
  return placed.map(({ radius: _radius, ...object }) => object)
}

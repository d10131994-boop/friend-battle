import type { NoCountItCandyColor, NoCountItSceneObject } from '../types'
import { randomInteger } from './colorDistributor'

const JAR_BOTTOM = 875
const MIN_OVERLAP = 0.1
const MAX_OVERLAP = 0.6
const MAX_EDGE_OCCLUSION = 0.3

interface PlacedCandy extends NoCountItSceneObject {
  radius: number
}

interface Position {
  x: number
  y: number
  edge: boolean
}

function jarHalfWidth(y: number): number {
  if (y < 145 || y > 930) return 0
  if (y < 245) return 250 + ((y - 145) / 100) * 55
  if (y < 790) return 305
  return 305 - ((y - 790) / 140) * 45
}

function circleIntersectionArea(radiusA: number, radiusB: number, distance: number): number {
  if (distance >= radiusA + radiusB) return 0
  if (distance <= Math.abs(radiusA - radiusB)) {
    return Math.PI * Math.min(radiusA, radiusB) ** 2
  }
  const a = Math.acos((distance ** 2 + radiusA ** 2 - radiusB ** 2) / (2 * distance * radiusA))
  const b = Math.acos((distance ** 2 + radiusB ** 2 - radiusA ** 2) / (2 * distance * radiusB))
  const triangle = 0.5 * Math.sqrt(
    (-distance + radiusA + radiusB) *
    (distance + radiusA - radiusB) *
    (distance - radiusA + radiusB) *
    (distance + radiusA + radiusB),
  )
  return radiusA ** 2 * a + radiusB ** 2 * b - triangle
}

function isInsideJar(position: Position, radius: number): boolean {
  const halfWidth = jarHalfWidth(position.y)
  if (!halfWidth || Math.abs(position.x - 500) + radius > halfWidth - 2) return false
  return position.y + radius <= 920 && position.y - radius >= 145
}

function overlapStats(candidate: Position, radius: number, placed: PlacedCandy[]) {
  const candidateArea = Math.PI * radius ** 2
  let coveredArea = 0
  let maxExistingOcclusion = 0
  let contacts = 0

  for (const other of placed) {
    const distance = Math.hypot(candidate.x - other.x, candidate.y - other.y)
    const intersection = circleIntersectionArea(radius, other.radius, distance)
    if (intersection <= 0) continue
    contacts += 1
    coveredArea += intersection
    maxExistingOcclusion = Math.max(
      maxExistingOcclusion,
      intersection / (Math.PI * other.radius ** 2),
    )
  }

  return {
    contacts,
    overlapRatio: Math.min(1, coveredArea / candidateArea),
    maxExistingOcclusion,
  }
}

function buildLayerPositions(y: number, radius: number, row: number): Position[] {
  const halfWidth = jarHalfWidth(y) - radius - 3
  if (halfWidth <= 0) return []
  const step = radius * 1.6
  const offset = row % 2 === 0 ? 0 : step / 2
  const positions: Position[] = []
  const minX = 500 - halfWidth
  const maxX = 500 + halfWidth

  for (let x = minX + offset; x <= maxX; x += step) {
    positions.push({ x, y, edge: Math.abs(Math.abs(x - 500) - halfWidth) <= step * 0.6 })
  }

  // Include exact wall-adjacent positions and try them before interior positions.
  positions.push({ x: minX, y, edge: true }, { x: maxX, y, edge: true })
  return positions.sort((a, b) => Number(b.edge) - Number(a.edge))
}

function buildCandidates(radius: number): Position[] {
  const positions: Position[] = []
  const verticalStep = radius * 1.2
  let row = 0
  for (let y = JAR_BOTTOM - radius; y >= 205 + radius; y -= verticalStep) {
    positions.push(...buildLayerPositions(y, radius, row))
    row += 1
  }
  return positions
}

function tryPlacement(
  colors: NoCountItCandyColor[],
  radius: number,
): PlacedCandy[] | null {
  const placed: PlacedCandy[] = []
  const positions = buildCandidates(radius)
  const available = [...positions]

  for (let index = 0; index < colors.length; index += 1) {
    let bestIndex = -1
    let bestScore = Number.NEGATIVE_INFINITY

    for (let positionIndex = 0; positionIndex < available.length; positionIndex += 1) {
      const position = available[positionIndex]
      if (!isInsideJar(position, radius)) continue
      const overlap = overlapStats(position, radius, placed)
      if (overlap.contacts === 0) {
        // The first candy rests on the jar floor; subsequent candies must overlap.
        if (placed.length > 0) continue
      } else {
        const minimum = position.edge ? 0.05 : MIN_OVERLAP
        if (overlap.overlapRatio < minimum || overlap.overlapRatio > MAX_OVERLAP) continue
        if (position.edge && overlap.maxExistingOcclusion > MAX_EDGE_OCCLUSION) continue
      }

      // Prefer wall positions first, then dense but not excessive overlap.
      const score =
        (position.edge ? 100 : 0) +
        overlap.overlapRatio * 20 -
        Math.abs(position.y - (JAR_BOTTOM - radius - Math.floor(index / 8) * radius * 1.2)) * 0.01
      if (score > bestScore) {
        bestScore = score
        bestIndex = positionIndex
      }
    }

    if (bestIndex < 0) return null
    const [position] = available.splice(bestIndex, 1)
    placed.push({
      id: index + 1,
      x: Math.round(position.x),
      y: Math.round(position.y),
      rotation: 0,
      scale: radius / 29,
      color: colors[index],
      shape: 'round',
      radius,
    })
  }

  return placed
}

/**
 * Packs candies bottom-up in staggered layers. Wall-adjacent positions are
 * evaluated first, but only accepted when they do not hide an existing candy
 * by more than 30%. Pairwise circle intersections approximate visible overlap.
 */
export function placeCandies(colors: NoCountItCandyColor[], random: () => number): NoCountItSceneObject[] {
  if (colors.length === 0) return []

  const estimatedJarArea = 430_000
  const targetCoverage = 0.48
  const calculatedRadius = Math.sqrt((estimatedJarArea * targetCoverage) / (colors.length * Math.PI))
  const baseRadius = Math.max(20, Math.min(30, calculatedRadius))

  let placed: PlacedCandy[] | null = null
  for (const scale of [1, 0.96, 0.92, 0.88]) {
    placed = tryPlacement(colors, baseRadius * scale)
    if (placed) break
  }

  if (!placed) {
    throw new Error(`Could not pack ${colors.length} candies while preserving visibility and overlap constraints.`)
  }

  return placed.map(({ radius, ...object }) => {
    void radius
    return {
      ...object,
      rotation: randomInteger(random, -180, 180),
      shape: (['round', 'oval', 'wrapped'] as const)[randomInteger(random, 0, 2)],
    }
  })
}

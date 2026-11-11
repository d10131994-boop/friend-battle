/**
 * Tunable parameters for NoCountIt candy scene generation.
 *
 * Keep algorithm implementation details in placementEngine.ts.
 */
export const CANDY_GENERATION_CONFIG = {
  // Allowed number of candies in a generated scene.
  minCandyCount: 40,
  maxCandyCount: 120,

  // Approximate jar area and target total area of all candy circles.
  // targetCoverage is not the exact visible union area after overlaps.
  estimatedJarArea: 500_000,
  targetCoverage: 0.90,

  // Candy geometry.
  minCandyRadius: 20,
  maxCandyRadius: 90,

  // Empty space above the candy pile, as a percentage of jar interior height.
  emptyTopMinPercent: 10,
  emptyTopMaxPercent: 30,

  // Placement overlap constraints.
  minOverlap: 0.1,
  minEdgeOverlap: 0.05,
  maxOverlap: 0.6,
  maxEdgeOcclusion: 0.3,

  // Radius reductions attempted when placement fails at the base radius.
  radiusFallbackScales: [1, 0.96, 0.92, 0.88],
} as const

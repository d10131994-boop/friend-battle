import { generateCandyJarScene } from "../_shared/no_count_it_scene/sceneGenerator.ts";
import { CANDY_PALETTE, renderCandyJarSvg } from "../_shared/no_count_it_scene/svgRenderer.ts";
import { selectNoCountItBackground } from "./backgroundAssets.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function jarHalfWidth(y: number): number {
  if (y < 145 || y > 930) return 0;
  if (y < 245) return 250 + ((y - 145) / 100) * 55;
  if (y < 790) return 305;
  return 305 - ((y - 790) / 140) * 45;
}

function circleIntersectionArea(radiusA: number, radiusB: number, distance: number): number {
  if (distance >= radiusA + radiusB) return 0;
  if (distance <= Math.abs(radiusA - radiusB)) return Math.PI * Math.min(radiusA, radiusB) ** 2;
  const a = Math.acos((distance ** 2 + radiusA ** 2 - radiusB ** 2) / (2 * distance * radiusA));
  const b = Math.acos((distance ** 2 + radiusB ** 2 - radiusA ** 2) / (2 * distance * radiusB));
  const triangle = 0.5 * Math.sqrt(Math.max(0,
    (-distance + radiusA + radiusB) *
    (distance + radiusA - radiusB) *
    (distance - radiusA + radiusB) *
    (distance + radiusA + radiusB),
  ));
  return radiusA ** 2 * a + radiusB ** 2 * b - triangle;
}

function assertSceneInvariants(scene: ReturnType<typeof generateCandyJarScene>, expected: number) {
  assert(scene.objects.length === expected, `Expected ${expected} candies, got ${scene.objects.length}`);
  const counts = new Map<string, number>();
  let previousY = Number.POSITIVE_INFINITY;

  for (let index = 0; index < scene.objects.length; index += 1) {
    const candy = scene.objects[index];
    const radius = 29 * candy.scale;
    const halfWidth = jarHalfWidth(candy.y);
    counts.set(candy.color, (counts.get(candy.color) ?? 0) + 1);
    assert(Number.isInteger(candy.x) && Number.isInteger(candy.y), "Candy coordinates must be integers");
    assert(halfWidth > 0 && Math.abs(candy.x - 500) + radius <= halfWidth - 2 + 0.05, "Candy must stay inside the jar walls");
    assert(candy.y + radius <= 920 + 0.05 && candy.y - radius >= 145 - 0.05, "Candy must stay inside the jar vertically");
    assert(candy.y <= previousY + 0.05, "Candies must be placed in bottom-up layer order");
    previousY = candy.y;
    assert(candy.scale >= 20 / 29 && candy.scale <= 90 / 29, "Candy scale is outside configured bounds");
    assert(candy.color !== "white", "White must not be used for candies");

    const layerHalfWidth = halfWidth - radius - 3;
    const isEdge = Math.abs(Math.abs(candy.x - 500) - layerHalfWidth) <= radius * 1.6 * 0.6 + 0.05;
    let coveredArea = 0;
    for (let previous = 0; previous < index; previous += 1) {
      const other = scene.objects[previous];
      const otherRadius = 29 * other.scale;
      const intersection = circleIntersectionArea(radius, otherRadius, Math.hypot(candy.x - other.x, candy.y - other.y));
      coveredArea += intersection;
      if (isEdge) {
        assert(intersection / (Math.PI * otherRadius ** 2) <= 0.32, "Wall-adjacent candy must not occlude an existing candy by more than 30%");
      }
    }
    if (index > 0) {
      const overlapRatio = Math.min(1, coveredArea / (Math.PI * radius ** 2));
      assert(overlapRatio >= (isEdge ? 0.05 : 0.1) - 0.02, "Candy overlap is below the configured minimum");
      assert(overlapRatio <= 0.62, "Candy overlap exceeds the configured maximum");
    }
  }

  assert(counts.size >= 4 && counts.size <= 9, "Scene must contain 4–9 colors");
  for (const [color, count] of counts) assert(count >= 3, `Color ${color} appears fewer than three times`);
  assert(counts.has(scene.targetColor), "Target color must be present");
  assert(!counts.has(scene.backgroundColor), "Wall color must be distinct from candy colors");
  assert(scene.correctCount === counts.get(scene.targetColor), "Correct count must match target-color candies");
}

Deno.test("NoCountIt generation is deterministic for a fixed seed", () => {
  const a = generateCandyJarScene({ seed: "deterministic-scene-test", minCandies: 80, maxCandies: 80 });
  const b = generateCandyJarScene({ seed: "deterministic-scene-test", minCandies: 80, maxCandies: 80 });
  assert(JSON.stringify(a) === JSON.stringify(b), "Same seed must produce identical scene data");
});

Deno.test("NoCountIt scene invariants hold across the full candy-count range and multiple seeds", () => {
  for (const count of [40, 60, 80, 100, 120]) {
    for (const seed of ["scene-test-a", "scene-test-b", "scene-test-c"]) {
      assertSceneInvariants(generateCandyJarScene({ seed: `${seed}-${count}`, minCandies: count, maxCandies: count }), count);
    }
  }
});

Deno.test("production SVG embeds a deterministic 3:4 background within the bucket limit", () => {
  const scene = generateCandyJarScene({ seed: "scene-svg-background-test", minCandies: 120, maxCandies: 120 });
  const background = selectNoCountItBackground(scene.seed);
  const svg = renderCandyJarSvg(scene, { backgroundImageDataUri: background.dataUri });
  assert(svg.includes('viewBox="0 0 1000 1333"'), "Production scene must use a 3:4 viewBox");
  assert(svg.includes('<image href="data:image/png;base64,'), "Production SVG must embed the background");
  assert(svg.includes(`fill="${CANDY_PALETTE[scene.backgroundColor].base}"`), "Wall color must remain beneath the artwork");
  assert(new TextEncoder().encode(svg).byteLength <= 1_048_576, "SVG must fit the Storage bucket limit");
  assert(selectNoCountItBackground(scene.seed).name === background.name, "Background choice must be deterministic");
});

Deno.test("dev SVG keeps its square viewBox and separate background layer", () => {
  const scene = generateCandyJarScene({ seed: "scene-svg-preview-test", minCandies: 80, maxCandies: 80 });
  const svg = renderCandyJarSvg(scene);
  assert(svg.includes('viewBox="0 0 1000 1000"'), "Dev renderer must preserve square viewBox");
  assert(!svg.includes("<image href="), "Dev background remains a separate layer");
});

import { generateCandyJarScene } from "../_shared/no_count_it_scene/sceneGenerator.ts";
import { CANDY_PALETTE, renderCandyJarSvg } from "../_shared/no_count_it_scene/svgRenderer.ts";
import { selectNoCountItBackground } from "./backgroundAssets.ts";
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function assertSceneInvariants(scene: ReturnType<typeof generateCandyJarScene>, expected: number) {
  assert(scene.objects.length === expected, `Expected ${expected} candies`);
  const counts = new Map<string, number>();
  for (const candy of scene.objects) {
    counts.set(candy.color, (counts.get(candy.color) ?? 0) + 1);
    assert(Number.isInteger(candy.x) && Number.isInteger(candy.y), "Candy coordinates must be integers");
    assert(candy.x >= 175 && candy.x <= 825 && candy.y >= 145 && candy.y <= 920, "Candy is outside the jar bounds");
    assert(candy.scale >= 20 / 29 && candy.scale <= 90 / 29, "Candy scale is outside configured bounds");
    assert(candy.color !== "white", "White must not be used for candies");
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
Deno.test("NoCountIt scene invariants hold across representative counts and seeds", () => {
  for (const count of [40, 80, 120]) for (const seed of ["scene-test-a", "scene-test-b", "scene-test-c", "scene-test-d"]) {
    assertSceneInvariants(generateCandyJarScene({ seed: `${seed}-${count}`, minCandies: count, maxCandies: count }), count);
  }
});
Deno.test("production SVG embeds a deterministic 3:4 background within the bucket limit", () => {
  const scene = generateCandyJarScene({ seed: "scene-svg-background-test", minCandies: 80, maxCandies: 80 });
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

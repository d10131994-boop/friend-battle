import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { selectQuestions } from "./questions.ts";

Deno.test("selects ten distinct questions without reusing the previous match set", () => {
  const previous = selectQuestions();
  const previousIds = previous.map((question) => question.id);
  const next = selectQuestions(previousIds);
  const nextIds = next.map((question) => question.id);

  assertEquals(previous.length, 10);
  assertEquals(new Set(previousIds).size, 10);
  assertEquals(next.length, 10);
  assertEquals(new Set(nextIds).size, 10);
  assertEquals(nextIds.some((id) => previousIds.includes(id)), false);
});

Deno.test("falls back to a fresh shuffled bank when fewer than ten unseen questions remain", () => {
  const allIds = Array.from({ length: 20 }, (_, index) => index + 1);
  const selected = selectQuestions(allIds);
  const ids = selected.map((question) => question.id);

  assertEquals(selected.length, 10);
  assertEquals(new Set(ids).size, 10);
  assertNotEquals(ids.length, 0);
});

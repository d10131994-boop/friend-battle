import { getOpponentName, getRoundOutcome } from "../../../src/games/rockPaperScissors/logic/gameRules.ts"

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`)
  }
}

Deno.test("resolves all winning Rock Paper Scissors combinations", () => {
  assertEqual(getRoundOutcome("rock", "scissors"), "win", "Rock beats scissors")
  assertEqual(getRoundOutcome("scissors", "paper"), "win", "Scissors beat paper")
  assertEqual(getRoundOutcome("paper", "rock"), "win", "Paper beats rock")
  assertEqual(getRoundOutcome("scissors", "rock"), "loss", "Rock beats scissors from the opponent perspective")
})

Deno.test("equal gestures produce a draw", () => {
  for (const choice of ["rock", "scissors", "paper"] as const) {
    assertEqual(getRoundOutcome(choice, choice), "draw", `Equal ${choice} gestures`)
  }
})

Deno.test("computer nickname follows its most frequent gesture", () => {
  assertEqual(getOpponentName(["paper", "rock", "paper"]), "Влад", "Paper nickname")
  assertEqual(getOpponentName(["scissors", "rock", "scissors"]), "Эдвард", "Scissors nickname")
  assertEqual(getOpponentName(["rock", "paper", "rock"]), "Дуэйн", "Rock nickname")
})

Deno.test("tied computer gesture frequencies choose randomly among tied names", () => {
  const tied = ["rock", "paper"] as const
  assertEqual(getOpponentName([...tied], () => 0), "Дуэйн", "First tied nickname")
  assertEqual(getOpponentName([...tied], () => 0.99), "Влад", "Last tied nickname")
})

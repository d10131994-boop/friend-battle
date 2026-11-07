import type { RockPaperScissorsChoice } from '../types'

export type RoundOutcome = 'win' | 'loss' | 'draw'

export function getRoundOutcome(
  playerChoice: RockPaperScissorsChoice,
  opponentChoice: RockPaperScissorsChoice,
): RoundOutcome {
  if (playerChoice === opponentChoice) return 'draw'
  const playerWins =
    (playerChoice === 'rock' && opponentChoice === 'scissors') ||
    (playerChoice === 'scissors' && opponentChoice === 'paper') ||
    (playerChoice === 'paper' && opponentChoice === 'rock')
  return playerWins ? 'win' : 'loss'
}

const OPPONENT_NAMES: Record<RockPaperScissorsChoice, string> = {
  paper: 'Влад',
  scissors: 'Эдвард',
  rock: 'Дуэйн',
}

/** The computer's most frequently used gesture determines its final nickname. */
export function getOpponentName(
  choices: RockPaperScissorsChoice[],
  random: () => number = Math.random,
): string {
  if (!choices.length) return OPPONENT_NAMES.rock
  const counts: Record<RockPaperScissorsChoice, number> = {
    rock: 0,
    scissors: 0,
    paper: 0,
  }
  for (const choice of choices) counts[choice] += 1
  const maximum = Math.max(counts.rock, counts.scissors, counts.paper)
  const leaders = (Object.keys(counts) as RockPaperScissorsChoice[])
    .filter((choice) => counts[choice] === maximum)
  const selected = leaders[Math.min(leaders.length - 1, Math.floor(random() * leaders.length))]
  return OPPONENT_NAMES[selected]
}

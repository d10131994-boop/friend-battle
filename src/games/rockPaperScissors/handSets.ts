import type { RockPaperScissorsChoice } from './types'

type HandSet = Record<RockPaperScissorsChoice, string>
const playerModules = import.meta.glob('./assets/handsPlayer/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const opponentModules = import.meta.glob('./assets/handsOpponent/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

function collectSets(modules: Record<string, string>): Map<number, HandSet> {
  const partial = new Map<number, Partial<HandSet>>()
  for (const [path, url] of Object.entries(modules)) {
    const filename = path.split('/').pop() ?? ''
    const match = /^(rock|papper|scissors)([0-9]+)\.(png|webp|jpg|jpeg)$/i.exec(filename)
    if (!match) continue
    const choice = match[1].toLowerCase() === 'papper' ? 'paper' : match[1].toLowerCase() as RockPaperScissorsChoice
    const number = Number(match[2])
    if (!Number.isSafeInteger(number)) continue
    const set = partial.get(number) ?? {}
    set[choice] = url
    partial.set(number, set)
  }
  const complete = new Map<number, HandSet>()
  for (const [number, set] of partial) {
    if (set.rock && set.paper && set.scissors) complete.set(number, set as HandSet)
  }
  return complete
}

export const handSets = {
  player: collectSets(playerModules),
  opponent: collectSets(opponentModules),
}
export function chooseHandSet(side: 'player' | 'opponent'): number | null {
  const numbers = [...handSets[side].keys()]
  return numbers.length ? numbers[Math.floor(Math.random() * numbers.length)] : null
}


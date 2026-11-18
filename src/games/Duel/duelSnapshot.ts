import { ZONES, type Resolution } from './duelEngine.js'
import type { MatchState } from './duelMatch.js'

export type Snapshot = {
  matchId: string
  exchange: number
  match: MatchState
  status: 'playing' | 'completed'
  yourChoiceSubmitted: boolean
  opponentReady: boolean
  fighter: 0 | 1
  deadline: string
  resolveAfter: string | null
  lastResult: { exchange: number; roundResult: 'continue' | 'left' | 'right' | 'draw'; resolution: Resolution } | null
}

export function parseSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('Некорректное состояние матча')
  const s = value as Record<string, unknown>
  if (typeof s.matchId !== 'string' || !Number.isSafeInteger(s.exchange) || (s.exchange as number) < 1 ||
      (s.fighter !== 0 && s.fighter !== 1) || (s.status !== 'playing' && s.status !== 'completed') ||
      typeof s.yourChoiceSubmitted !== 'boolean' || typeof s.opponentReady !== 'boolean' ||
      typeof s.deadline !== 'string' || !Number.isFinite(Date.parse(s.deadline)) ||
      (s.resolveAfter !== null && (typeof s.resolveAfter !== 'string' || !Number.isFinite(Date.parse(s.resolveAfter)))) ||
      !s.match || typeof s.match !== 'object') throw new Error('Некорректное состояние матча')
  const m = s.match as Record<string, unknown>
  if (!Array.isArray(m.health) || m.health.length !== 2 || !m.health.every(x => Number.isInteger(x) && x >= 0 && x <= 3) ||
      !Array.isArray(m.wins) || m.wins.length !== 2 || !m.wins.every(x => Number.isInteger(x) && x >= 0) ||
      !Number.isSafeInteger(m.round) || typeof m.finished !== 'boolean' ||
      (m.winner !== null && m.winner !== 0 && m.winner !== 1)) throw new Error('Некорректное состояние боя')
  if (s.lastResult != null) {
    if (typeof s.lastResult !== 'object' || Array.isArray(s.lastResult)) throw new Error('Некорректный результат боя')
    const result = s.lastResult as Record<string, unknown>
    const resolution = result.resolution as Record<string, unknown> | null
    if (!Number.isSafeInteger(result.exchange) ||
        !['continue', 'left', 'right', 'draw'].includes(String(result.roundResult)) ||
        !resolution || !Array.isArray(resolution.hits) || !Array.isArray(resolution.clashes) || !Array.isArray(resolution.blocks) ||
        !resolution.hits.every(hit => hit && (hit.source === 0 || hit.source === 1) && (hit.target === 0 || hit.target === 1) && ZONES.includes(hit.zone) && typeof hit.reflected === 'boolean') ||
        !resolution.clashes.every(clash => clash && ZONES.includes(clash.zone)) ||
        !resolution.blocks.every(block => block && (block.attacker === 0 || block.attacker === 1) && (block.defender === 0 || block.defender === 1) && ZONES.includes(block.zone)) ||
        !Array.isArray(resolution.unusedDefenses) ||
        !resolution.unusedDefenses.every(defense => defense && (defense.fighter === 0 || defense.fighter === 1) && ZONES.includes(defense.zone)) ||
        !Array.isArray(resolution.damage) || resolution.damage.length !== 2 ||
        !resolution.damage.every(x => Number.isInteger(x) && x >= 0 && x <= 2) ||
        !Array.isArray(resolution.healthAfter) || resolution.healthAfter.length !== 2 ||
        !resolution.healthAfter.every(x => Number.isInteger(x) && x >= 0 && x <= 3))
      throw new Error('Некорректный результат боя')
  }
  return s as Snapshot
}


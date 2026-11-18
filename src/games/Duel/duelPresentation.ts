import type { Beat, Fighter, Zone } from './duelEngine.js'

export type DuelPose = { kind: 'attacking' | 'defending' | 'hit' | 'fallen' | ''; zone?: Zone }
export type DuelPoses = readonly [DuelPose, DuelPose]

/** Shared visual translation of authoritative combat beats; never computes damage. */
export function posesForBeat(beat: Beat): DuelPoses {
  const next: [DuelPose, DuelPose] = [{ kind: '' }, { kind: '' }]
  if (beat.kind === 'unused-defense') next[beat.fighter] = { kind: 'defending', zone: beat.zone }
  if (beat.kind === 'clash') {
    next[0] = { kind: 'attacking', zone: beat.zone }
    next[1] = { kind: 'attacking', zone: beat.zone }
  }
  if (beat.kind === 'shield-block') {
    next[beat.attacker] = { kind: 'attacking', zone: beat.zone }
    next[beat.defender] = { kind: 'defending', zone: beat.zone }
  }
  if (beat.kind === 'strike') {
    // A fighter may receive and deliver an impact in the same beat.
    // Show damage reaction first so the player never misses a hit.
    for (const hit of beat.hits) next[hit.source] = { kind: 'attacking', zone: hit.zone }
    for (const hit of beat.hits) next[hit.target] = { kind: 'hit', zone: hit.zone }
  }
  if (beat.kind === 'fall') for (const fighter of beat.fighters as Fighter[]) next[fighter] = { kind: 'fallen' }
  return next
}

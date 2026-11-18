import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
const expect = (actual: unknown) => ({
  toBe(expected: unknown) { assert.equal(actual, expected) },
  toEqual(expected: unknown) { assert.deepEqual(actual, expected) },
  toHaveLength(expected: number) { assert.equal((actual as { length: number }).length, expected) },
})
import { ZONES, planDuel, resolveDuel, type Action } from './duelEngine.js'

const allActions: Action[] = ZONES.flatMap(zone => [
  { kind: 'attack' as const, zone },
  { kind: 'defend' as const, zone },
])
const pairs: [Action, Action][] = []
for (let i = 0; i < allActions.length; i++)
  for (let j = i + 1; j < allActions.length; j++)
    pairs.push([allActions[i], allActions[j]])

describe('duel engine', () => {
  it('has 28 distinct selections and 7056 selection/HP combinations', () => {
    expect(pairs).toHaveLength(28)
    expect(pairs.length * pairs.length * 9).toBe(7056)
  })
  it('reflects an attack unless the attacker protects the same zone', () => {
    const a = resolveDuel(
      [{ kind: 'attack', zone: 'head' }, { kind: 'defend', zone: 'belly' }],
      [{ kind: 'defend', zone: 'head' }, { kind: 'defend', zone: 'legs' }],
      [3, 3],
    )
    expect(a.damage).toEqual([1, 0])
    const b = resolveDuel(
      [{ kind: 'attack', zone: 'head' }, { kind: 'defend', zone: 'head' }],
      [{ kind: 'defend', zone: 'head' }, { kind: 'defend', zone: 'legs' }],
      [3, 3],
    )
    expect(b.damage).toEqual([0, 0])
  })
  it('cancels matching sword attacks', () => {
    const r = resolveDuel(
      [{ kind: 'attack', zone: 'head' }, { kind: 'defend', zone: 'legs' }],
      [{ kind: 'attack', zone: 'head' }, { kind: 'defend', zone: 'belly' }],
      [3, 3],
    )
    expect(r.damage).toEqual([0, 0])
    expect(r.clashes.map(x => x.zone)).toEqual(['head'])
  })
  it('handles the specified simultaneous fatal counterattack', () => {
    const r = resolveDuel(
      [{ kind: 'defend', zone: 'head' }, { kind: 'defend', zone: 'chest' }],
      [{ kind: 'attack', zone: 'chest' }, { kind: 'attack', zone: 'belly' }],
      [1, 1],
    )
    expect(r.outcome).toBe('draw')
    const plan = planDuel(r, [1, 1])
    expect(plan.synchronizedFatalHits).toBe(true)
    expect(plan.beats.filter(x => x.kind === 'strike')).toHaveLength(1)
    expect(plan.beats.at(-1)).toEqual({ kind: 'fall', fighters: [0, 1] })
  })
  it('exhaustively checks combat invariants and presentation damage', () => {
    for (const a of pairs) for (const b of pairs)
      for (let hpA = 1; hpA <= 3; hpA++) for (let hpB = 1; hpB <= 3; hpB++) {
        const r = resolveDuel(a, b, [hpA, hpB])
        const reverse = resolveDuel(b, a, [hpB, hpA])
        expect(r.damage).toEqual([reverse.damage[1], reverse.damage[0]])
        expect(r.damage).toEqual([
          r.hits.filter(h => h.target === 0).length,
          r.hits.filter(h => h.target === 1).length,
        ])
        expect(r.healthAfter).toEqual([
          Math.max(0, hpA - r.damage[0]),
          Math.max(0, hpB - r.damage[1]),
        ])
        const plan = planDuel(r, [hpA, hpB])
        const strikes = plan.beats.flatMap(beat => beat.kind === 'strike' ? beat.hits : [])
        expect(strikes).toHaveLength(r.hits.length)
        expect(new Set(strikes).size).toBe(r.hits.length)
        // Every shield impact must precede the reflected strike it causes.
        for (const hit of strikes.filter(h => h.reflected)) {
          const blockIndex = plan.beats.findIndex(beat =>
            beat.kind === 'shield-block' && beat.defender === hit.source &&
            beat.attacker === hit.target && beat.zone === hit.zone)
          const strikeIndex = plan.beats.findIndex(beat =>
            beat.kind === 'strike' && beat.hits.includes(hit))
          expect(blockIndex >= 0 && blockIndex < strikeIndex).toBe(true)
        }
        // No fighter loses their last HP before the final strike beat.
        const strikeBeats = plan.beats.filter(beat => beat.kind === 'strike')
        const hpShown = [hpA, hpB]
        for (let i = 0; i < strikeBeats.length; i++) {
          const beat = strikeBeats[i]
          if (beat.kind !== 'strike') continue
          for (const hit of beat.hits) hpShown[hit.target]--
          if (i < strikeBeats.length - 1) {
            expect(hpShown[0] > 0 && hpShown[1] > 0).toBe(true)
          }
        }
        const falls = plan.beats.filter(beat => beat.kind === 'fall')
        expect(falls).toHaveLength(r.outcome === 'continue' ? 0 : 1)
      }
  })
})

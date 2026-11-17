/** Pure, mode-independent duel rules. No client authority is implied for multiplayer. */
export const ZONES = ['head', 'chest', 'belly', 'legs'] as const
export type Zone = typeof ZONES[number]
export type Action = { kind: 'attack' | 'defend'; zone: Zone }
export type Selection = readonly [Action, Action]
export type Fighter = 0 | 1
export type Hit = { source: Fighter; target: Fighter; zone: Zone; reflected: boolean }
export type Clash = { zone: Zone }
export type Block = { defender: Fighter; attacker: Fighter; zone: Zone; reflected: boolean }
export type Resolution = {
  hits: Hit[]
  clashes: Clash[]
  blocks: Block[]
  unusedDefenses: { fighter: Fighter; zone: Zone }[]
  damage: readonly [number, number]
  healthAfter: readonly [number, number]
  outcome: 'continue' | 'left' | 'right' | 'draw'
}
export function validateSelection(actions: readonly Action[]): asserts actions is Selection {
  if (actions.length !== 2) throw new Error('Exactly two actions required')
  const keys = new Set<string>()
  for (const a of actions) {
    if (!['attack', 'defend'].includes(a.kind) || !ZONES.includes(a.zone)) throw new Error('Invalid action')
    const key = a.kind + ':' + a.zone
    if (keys.has(key)) throw new Error('Duplicate action')
    keys.add(key)
  }
}
export function resolveDuel(left: readonly Action[], right: readonly Action[], health: readonly [number, number]): Resolution {
  validateSelection(left)
  validateSelection(right)
  if (health.some(h => !Number.isInteger(h) || h < 1 || h > 3)) throw new Error('Invalid health')
  const actions = [left, right] as const
  const hits: Hit[] = []
  const clashes: Clash[] = []
  const blocks: Block[] = []
  const unusedDefenses: { fighter: Fighter; zone: Zone }[] = []
  for (const zone of ZONES) {
    const attacks = [left, right].map(a => a.some(x => x.kind === 'attack' && x.zone === zone))
    const defenses = [left, right].map(a => a.some(x => x.kind === 'defend' && x.zone === zone))
    if (attacks[0] && attacks[1]) {
      clashes.push({ zone })
    } else {
      for (const attacker of [0, 1] as const) {
        if (!attacks[attacker]) continue
        const defender = (1 - attacker) as Fighter
        if (defenses[defender]) {
          const reflected = !defenses[attacker]
          blocks.push({ defender, attacker, zone, reflected })
          if (reflected) hits.push({ source: defender, target: attacker, zone, reflected: true })
        } else {
          hits.push({ source: attacker, target: defender, zone, reflected: false })
        }
      }
    }
    for (const fighter of [0, 1] as const) {
      if (defenses[fighter] && !attacks[(1 - fighter) as Fighter]) unusedDefenses.push({ fighter, zone })
    }
  }
  const damage: [number, number] = [0, 0]
  for (const hit of hits) damage[hit.target]++
  const healthAfter: [number, number] = [Math.max(0, health[0] - damage[0]), Math.max(0, health[1] - damage[1])]
  const outcome = healthAfter[0] === 0 && healthAfter[1] === 0 ? 'draw' : healthAfter[0] === 0 ? 'right' : healthAfter[1] === 0 ? 'left' : 'continue'
  return { hits, clashes, blocks, unusedDefenses, damage, healthAfter, outcome }
}

/** Presentation events are distinct from simultaneous rule resolution. */
export type Beat =
  | { kind: 'unused-defense'; fighter: Fighter; zone: Zone }
  | { kind: 'clash'; zone: Zone }
  | { kind: 'shield-block'; defender: Fighter; attacker: Fighter; zone: Zone }
  | { kind: 'strike'; hits: Hit[] }
  | { kind: 'fall'; fighters: Fighter[] }

export type Plan = { beats: Beat[]; synchronizedFatalHits: boolean; needsChoreographyReview: boolean }

/**
 * A shield block is a prerequisite for its reflected strike.
 * Every strike beat contains at most one hit per target. Fatal strikes are
 * scheduled last when feasible, so a fallen fighter never attacks afterward.
 * A synchronized lethal beat is preferred for mutual death.
 */
export function planDuel(result: Resolution, health: readonly [number, number]): Plan {
  const beats: Beat[] = result.unusedDefenses.map(x => ({ kind: 'unused-defense', ...x }))
  beats.push(...result.clashes.map(x => ({ kind: 'clash' as const, zone: x.zone })))
  beats.push(...result.blocks.map(x => ({ kind: 'shield-block' as const, ...x })))
  const pending = [...result.hits]
  const lethal = result.healthAfter.map(h => h === 0)
  const finalHits: Hit[] = []
  for (const fighter of [0, 1] as const) {
    if (!lethal[fighter]) continue
    const candidates = pending.filter(h => h.target === fighter)
    if (!candidates.length) continue
    const chosen = candidates[candidates.length - 1]
    finalHits.push(chosen)
    pending.splice(pending.indexOf(chosen), 1)
  }
  // Hits preceding the final one must not already exhaust a fighter's HP.
  const displayedDamage: [number, number] = [0, 0]
  for (const hit of pending) {
    displayedDamage[hit.target]++
    beats.push({ kind: 'strike', hits: [hit] })
  }
  const synchronizedFatalHits = lethal[0] && lethal[1] && finalHits.length === 2
  if (finalHits.length) beats.push({ kind: 'strike', hits: finalHits })
  const fallen = ([0, 1] as const).filter(i => lethal[i])
  if (fallen.length) beats.push({ kind: 'fall', fighters: [...fallen] })
  const needsChoreographyReview = pending.some(h => displayedDamage[h.target] >= health[h.target]) ||
    (synchronizedFatalHits && finalHits.some(h => h.reflected) && result.blocks.length > 1)
  return { beats, synchronizedFatalHits, needsChoreographyReview }
}

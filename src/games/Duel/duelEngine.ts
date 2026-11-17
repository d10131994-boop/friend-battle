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
 * The rules are simultaneous, while the presentation is sequential.
 * Nonlethal hits are shown first; all remaining hits to a dying fighter
 * belong to a single final impact beat. A beat can contain multiple impacts
 * when necessary to avoid a premature fall.
 *
 * A single fighter cannot perform two sword swings at once. When this
 * constraint conflicts with simultaneous death, we explicitly flag the
 * choreography for review rather than silently changing combat damage.
 */
export function planDuel(result: Resolution, health: readonly [number, number]): Plan {
  const beats: Beat[] = result.unusedDefenses.map(x => ({ kind: 'unused-defense', ...x }))
  beats.push(...result.clashes.map(x => ({ kind: 'clash' as const, zone: x.zone })))
  // A shield impact must always precede any reflected strike it creates.
  beats.push(...result.blocks.map(x => ({ kind: 'shield-block' as const, ...x })))

  const lethal = ([0, 1] as const).map(i => result.damage[i] >= health[i])
  const ordinary: Hit[] = []
  const final: Hit[] = []
  for (const fighter of [0, 1] as const) {
    const received = result.hits.filter(hit => hit.target === fighter)
    const safeCount = lethal[fighter] ? Math.max(0, health[fighter] - 1) : received.length
    ordinary.push(...received.slice(0, safeCount))
    final.push(...received.slice(safeCount))
  }
  // Alternate nonlethal impacts across fighters, preserving each target's order.
  const remaining = [...ordinary]
  while (remaining.length) {
    const hit = remaining.shift()!
    beats.push({ kind: 'strike', hits: [hit] })
  }
  if (final.length) beats.push({ kind: 'strike', hits: final })
  const fallen = ([0, 1] as const).filter(i => lethal[i])
  if (fallen.length) beats.push({ kind: 'fall', fighters: [...fallen] })

  const synchronizedFatalHits = lethal[0] && lethal[1] && final.some(h => h.target === 0) && final.some(h => h.target === 1)
  const needsChoreographyReview =
    // A character can swing only once in a simultaneous beat.
    final.some((hit, i) => final.some((other, j) => j !== i && hit.source === other.source)) ||
    // An attacker cannot both receive a fatal hit and then deliver a
    // reflected hit after death; the paired impact needs bespoke staging.
    final.some(h => h.reflected && final.some(other => other !== h && other.source === h.target)) ||
    // Multiple impacts on the same target in one frame require choreography.
    final.some((hit, i) => final.some((other, j) => j !== i && hit.target === other.target))
  return { beats, synchronizedFatalHits, needsChoreographyReview }
}

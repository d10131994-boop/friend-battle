import { test } from 'node:test'
import assert from 'node:assert/strict'
import { choiceRemainingSeconds, lockChoice, randomChoice, toggleChoice, type ChoiceState } from './duelChoice.js'
import type { Action } from './duelEngine.js'

const attack: Action = { kind: 'attack', zone: 'head' }
const defense: Action = { kind: 'defend', zone: 'head' }
const third: Action = { kind: 'attack', zone: 'legs' }

test('two distinct actions; attack and defense of same zone are valid', () => {
  let state: ChoiceState = { selected: [], locked: false }
  state = toggleChoice(state, attack)
  state = toggleChoice(state, defense)
  assert.deepEqual(state.selected, [attack, defense])
  assert.deepEqual(toggleChoice(state, third).selected, [attack, defense])
  state = lockChoice(state)
  assert.equal(state.locked, true)
  assert.deepEqual(toggleChoice(state, attack), state)
})

test('selection toggles off and cannot lock incomplete selection', () => {
  const state = toggleChoice({ selected: [attack], locked: false }, attack)
  assert.deepEqual(state.selected, [])
  assert.equal(lockChoice(state), state)
})

test('random opponent actions are distinct across fixed boundary samples', () => {
  for (const x of [0, 0.1, 0.5, 0.99, 1, -1]) {
    const actions = randomChoice(() => x)
    assert.equal(actions.length, 2)
    assert.notDeepEqual(actions[0], actions[1])
  }
})

test('choice timer counts down from 15 and never becomes negative', () => {
  assert.equal(choiceRemainingSeconds(1000, 1000), 15)
  assert.equal(choiceRemainingSeconds(1000, 2000), 14)
  assert.equal(choiceRemainingSeconds(1000, 16000), 0)
  assert.equal(choiceRemainingSeconds(1000, 99999), 0)
})

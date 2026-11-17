import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDuelMatch, newDuelMatch } from './duelMatch.js'
import type { Action } from './duelEngine.js'

const attack = (zone: Action['zone']): Action => ({ kind: 'attack', zone })
const defend = (zone: Action['zone']): Action => ({ kind: 'defend', zone })
const winning = [attack('head'), attack('chest')]
const idle = [defend('belly'), defend('legs')]

test('round continues while both survive', () => {
  const step = advanceDuelMatch(newDuelMatch(), winning, idle)
  assert.equal(step.roundEnded, false)
  assert.deepEqual(step.match.health, [3, 1])
  assert.equal(step.match.round, 1)
})

test('two decisive rounds win the match; later actions rejected', () => {
  let state = newDuelMatch()
  for (let i = 0; i < 2; i++) {
    state = advanceDuelMatch(state, winning, idle).match
    const step = advanceDuelMatch(state, winning, idle)
    state = step.match
    assert.equal(step.roundResult, 'left')
  }
  assert.equal(state.finished, true)
  assert.equal(state.winner, 0)
  assert.deepEqual(state.wins, [2, 0])
  assert.throws(() => advanceDuelMatch(state, winning, idle))
})

test('simultaneous knockout replays round without awarding a win', () => {
  const state = { ...newDuelMatch(), health: [1, 1] as const }
  const step = advanceDuelMatch(state, [attack('head'), defend('legs')], [attack('chest'), defend('belly')])
  assert.equal(step.roundResult, 'draw')
  assert.equal(step.match.round, 1)
  assert.deepEqual(step.match.wins, [0, 0])
  assert.deepEqual(step.match.health, [3, 3])
})

test('right fighter can win two rounds', () => {
  let state = newDuelMatch()
  for (let i = 0; i < 2; i++) {
    state = advanceDuelMatch(state, idle, winning).match
    state = advanceDuelMatch(state, idle, winning).match
  }
  assert.equal(state.finished, true)
  assert.equal(state.winner, 1)
  assert.deepEqual(state.wins, [0, 2])
})

test('draw at one win each does not decide the match', () => {
  const state = { ...newDuelMatch(), wins: [1, 1] as const, round: 3, health: [1, 1] as const }
  const step = advanceDuelMatch(state, [attack('head'), defend('legs')], [attack('chest'), defend('belly')])
  assert.equal(step.match.finished, false)
  assert.equal(step.match.round, 3)
  assert.deepEqual(step.match.wins, [1, 1])
  assert.deepEqual(step.match.health, [3, 3])
})

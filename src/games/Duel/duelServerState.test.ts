import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newDuelServerState, submitDuelServerChoice } from './duelServerState.js'

const attack = [{ kind: 'attack', zone: 'head' }, { kind: 'attack', zone: 'chest' }]
const defense = [{ kind: 'defend', zone: 'head' }, { kind: 'defend', zone: 'chest' }]

test('server waits for both players without resolving or revealing opponent choice', () => {
  const first = submitDuelServerChoice(newDuelServerState(), 0, 1, attack)
  assert.equal(first.status, 'waiting')
  assert.equal(first.state.match.exchanges, 0)
  assert.equal(first.state.pending[1], null)
})
test('server resolves exactly once and advances exchange identity', () => {
  const first = submitDuelServerChoice(newDuelServerState(), 0, 1, attack)
  const second = submitDuelServerChoice(first.state, 1, 1, defense)
  assert.equal(second.status, 'resolved')
  assert.equal(second.state.exchange, 2)
  assert.equal(second.state.match.exchanges, 1)
  assert.deepEqual(second.state.pending, [null, null])
  assert.throws(() => submitDuelServerChoice(second.state, 0, 1, attack), /Stale/)
})
test('duplicate submission is rejected', () => {
  const first = submitDuelServerChoice(newDuelServerState(), 0, 1, attack)
  assert.throws(() => submitDuelServerChoice(first.state, 0, 1, defense), /already submitted/)
})
test('invalid action does not consume a player turn', () => {
  assert.throws(() => submitDuelServerChoice(newDuelServerState(), 0, 1, [{ kind: 'attack', zone: 'head' }]))
})

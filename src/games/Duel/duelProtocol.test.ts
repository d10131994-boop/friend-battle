import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeDuelSubmitAction, parseDuelSelection } from './duelProtocol.js'

test('accepts distinct actions including attack and defense in same zone', () => {
  assert.deepEqual(parseDuelSelection([{ kind: 'attack', zone: 'head' }, { kind: 'defend', zone: 'head' }]), [
    { kind: 'attack', zone: 'head' }, { kind: 'defend', zone: 'head' },
  ])
})
test('rejects duplicates and malformed actions', () => {
  assert.throws(() => parseDuelSelection([{ kind: 'attack', zone: 'head' }, { kind: 'attack', zone: 'head' }]))
  assert.throws(() => parseDuelSelection([{ kind: 'attack', zone: 'head' }, { kind: 'attack', zone: 'unknown' }]))
  assert.throws(() => parseDuelSelection([{ kind: 'attack', zone: 'head' }]))
})
test('request includes match/exchange identity and never accepts result fields', () => {
  const request = makeDuelSubmitAction({
    roomId: 'room', matchId: 'match', exchange: 2, initData: 'signed',
    choices: [{ kind: 'attack', zone: 'head' }, { kind: 'defend', zone: 'legs' }],
  })
  assert.deepEqual(Object.keys(request).sort(), ['action', 'choices', 'exchange', 'initData', 'matchId', 'roomId'].sort())
  assert.throws(() => makeDuelSubmitAction({ ...request, exchange: 0 }))
})

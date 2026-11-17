import { test } from 'node:test'
import assert from 'node:assert/strict'
import { posesForBeat } from './duelPresentation.js'

test('shield block presents attacker and defender', () => {
  assert.deepEqual(posesForBeat({ kind: 'shield-block', attacker: 0, defender: 1, zone: 'head' }), [
    { kind: 'attacking', zone: 'head' }, { kind: 'defending', zone: 'head' },
  ])
})
test('a reflected strike shows its damaged target', () => {
  assert.deepEqual(posesForBeat({ kind: 'strike', hits: [{ source: 1, target: 0, zone: 'belly', reflected: true }] }), [
    { kind: 'hit', zone: 'belly' }, { kind: 'attacking', zone: 'belly' },
  ])
})
test('simultaneous cross-strikes show both damage reactions', () => {
  assert.deepEqual(posesForBeat({ kind: 'strike', hits: [
    { source: 0, target: 1, zone: 'head', reflected: false },
    { source: 1, target: 0, zone: 'chest', reflected: false },
  ] }), [{ kind: 'hit', zone: 'chest' }, { kind: 'hit', zone: 'head' }])
})
test('fall pose is applied only to fallen fighters', () => {
  assert.deepEqual(posesForBeat({ kind: 'fall', fighters: [1] }), [{ kind: '' }, { kind: 'fallen' }])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSnapshot } from './duelSnapshot.js'

const valid = {
  matchId: 'match-id',
  exchange: 1,
  fighter: 0,
  status: 'playing',
  yourChoiceSubmitted: false,
  opponentReady: false,
  deadline: '2026-11-18T12:00:15.000Z',
  resolveAfter: null,
  match: { wins: [0, 0], health: [3, 3], round: 1, exchanges: 0, finished: false, winner: null },
  lastResult: null,
}

test('accepts an authenticated, private match snapshot shape', () => {
  assert.deepEqual(parseSnapshot(valid), valid)
})

test('rejects missing or invalid server deadlines', () => {
  assert.throws(() => parseSnapshot({ ...valid, deadline: undefined }))
  assert.throws(() => parseSnapshot({ ...valid, deadline: 'not-a-date' }))
  assert.throws(() => parseSnapshot({ ...valid, resolveAfter: 'bad' }))
})

test('rejects forged combat state and invalid player index', () => {
  assert.throws(() => parseSnapshot({ ...valid, fighter: 2 }))
  assert.throws(() => parseSnapshot({ ...valid, match: { ...valid.match, health: [9, 3] } }))
  assert.throws(() => parseSnapshot({ ...valid, exchange: -1 }))
})

test('accepts a server combat result and rejects malformed choreography', () => {
  const result = {
    exchange: 1,
    roundResult: 'continue',
    resolution: {
      hits: [{ source: 0, target: 1, zone: 'head', reflected: false }],
      clashes: [],
      blocks: [],
      damage: [0, 1],
      healthAfter: [3, 2],
      outcome: 'continue',
    },
  }
  assert.equal(parseSnapshot({ ...valid, lastResult: result }).lastResult?.exchange, 1)
  assert.throws(() => parseSnapshot({
    ...valid, lastResult: { ...result, resolution: { ...result.resolution, hits: [{ source: 5, target: 1, zone: 'head' }] } },
  }))
})

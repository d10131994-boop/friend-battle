import {
  connectedCharacterGroup,
  createEmptyBoard,
  generateCharacterLevel,
  generateCharacterSequence,
  placeCharacter,
} from '../../../src/games/DemocracyMerge/logic/gameEngine.ts'
import type { Board } from '../../../src/games/DemocracyMerge/logic/gameEngine.ts'

Deno.test('only orthogonally adjacent equal characters form a group', () => {
  const diagonalBoard = createEmptyBoard()
  diagonalBoard[0] = { kind: 'character', level: 1 }
  diagonalBoard[7] = { kind: 'character', level: 1 }
  if (connectedCharacterGroup(diagonalBoard, 0).join(',') !== '0') {
    throw new Error('Diagonal contact must not connect cells.')
  }

  const connectedBoard = createEmptyBoard()
  for (const index of [0, 1, 6, 7, 8]) {
    connectedBoard[index] = { kind: 'character', level: 1 }
  }
  if (connectedCharacterGroup(connectedBoard, 0).join(',') !== '0,1,6,7,8') {
    throw new Error('Orthogonal flood fill returned an incorrect group.')
  }
})

Deno.test('three equal characters merge and preserve the placement cell', () => {
  const board = createEmptyBoard()
  board[0] = { kind: 'character', level: 1 }
  board[1] = { kind: 'character', level: 1 }
  const result = placeCharacter(board, 2, 1)
  if (result.merges.length !== 1 || result.scoreDelta !== 20) {
    throw new Error('A level 1 triple must produce one level 2 merge worth 20 points for two cleared cells.')
  }
  if (result.board[2]?.kind !== 'character' || result.board[2].level !== 2) {
    throw new Error('The placed cell must contain the upgraded character.')
  }
  if (result.board[0] !== null || result.board[1] !== null) {
    throw new Error('The other merge cells must be cleared.')
  }
})

Deno.test('a connected group of four or more is merged in full', () => {
  const board = createEmptyBoard()
  for (const index of [0, 1, 6]) board[index] = { kind: 'character', level: 2 }
  const result = placeCharacter(board, 7, 2)
  if (result.merges[0]?.cells.length !== 4 || result.scoreDelta !== 90) {
    throw new Error('All four connected characters must merge into one level 3 character.')
  }
})

Deno.test('merge chains resolve automatically and score every stage', () => {
  const board = createEmptyBoard()
  board[0] = { kind: 'character', level: 1 }
  board[1] = { kind: 'character', level: 1 }
  board[8] = { kind: 'character', level: 2 }
  board[14] = { kind: 'character', level: 2 }
  const result = placeCharacter(board, 2, 1)
  if (result.merges.length !== 2 || result.scoreDelta !== 80) {
    throw new Error('The level 1 merge and resulting level 2 chain must both score.')
  }
  if (result.board[2]?.kind !== 'character' || result.board[2].level !== 3) {
    throw new Error('The chain must finish with a level 3 character.')
  }
  if (result.board[8] !== null || result.board[14] !== null) {
    throw new Error('The chained group must be cleared.')
  }
})

Deno.test('obstacles block their own cell and never join a merge group', () => {
  const board = createEmptyBoard()
  board[0] = { kind: 'character', level: 1 }
  board[1] = { kind: 'obstacle', obstacleType: 'rock' }
  const result = placeCharacter(board, 6, 1)
  if (result.merges.length !== 0 || result.board[1]?.kind !== 'obstacle') {
    throw new Error('Obstacles must remain unchanged and must not merge.')
  }
})

Deno.test('level 6 repeat merges use the repeat score', () => {
  const board = createEmptyBoard()
  board[0] = { kind: 'character', level: 6 }
  board[1] = { kind: 'character', level: 6 }
  const first = placeCharacter(board, 2, 6, 0)
  const secondBoard: Board = createEmptyBoard()
  secondBoard[0] = { kind: 'character', level: 6 }
  secondBoard[1] = { kind: 'character', level: 6 }
  const repeated = placeCharacter(secondBoard, 2, 6, first.level6MergeCount)
  if (first.scoreDelta !== 1620 || repeated.scoreDelta !== 4860) {
    throw new Error('First level 6 merge is worth 1620; subsequent merges are worth 4860.')
  }
  if (repeated.board[2]?.kind !== 'character' || repeated.board[2].level !== 6) {
    throw new Error('Level 6 must remain capped at level 6.')
  }
})

Deno.test('character generation follows the agreed weighted boundaries', () => {
  const values = [0, 0.4999, 0.5, 0.7499, 0.75, 0.8699, 0.87, 0.9399, 0.94, 0.9799, 0.98]
  const expected = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6]
  values.forEach((value, index) => {
    if (generateCharacterLevel(() => value) !== expected[index]) {
      throw new Error(`Unexpected generated level for random value ${value}.`)
    }
  })
  const sequence = generateCharacterSequence(4, () => 0.99)
  if (sequence.some((level) => level !== 6)) {
    throw new Error('Injected random source must be used for every sequence entry.')
  }
})

Deno.test('solo can merge beyond level six while multiplayer remains capped', () => {
  const board = createEmptyBoard()
  board[0] = { kind: 'character', level: 6 }
  board[1] = { kind: 'character', level: 6 }
  const solo = placeCharacter(board, 2, 6, 0, 10)
  const multiplayer = placeCharacter(board, 2, 6)
  if (solo.board[2]?.kind !== 'character' || solo.board[2].level !== 7) throw new Error('Solo must unlock level seven.')
  if (multiplayer.board[2]?.kind !== 'character' || multiplayer.board[2].level !== 6) throw new Error('Multiplayer must retain its level six cap.')
})

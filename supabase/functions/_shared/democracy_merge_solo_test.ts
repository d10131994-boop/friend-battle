import {
  buySoloTool,
  createEmptySoloProfile,
  createSoloGameState,
  currentSoloCharacter,
  deleteSoloHistoryRecord,
  finalizeSoloDeadline,
  nextSoloCharacter,
  placeSoloCharacter,
  recordSoloResult,
  surrenderSoloGame,
  applySoloTool,
} from '../../../src/games/DemocracyMerge/logic/solo.ts'

Deno.test('solo game starts with agreed board, coins, tools and timer', () => {
  const state = createSoloGameState(1000, () => 0.1)
  if (state.board.length !== 36 || state.coins !== 200 || state.turnNumber !== 0 ||
      state.inventory.saw !== 0 || Date.parse(state.deadlineAt) - Date.parse(state.startedAt) !== 30 * 60 * 1000) {
    throw new Error('Solo game initial state is incorrect.')
  }
  if (currentSoloCharacter(state) !== 1 || nextSoloCharacter(state) !== 1) {
    throw new Error('Solo character queue must expose current and next characters.')
  }
})

Deno.test('solo placement advances only after a successful placement and resolves merges', () => {
  const base = createSoloGameState(1000, () => 0)
  const board = [...base.board]
  board[0] = { kind: 'character', level: 1 }
  board[1] = { kind: 'character', level: 1 }
  const prepared = { ...base, board }
  const result = placeSoloCharacter(prepared, 2, 2000, () => 0.9)
  if (result.state.turnNumber !== 1 || result.state.score !== 20 ||
      result.state.board[2]?.kind !== 'character' || result.state.board[2].level !== 2) {
    throw new Error('Solo merge and turn advancement failed.')
  }
})

Deno.test('solo tools do not advance the turn and storage is consumed on return', () => {
  const base = createSoloGameState(1000, () => 0.1)
  const board = [...base.board]
  board[0] = { kind: 'character', level: 3 }
  const prepared = { ...base, board, inventory: { ...base.inventory, storage: 1, saw: 1 } }
  const stored = applySoloTool(prepared, 'storage', { cellIndex: 0, storageAction: 'store' }, 2000)
  if (stored.turnNumber !== 0 || stored.storage?.level !== 3 || stored.inventory.storage !== 1) {
    throw new Error('Storing must not advance the turn or consume storage.')
  }
  const returned = applySoloTool(stored, 'storage', { cellIndex: 1, storageAction: 'return' }, 3000)
  if (returned.turnNumber !== 0 || returned.storage !== null || returned.inventory.storage !== 0) {
    throw new Error('Returning must not advance the turn and must consume storage.')
  }
})

Deno.test('solo shop purchases use the agreed price', () => {
  const state = createSoloGameState(1000, () => 0.1)
  const bought = buySoloTool(state, 'saw', 2000)
  if (bought.coins !== 155 || bought.inventory.saw !== 1 || bought.turnNumber !== 0) {
    throw new Error('Solo shop purchase failed.')
  }
})

Deno.test('surrender and deadline preserve a result; history deletion does not change records', () => {
  const base = createSoloGameState(1000, () => 0.1)
  const surrendered = surrenderSoloGame(base, 2000)
  if (surrendered.status !== 'surrendered' || surrendered.result?.score !== 0) {
    throw new Error('Surrender must preserve the current result.')
  }
  const timed = finalizeSoloDeadline(base, Date.parse(base.deadlineAt) + 1)
  if (timed.status !== 'completed' || !timed.result?.timedOut) {
    throw new Error('Deadline must finalize the last saved state.')
  }
  let profile = recordSoloResult(createEmptySoloProfile(), surrendered)
  const id = profile.history[0].id
  profile = deleteSoloHistoryRecord(profile, id)
  if (profile.history.length !== 0 || profile.totalGames !== 1 || profile.bestScore !== 0) {
    throw new Error('Deleting a history row must not change aggregate records.')
  }
  const timedProfile = recordSoloResult(profile, timed)
  if (timedProfile.totalGames !== 2) throw new Error('Solo aggregate games count failed.')
})

Deno.test('solo swap resolves a connected triple and scores cleared cells', () => {
  const base = createSoloGameState(1000, () => 0.1)
  const board = [...base.board]
  board[0] = { kind: 'character', level: 1 }
  board[1] = { kind: 'character', level: 1 }
  board[2] = { kind: 'character', level: 2 }
  board[3] = { kind: 'character', level: 1 }
  const prepared = { ...base, board, inventory: { ...base.inventory, swap: 1 } }
  const swapped = applySoloTool(prepared, 'swap', { firstCellIndex: 2, secondCellIndex: 3 }, 2000)
  if (swapped.score !== 20 || swapped.mergeCount !== 1 || swapped.board[2]?.kind !== 'character' || swapped.board[2].level !== 2) {
    throw new Error('Swapping into a triple must merge and score two vanished cells.')
  }
})

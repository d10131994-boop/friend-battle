import { database } from '../../database'
import { makeDuelSubmitAction, type DuelSnapshotRequest } from './duelProtocol'
import type { Action } from './duelEngine'

/**
 * Transport only. The duel Edge Function must verify Telegram initData,
 * room membership, game selection and match state on the trusted server.
 * No local combat result is submitted.
 */
export function createDuelApi(initData: string) {
  if (!initData.trim()) throw new Error('Telegram authentication is required')
  return {
    getMatch(roomId: string): Promise<unknown> {
      if (!roomId.trim()) throw new Error('Missing room identity')
      const request: DuelSnapshotRequest = { action: 'get_match', roomId, initData }
      return database.invokeFunction<unknown, DuelSnapshotRequest>('duel', request)
    },
    submitChoice(input: { roomId: string; matchId: string; exchange: number; choices: readonly Action[] }): Promise<unknown> {
      const request = makeDuelSubmitAction({ ...input, initData })
      return database.invokeFunction<unknown, typeof request>('duel', request)
    },
  }
}

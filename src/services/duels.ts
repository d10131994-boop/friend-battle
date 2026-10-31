
import { supabase } from '../supabase'

export type Duel = {
  id: string
  invite_code: string
  status: 'waiting' | 'playing' | 'finished'
  player1_telegram_id: string
  player1_name: string
  player1_score: number | null
  player2_telegram_id: string | null
  player2_name: string | null
  player2_score: number | null
  winner_telegram_id: string | null
  player1_ready: boolean
  player2_ready: boolean
  started_at: string | null
  ends_at: string | null
}

type DuelResponse = {
  success?: boolean
  duel?: Duel
  error?: string
}

async function callDuel(
  body: Record<string, string | number>
): Promise<Duel> {
  const { data, error } = await supabase.functions.invoke<DuelResponse>(
    'duels',
    { body }
  )

  if (error) throw error

  if (!data?.success || !data.duel) {
    throw new Error(data?.error || 'Не удалось выполнить действие с дуэлью')
  }

  return data.duel
}

export function createDuelRequest(initData: string): Promise<Duel> {
  return callDuel({
    initData,
    action: 'create',
  })
}

export function getDuelRequest(
  initData: string,
  inviteCode: string
): Promise<Duel> {
  return callDuel({
    initData,
    action: 'get',
    inviteCode,
  })
}

export function readyDuelRequest(
  initData: string,
  inviteCode: string
): Promise<Duel> {
  return callDuel({
    initData,
    action: 'ready',
    inviteCode,
  })
}

export function joinDuelRequest(
  initData: string,
  inviteCode: string
): Promise<Duel> {
  return callDuel({
    initData,
    action: 'join',
    inviteCode,
  })
}

export function submitDuelScoreRequest(
  initData: string,
  inviteCode: string,
  score: number
): Promise<Duel> {
  return callDuel({
    initData,
    action: 'submit',
    inviteCode,
    score,
  })
}

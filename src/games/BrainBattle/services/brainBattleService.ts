
import { supabase } from '../../../supabase'
import type {
  BrainBattleRoomResponse,
} from '../types'

export type BrainBattleServerResponse = {
  success?: boolean
  message?: string
  error?: string
  player?: {
    telegram_id: string
    player_name: string
  }
}

export type BrainBattleSubmitResponse = {
  success: boolean
  result: {
    success: boolean
    status: 'waiting' | 'advanced' | 'finished'
    currentQuestionIndex: number
    questionStartedAt: string | null
    questionEndsAt: string | null
    score: number
    winnerTelegramId?: string | null
  }
}

type BrainBattleRoomActionResponse = {
  success: boolean
  room: {
    id: string
    invite_code?: string
    status: 'waiting' | 'playing' | 'finished'
  }
  player?: {
    telegram_id: string
    player_name: string
  }
}

async function invokeBrainBattle<T>(
  initData: string,
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(
    'brain-battle',
    {
      body: {
        initData,
        action,
        ...params,
      },
    }
  )

  if (error) throw error

  if (!data || (data as { success?: boolean }).success === false) {
    const message = (data as { error?: string } | null)?.error
    throw new Error(message || 'Ошибка BRAIN BATTLE')
  }

  return data
}

export async function checkBrainBattleServer(
  initData: string
): Promise<BrainBattleServerResponse> {
  return invokeBrainBattle<BrainBattleServerResponse>(
    initData,
    'check'
  )
}

export async function createBrainBattleRoom(
  initData: string
): Promise<BrainBattleRoomActionResponse> {
  return invokeBrainBattle<BrainBattleRoomActionResponse>(
    initData,
    'create'
  )
}

export async function joinBrainBattleRoom(
  initData: string,
  inviteCode: string
): Promise<BrainBattleRoomActionResponse> {
  return invokeBrainBattle<BrainBattleRoomActionResponse>(
    initData,
    'join',
    { inviteCode }
  )
}

export async function getBrainBattleRoom(
  initData: string,
  roomId: string
): Promise<BrainBattleRoomResponse> {
  return invokeBrainBattle<BrainBattleRoomResponse>(
    initData,
    'get',
    { roomId }
  )
}

export async function setBrainBattleReady(
  initData: string,
  roomId: string
): Promise<{
  success: boolean
  ready: boolean
  started: boolean
  started_at: string | null
}> {
  return invokeBrainBattle(
    initData,
    'ready',
    { roomId }
  )
}

export async function submitBrainBattleAnswer(
  initData: string,
  roomId: string,
  questionIndex: number,
  selectedAnswer: number | null
): Promise<BrainBattleSubmitResponse> {
  return invokeBrainBattle<BrainBattleSubmitResponse>(
    initData,
    'submit',
    {
      roomId,
      questionIndex,
      selectedAnswer,
    }
  )
}

import { supabaseClient } from '../client/supabaseClient'
import { normalizeDatabaseError } from '../errors/normalizeError'
import type { DatabaseRecord } from '../types/database.types'

export async function rpc<TResponse = unknown>(
  functionName: string,
  args: DatabaseRecord = {},
): Promise<TResponse> {
  try {
    const { data, error } = await supabaseClient.rpc(functionName, args)
    if (error) throw error
    return data as TResponse
  } catch (error) {
    throw normalizeDatabaseError(error, `rpc:${functionName}`)
  }
}

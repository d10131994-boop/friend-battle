import { supabaseClient } from '../client/supabaseClient'
import { normalizeDatabaseError } from '../errors/normalizeError'
import type { DatabaseRecord } from '../types/database.types'

export interface EdgeFunctionOptions {
  headers?: Record<string, string>
}

export async function invokeFunction<
  TResponse = unknown,
  TBody extends DatabaseRecord = DatabaseRecord,
>(
  functionName: string,
  body: TBody,
  options: EdgeFunctionOptions = {},
): Promise<TResponse> {
  try {
    const { data, error } = await supabaseClient.functions.invoke<TResponse>(
      functionName,
      {
        body,
        headers: options.headers,
      },
    )

    if (error) throw error
    return data as TResponse
  } catch (error) {
    throw normalizeDatabaseError(error, `edge-function:${functionName}`)
  }
}

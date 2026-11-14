export type SqlErrorLike = {
  code?: string
}

export interface SqlErrorResponseOptions {
  operation: string
  fallbackMessage: string
  messages?: Record<string, string>
}

const SQL_ERROR_STATUS: Record<string, { status: number; message: string }> = {
  P0002: { status: 404, message: "Запрошенный ресурс не найден" },
  42501: { status: 403, message: "Недостаточно прав для этой операции" },
  23505: { status: 409, message: "Операция конфликтует с текущими данными" },
  55000: { status: 409, message: "Действие сейчас недоступно. Обновите состояние и попробуйте снова." },
  40001: { status: 409, message: "Состояние изменилось. Обновите данные и повторите действие." },
  54000: { status: 409, message: "Достигнут допустимый лимит операции" },
  22023: { status: 400, message: "Некорректные параметры запроса" },
}

/**
 * Maps expected PostgreSQL business errors to stable client responses.
 * Unknown database errors are logged without exposing SQL details to clients.
 */
export function sqlErrorResponse(
  error: SqlErrorLike,
  corsHeaders: Record<string, string>,
  options: SqlErrorResponseOptions,
): Response {
  const code = typeof error.code === "string" ? error.code : "UNKNOWN"
  const known = SQL_ERROR_STATUS[code]
  const status = known?.status ?? 500
  const message = options.messages?.[code] ?? known?.message ?? options.fallbackMessage

  if (status === 500) {
    console.error("Database operation failed", {
      operation: options.operation,
      code,
    })
  }

  return Response.json({ error: message }, { status, headers: corsHeaders })
}

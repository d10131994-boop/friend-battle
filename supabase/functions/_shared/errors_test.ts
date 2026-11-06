import { sqlErrorResponse } from "./errors.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const headers = { "Access-Control-Allow-Origin": "*" }

Deno.test("maps expected PostgreSQL errors to stable HTTP statuses", async () => {
  const cases = [
    ["P0002", 404],
    ["42501", 403],
    ["23505", 409],
    ["55000", 409],
    ["54000", 409],
    ["22023", 400],
    ["XX000", 500],
  ] as const

  for (const [code, expectedStatus] of cases) {
    const response = sqlErrorResponse(
      { code },
      headers,
      { operation: "test", fallbackMessage: "Generic failure" },
    )
    assert(response.status === expectedStatus, `Expected ${code} to map to ${expectedStatus}`)
    assert(response.headers.get("Access-Control-Allow-Origin") === "*", "CORS headers must be preserved")
    const body = await response.json() as { error?: string }
    assert(typeof body.error === "string" && body.error.length > 0, "Response must contain a safe message")
    assert(!body.error.includes(code), "Response must not expose database error codes")
  }
})

Deno.test("allows operation-specific safe messages to override defaults", async () => {
  const response = sqlErrorResponse(
    { code: "P0002" },
    headers,
    {
      operation: "test",
      fallbackMessage: "Generic failure",
      messages: { P0002: "Комната или матч не найдены" },
    },
  )
  const body = await response.json() as { error?: string }
  assert(response.status === 404, "Expected not-found status")
  assert(body.error === "Комната или матч не найдены", "Expected the configured safe message")
})

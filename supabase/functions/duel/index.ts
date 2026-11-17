import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })
type TelegramUser = { id: number; first_name?: string }

async function telegramUser(initData: string, botToken: string): Promise<TelegramUser | null> {
  const params = new URLSearchParams(initData)
  const hash = params.get("hash")
  const authDate = Number(params.get("auth_date"))
  const now = Math.floor(Date.now() / 1000)
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isSafeInteger(authDate) ||
      authDate > now + 30 || now - authDate > 3600) return null
  params.delete("hash")
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join("\n")
  const encoder = new TextEncoder()
  const first = await crypto.subtle.importKey("raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const secret = await crypto.subtle.sign("HMAC", first, encoder.encode(botToken))
  const second = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", second, encoder.encode(data)))
  const received = new Uint8Array(hash.match(/.{2}/g)!.map(part => parseInt(part, 16)))
  let diff = 0
  for (let i = 0; i < signature.length; i++) diff |= signature[i] ^ received[i]
  if (diff !== 0) return null
  try {
    const user = JSON.parse(params.get("user") ?? "null")
    return Number.isSafeInteger(user?.id) && user.id > 0 ? user as TelegramUser : null
  } catch { return null }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405)
  try {
    const body = await request.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid request" }, 400)
    if (body.action !== "get_match" && body.action !== "submit_choice") return reply({ error: "Unknown action" }, 400)
    if (typeof body.roomId !== "string" || !body.roomId.trim() || body.roomId.length > 80 ||
        typeof body.initData !== "string" || body.initData.length > 10000) return reply({ error: "Invalid request" }, 400)
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")
    const url = Deno.env.get("SUPABASE_URL")
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!botToken || !url || !key) return reply({ error: "Server configuration missing" }, 503)
    const user = await telegramUser(body.initData, botToken)
    if (!user) return reply({ error: "Telegram verification failed" }, 401)
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: room, error } = await client.rpc("multiplayer_execute_action", {
      p_action: "get_room", p_user_id: String(user.id),
      p_display_name: user.first_name?.slice(0, 100) || "Игрок", p_payload: { roomId: body.roomId },
    })
    if (error) return reply({ error: "Room lookup failed" }, 403)
    if (!room || room.gameId !== "duel") return reply({ error: "Duel is not selected in this room" }, 409)
    if (!Array.isArray(room.players) || !room.players.some((player: { userId?: string }) => player.userId === String(user.id)))
      return reply({ error: "Not a room member" }, 403)
    // Fail closed until atomic, server-authoritative persistence is deployed.
    // Never accept or expose a browser-computed combat result.
    return reply({ error: "Duel multiplayer match storage is not configured yet" }, 503)
  } catch (error) {
    console.error("Duel request failed:", error instanceof Error ? error.message : "unknown")
    return reply({ error: "Unexpected server error" }, 500)
  }
})

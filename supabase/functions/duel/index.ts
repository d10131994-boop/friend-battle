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
    if (body.action !== "get_match" && body.action !== "submit_choice" && body.action !== "start_match" && body.action !== "return_to_room") return reply({ error: "Unknown action" }, 400)
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
    if (body.action === "start_match") {
      const host = room.players.find((player: { userId?: string; isHost?: boolean }) => player.userId === String(user.id))
      if (!host?.isHost) return reply({ error: "Only room host can start the match" }, 403)
      if (room.status !== "waiting" && room.status !== "finished") return reply({ error: "Room cannot start a new match" }, 409)
      const { data: startedRoom, error: startError } = await client.rpc("multiplayer_execute_action", {
        p_action: "start_game", p_user_id: "__game_server__", p_display_name: "Game server",
        p_payload: { roomId: body.roomId, gameId: "duel" },
      })
      if (startError) return reply({ error: "Duel room could not start" }, 409)
      const { error: ensureStartedError } = await client.rpc("duel_ensure_match", {
        p_room_id: body.roomId, p_user_id: String(user.id),
      })
      if (ensureStartedError) return reply({ error: "Duel match could not be initialized" }, 503)
      await notifyRoom(client, body.roomId, "match_started")
      return reply({ room: startedRoom })
    }
    if (body.action === "return_to_room") {
      const { data: completedMatch, error: completedError } = await client.from("games_duel_matches")
        .select("id,status").eq("room_id", body.roomId).eq("started_at", room.startedAt).maybeSingle()
      if (completedError || completedMatch?.status !== "completed") return reply({ error: "Match is not completed" }, 409)
      const { data: finishedRoom, error: finishError } = await client.rpc("multiplayer_execute_action", {
        p_action: "finish_game", p_user_id: "__game_server__", p_display_name: "Game server",
        p_payload: { roomId: body.roomId, gameId: "duel", startedAt: room.startedAt },
      })
      if (finishError) return reply({ error: "Duel room could not finish" }, 409)
      await notifyRoom(client, body.roomId, "room_finished")
      return reply({ room: finishedRoom })
    }
    if (room.status !== "playing" || typeof room.startedAt !== "string") {
      return reply({ error: "Duel match is not active" }, 409)
    }
    const { data: ensured, error: ensureError } = await client.rpc("duel_ensure_match", {
      p_room_id: body.roomId, p_user_id: String(user.id),
    })
    if (ensureError) return reply({ error: "Duel match could not be initialized" }, 409)
    const { error: tickError } = await client.rpc("duel_tick", { p_match_id: ensured.matchId })
    if (tickError) return reply({ error: "Duel clock update failed" }, 503)
    const { data: match, error: matchError } = await client.from("games_duel_matches")
      .select("id,room_id,started_at,player_ids,status,exchange,match_state,pending,last_result,exchange_deadline,both_ready_at")
      .eq("room_id", body.roomId).eq("started_at", room.startedAt).maybeSingle()
    if (matchError) return reply({ error: "Match lookup failed" }, 500)
    if (!match) return reply({ error: "Match has not been initialized" }, 409)
    const fighter = match.player_ids?.indexOf(String(user.id))
    if (fighter !== 0 && fighter !== 1) return reply({ error: "Not a duel fighter" }, 403)
    const snapshot = {
      matchId: match.id,
      exchange: match.exchange,
      match: match.match_state,
      status: match.status,
      yourChoiceSubmitted: Object.prototype.hasOwnProperty.call(match.pending ?? {}, String(fighter + 1)),
      opponentReady: Object.prototype.hasOwnProperty.call(match.pending ?? {}, String(2 - fighter)),
      lastResult: match.last_result,
      fighter,
      deadline: match.exchange_deadline,
      resolveAfter: match.both_ready_at ? new Date(new Date(match.both_ready_at).getTime() + 2000).toISOString() : null,
    }
    if (body.action === "get_match") return reply(snapshot)
    if (typeof body.matchId !== "string" || body.matchId !== match.id ||
        !Number.isSafeInteger(body.exchange) || body.exchange !== match.exchange ||
        !Array.isArray(body.choices) || body.choices.length !== 2) {
      return reply({ error: "Invalid or stale duel choice" }, 409)
    }
    const valid = body.choices.every((choice: unknown) => {
      if (!choice || typeof choice !== "object" || Array.isArray(choice)) return false
      const item = choice as Record<string, unknown>
      return (item.kind === "attack" || item.kind === "defend") &&
        ["head", "chest", "belly", "legs"].includes(String(item.zone))
    })
    if (!valid || (body.choices[0].kind === body.choices[1].kind &&
        body.choices[0].zone === body.choices[1].zone)) return reply({ error: "Invalid duel actions" }, 400)
    const { data: submission, error: submitError } = await client.rpc("duel_submit_pending", {
      p_room_id: body.roomId, p_match_id: match.id,
      p_user_id: String(user.id), p_exchange: body.exchange, p_choices: body.choices,
    })
    if (submitError) return reply({ error: "Duel choice could not be accepted" }, 409)
    const { data: tick, error: tickErrorAfterSubmit } = await client.rpc("duel_tick", { p_match_id: match.id })
    if (tickErrorAfterSubmit) return reply({ error: "Duel clock update failed" }, 503)
    if (tick.status === "resolved" || tick.status === "completed") {
      await notifyRoom(client, body.roomId, tick.status === "completed" ? "match_finished" : "round_finished")
    }
    return reply({ ...submission, resolutionPending: tick.status === "both_ready", tick })

  } catch (error) {
    console.error("Duel request failed:", error instanceof Error ? error.message : "unknown")
    return reply({ error: "Unexpected server error" }, 500)
  }
})

async function notifyRoom(client: ReturnType<typeof createClient>, roomId: string, event: string): Promise<void> {
  try {
    const channel = client.channel(`room:${roomId}`, { config: { private: true } })
    const result = await channel.send({
      type: "broadcast", event, payload: { roomId, source: "duel" },
    })
    if (result !== "ok") console.warn("Duel room notification not acknowledged:", event)
    await client.removeChannel(channel)
  } catch (error) {
    console.warn("Duel room notification failed:", error instanceof Error ? error.message : "unknown")
  }
}

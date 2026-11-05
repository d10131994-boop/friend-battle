import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TelegramUser = { id: number; first_name?: string; username?: string };

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("Invalid hash");
  return new Uint8Array(hex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
}

async function verifyTelegram(initData: string, botToken: string): Promise<TelegramUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!hash || !Number.isFinite(authDate)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 3600 || authDate > now + 30) return null;

  params.delete("hash");
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(botToken));
  const validationKey = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const calculated = await crypto.subtle.sign(
    "HMAC", validationKey, encoder.encode(checkString),
  );
  const expected = [...new Uint8Array(calculated)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  let receivedBytes: Uint8Array;
  let expectedBytes: Uint8Array;
  try {
    receivedBytes = hexToBytes(hash);
    expectedBytes = hexToBytes(expected);
  } catch {
    return null;
  }
  if (receivedBytes.length !== expectedBytes.length) return null;

  let difference = 0;
  for (let index = 0; index < receivedBytes.length; index++) {
    difference |= receivedBytes[index] ^ expectedBytes[index];
  }
  if (difference !== 0) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null");
    return user?.id && Number.isSafeInteger(user.id) ? user as TelegramUser : null;
  } catch {
    return null;
  }
}

function respond(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function fail(message: string, status: number): Response {
  return respond({ error: message }, status);
}

function errorResponse(error: { code?: string; message?: string }): Response {
  if (error.code === "P0002") return fail("Комната не найдена", 404);
  if (error.code === "42501") return fail("Недостаточно прав для этой операции", 403);
  if (error.code === "55000" || error.code === "54000") return fail(error.message ?? "Действие сейчас недоступно", 409);
  if (error.code === "22023") return fail(error.message ?? "Некорректный запрос", 400);
  return fail("Не удалось выполнить действие Reaction Rush", 500);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!supabaseUrl || !serviceKey || !botToken) {
      console.error("Missing Reaction Rush server configuration");
      return fail("Server configuration missing", 500);
    }

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid request body", 400);
    const action = body.action;
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    const startedAt = typeof body.startedAt === "string" ? body.startedAt : "";
    const initData = typeof body.initData === "string" ? body.initData : "";

    if (!["start_round", "tap", "finish_round"].includes(action)) {
      return fail("Unknown Reaction Rush action", 400);
    }
    if (!roomId || roomId.length > 80) return fail("A valid roomId is required", 400);
    if (action !== "start_round" && !startedAt) return fail("A valid startedAt is required", 400);
    if (!initData || initData.length > 10000) return fail("Invalid Telegram data", 400);

    const user = await verifyTelegram(initData, botToken);
    if (!user) return fail("Telegram verification failed", 401);

    const telegramId = String(user.id);
    const displayName = user.first_name?.trim().slice(0, 100) || "Игрок";
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "tap") {
      const { data, error } = await supabase.rpc("reaction_rush_record_tap", {
        p_room_id: roomId,
        p_user_id: telegramId,
        p_started_at: startedAt,
      });
      if (error) return errorResponse(error);
      return respond({ roomId, startedAt, score: data });
    }

    const { data: room, error: roomError } = await supabase.rpc("multiplayer_execute_action", {
      p_action: "get_room",
      p_user_id: telegramId,
      p_display_name: displayName,
      p_payload: { roomId },
    });
    if (roomError) return errorResponse(roomError);
    if (!room || room.gameId !== "reaction-rush") return fail("Это не комната Reaction Rush", 403);

    const member = Array.isArray(room.players)
      ? room.players.find((player: { userId?: string }) => player.userId === telegramId)
      : null;
    if (!member) return fail("Вы не участник этой комнаты", 403);

    if (action === "start_round") {
      if (!member.isHost) return fail("Начать раунд может только создатель комнаты", 403);
      if (!room.players.length || room.players.some((player: { isReady?: boolean }) => !player.isReady)) {
        return fail("Все игроки должны подтвердить готовность", 409);
      }

      const { data, error } = await supabase.rpc("multiplayer_execute_action", {
        p_action: "start_game",
        p_user_id: "__game_server__",
        p_display_name: "Game server",
        p_payload: { roomId, gameId: "reaction-rush" },
      });
      if (error) return errorResponse(error);
      await broadcast(supabase, roomId, "room_updated");
      return respond(data);
    }

    const { data, error } = await supabase.rpc("reaction_rush_finish_round", {
      p_room_id: roomId,
      p_started_at: startedAt,
    });
    if (error) return errorResponse(error);
    await broadcast(supabase, roomId, "room_finished");
    return respond(data);
  } catch (error) {
    console.error("Reaction Rush function error:", error instanceof Error ? error.message : "Unknown error");
    return fail("Unexpected server error", 500);
  }
});

async function broadcast(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
  event: string,
): Promise<void> {
  try {
    const channel = supabase.channel(`room:${roomId}`, { config: { private: true } });
    const sent = await channel.send({
      type: "broadcast",
      event,
      payload: { roomId, source: "reaction-rush" },
    });
    if (sent !== "ok") console.warn("Reaction Rush broadcast was not acknowledged:", sent);
    await supabase.removeChannel(channel);
  } catch (error) {
    console.warn("Reaction Rush broadcast failed:", error instanceof Error ? error.message : "Unknown error");
  }
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sqlErrorResponse } from "../_shared/errors.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function errorResponse(error: { code?: string }): Response {
  return sqlErrorResponse(error, corsHeaders, {
    operation: "reaction-rush",
    fallbackMessage: "Не удалось выполнить действие Reaction Rush",
    messages: { P0002: "Комната не найдена" },
  });
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
    if (!["start_match", "tap", "finish_round", "get_match", "leaderboard"].includes(action)) {
      return fail("Unknown Reaction Rush action", 400);
    }
    const initData = typeof body.initData === "string" ? body.initData : "";
    if (!initData || initData.length > 10000) return fail("Invalid Telegram data", 400);
    const user = await verifyTelegram(initData, botToken);
    if (!user) return fail("Telegram verification failed", 401);

    const telegramId = String(user.id);
    const displayName = user.first_name?.trim().slice(0, 100) || "Игрок";
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "leaderboard") {
      const { data, error } = await supabase
        .from("games_reaction_rush_leaderboard")
        .select("display_name, wins, matches_played, best_match_score")
        .order("wins", { ascending: false })
        .order("best_match_score", { ascending: false })
        .limit(50);
      if (error) return errorResponse(error);
      return respond({ leaderboard: data ?? [] });
    }

    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    if (!roomId || roomId.length > 80) return fail("A valid roomId is required", 400);

    if (action === "tap" || action === "finish_round") {
      const matchId = typeof body.matchId === "string" ? body.matchId : "";
      const roundNumber = Number(body.roundNumber);
      if (!matchId || !Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 3) {
        return fail("A valid matchId and roundNumber are required", 400);
      }
      if (action === "tap") {
        const { data, error } = await supabase.rpc("reaction_rush_record_tap", {
          p_room_id: roomId,
          p_match_id: matchId,
          p_round_number: roundNumber,
          p_user_id: telegramId,
        });
        if (error) return errorResponse(error);
        return respond({ roomId, matchId, roundNumber, score: data });
      }

      const { data, error } = await supabase.rpc("reaction_rush_finish_round", {
        p_room_id: roomId,
        p_match_id: matchId,
        p_round_number: roundNumber,
        p_user_id: telegramId,
      });
      if (error) return errorResponse(error);
      await broadcast(supabase, roomId, data?.matchFinished ? "match_finished" : "round_finished", data);
      return respond(data);
    }

    if (action === "get_match") {
      const { error: roomError } = await supabase.rpc("multiplayer_execute_action", {
        p_action: "get_room",
        p_user_id: telegramId,
        p_display_name: displayName,
        p_payload: { roomId },
      });
      if (roomError) return errorResponse(roomError);
      const { data, error } = await supabase.rpc("reaction_rush_match_snapshot", {
        p_room_id: roomId,
        p_user_id: telegramId,
      });
      if (error) return errorResponse(error);
      return respond(data);
    }

    const { data: room, error: roomError } = await supabase.rpc("multiplayer_execute_action", {
      p_action: "get_room",
      p_user_id: telegramId,
      p_display_name: displayName,
      p_payload: { roomId },
    });
    if (roomError) return errorResponse(roomError);
    if (!room || room.gameId !== "reaction-rush") return fail("В комнате должна быть выбрана Reaction Rush", 409);

    const member = Array.isArray(room.players)
      ? room.players.find((player: { userId?: string }) => player.userId === telegramId)
      : null;
    if (!member) return fail("Вы не участник этой комнаты", 403);
    if (!member.isHost && room.rematchStatus !== "accepted") return fail("Начать матч может только ведущий комнаты", 403);

    const { data, error } = await supabase.rpc("reaction_rush_start_match", {
      p_room_id: roomId,
      p_user_id: telegramId,
    });
    if (error) return errorResponse(error);
    await broadcast(supabase, roomId, "match_started", data);
    return respond(data);
  } catch (error) {
    console.error("Reaction Rush function error:", error instanceof Error ? error.message : "Unknown error");
    return fail("Unexpected server error", 500);
  }
});

async function broadcast(
  supabase: SupabaseClient,
  roomId: string,
  event: string,
  data: unknown = {},
): Promise<void> {
  try {
    const channel = supabase.channel(`room:${roomId}`, { config: { private: true } });
    const sent = await channel.send({
      type: "broadcast",
      event,
      payload: { roomId, source: "reaction-rush", data },
    });
    if (sent !== "ok") console.warn("Reaction Rush broadcast was not acknowledged:", sent);
    await supabase.removeChannel(channel);
  } catch (error) {
    console.warn("Reaction Rush broadcast failed:", error instanceof Error ? error.message : "Unknown error");
  }
}

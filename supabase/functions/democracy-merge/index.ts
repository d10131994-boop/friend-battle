import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateCharacterSequence } from "../../../src/games/DemocracyMerge/logic/gameEngine.ts";
import { generateObstacleSequence } from "../../../src/games/DemocracyMerge/logic/events.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TelegramUser = { id: number; first_name?: string };

function respond(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}
function fail(error: string, status: number): Response {
  return respond({ error }, status);
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
  const digest = await crypto.subtle.sign("HMAC", validationKey, encoder.encode(checkString));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!/^[0-9a-f]{64}$/i.test(hash) || hash.length !== expected.length) return null;
  let difference = 0;
  for (let index = 0; index < hash.length; index++) {
    difference |= hash.toLowerCase().charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (difference !== 0) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null");
    return user?.id && Number.isSafeInteger(user.id) ? user as TelegramUser : null;
  } catch {
    return null;
  }
}

function secureRandomUnit(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

async function broadcast(db: ReturnType<typeof createClient>, roomId: string, event: string) {
  try {
    const channel = db.channel(`room:${roomId}`, { config: { private: true } });
    const result = await channel.send({
      type: "broadcast",
      event,
      payload: { roomId, source: "democracy-merge" },
    });
    if (result !== "ok") console.warn("Democracy Merge broadcast was not acknowledged:", result);
    await db.removeChannel(channel);
  } catch (error) {
    console.warn("Democracy Merge broadcast failed:", error instanceof Error ? error.message : "Unknown error");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!url || !serviceKey || !botToken) return fail("Server configuration missing", 500);

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid request body", 400);
    const actions = ["start_match", "get_match", "leave_match", "return_to_room"];
    if (typeof body.action !== "string" || !actions.includes(body.action)) {
      return fail("Unknown Democracy Merge action", 400);
    }
    if (typeof body.initData !== "string" || body.initData.length === 0 || body.initData.length > 10000) {
      return fail("Invalid Telegram data", 400);
    }
    const user = await verifyTelegram(body.initData, botToken);
    if (!user) return fail("Telegram verification failed", 401);

    const userId = String(user.id);
    const displayName = user.first_name?.trim().slice(0, 100) || "Игрок";
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(roomId)) return fail("A valid roomId is required", 400);

    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (body.action === "start_match") {
      const { data: room, error: roomError } = await db.rpc("multiplayer_execute_action", {
        p_action: "get_room",
        p_user_id: userId,
        p_display_name: displayName,
        p_payload: { roomId },
      });
      if (roomError) return fail("Вы не участник этой комнаты", 403);
      if (room?.gameId !== "democracy-merge") return fail("В комнате должна быть выбрана Democracy Merge", 409);
      const member = room.players?.find((player: { userId: string }) => player.userId === userId);
      if (!member?.isHost) return fail("Начать матч может только ведущий комнаты", 403);

      const characterSequence = generateCharacterSequence(10000, secureRandomUnit);
      const obstacleSequence = generateObstacleSequence(10000, secureRandomUnit);
      const { data, error } = await db.rpc("democracy_merge_start_match", {
        p_room_id: roomId,
        p_user_id: userId,
        p_character_sequence: characterSequence,
        p_obstacle_sequence: obstacleSequence,
      });
      if (error) return fail("Не удалось начать матч Democracy Merge", 409);
      await broadcast(db, roomId, "match_started");
      return respond(data);
    }

    if (body.action === "leave_match") {
      const { data: snapshot, error: snapshotError } = await db.rpc("democracy_merge_match_snapshot", {
        p_room_id: roomId,
        p_user_id: userId,
      });
      if (snapshotError) return fail("Не удалось получить состояние матча", 409);
      if (snapshot?.match?.status !== "playing" || snapshot?.match?.me?.status !== "active") {
        return fail("В активном матче нет игрока, который может выйти", 409);
      }
      const { data, error } = await db.rpc("multiplayer_execute_action", {
        p_action: "leave_active_match",
        p_user_id: "__game_server__",
        p_display_name: "Game server",
        p_payload: { roomId, gameId: "democracy-merge", playerUserId: userId },
      });
      if (error) return fail("Не удалось окончательно выйти из матча", 409);
      await broadcast(db, roomId, "player_left");
      return respond({ room: data });
    }

    if (body.action === "return_to_room") {
      const { data: snapshot, error: snapshotError } = await db.rpc("democracy_merge_match_snapshot", {
        p_room_id: roomId,
        p_user_id: userId,
      });
      if (snapshotError) return fail("Не удалось получить состояние матча", 409);
      if (snapshot?.match?.status !== "completed") return fail("Матч ещё не завершён", 409);
      const { data, error } = await db.rpc("multiplayer_execute_action", {
        p_action: "finish_game",
        p_user_id: "__game_server__",
        p_display_name: "Game server",
        p_payload: { roomId, gameId: "democracy-merge", startedAt: snapshot.match.startedAt },
      });
      if (error) return fail("Не удалось завершить общую комнату", 409);
      await broadcast(db, roomId, "room_finished");
      return respond({ room: data });
    }

    const { data, error } = await db.rpc("democracy_merge_match_snapshot", {
      p_room_id: roomId,
      p_user_id: userId,
    });
    if (error) return fail("Не удалось получить состояние матча", 409);
    return respond(data);
  } catch (error) {
    console.error("Democracy Merge function error:", error instanceof Error ? error.message : "Unknown error");
    return fail("Внутренняя ошибка Democracy Merge", 500);
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TelegramUser = { id: number; first_name?: string };

function respond(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function fail(error: string, status: number) {
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
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(botToken));
  const validationKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", validationKey, encoder.encode(checkString));
  const expected = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

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

async function finishSharedGame(db: SupabaseClient, roomId: string, startedAt: string) {
  const { data, error } = await db.rpc("multiplayer_execute_action", {
    p_action: "finish_game",
    p_user_id: "__game_server__",
    p_display_name: "Game server",
    p_payload: { roomId, gameId: "rock-paper-scissors", startedAt },
  });
  if (error) throw error;
  return data;
}

async function broadcast(db: SupabaseClient, roomId: string, event: string) {
  try {
    const channel = db.channel(`room:${roomId}`, { config: { private: true } });
    await channel.send({
      type: "broadcast",
      event,
      payload: { roomId, source: "rock-paper-scissors" },
    });
    await db.removeChannel(channel);
  } catch (error) {
    console.warn("Rock Paper Scissors broadcast failed", error);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return fail("Method not allowed", 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!url || !serviceKey || !botToken) return fail("Server configuration missing", 500);

    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail("Invalid request body", 400);
    }

    const actions = ["start_match", "get_match", "submit_choice", "return_to_room"];
    if (!actions.includes(body.action)) return fail("Unknown Rock Paper Scissors action", 400);

    const initData = typeof body.initData === "string" ? body.initData : "";
    if (!initData || initData.length > 10000) return fail("Invalid Telegram data", 400);
    const user = await verifyTelegram(initData, botToken);
    if (!user) return fail("Telegram verification failed", 401);

    const userId = String(user.id);
    const displayName = user.first_name?.trim().slice(0, 100) || "Игрок";
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(roomId)) return fail("A valid roomId is required", 400);

    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (body.action === "start_match") {
      const { data, error } = await db.rpc("rock_paper_scissors_start_match", {
        p_room_id: roomId,
        p_user_id: userId,
        p_display_name: displayName,
      });
      if (error) {
        console.warn("Rock Paper Scissors start failed", error.code);
        return fail("Не удалось начать матч. Проверьте, что в комнате ровно два игрока и все готовы.", 409);
      }
      await broadcast(db, roomId, "match_started");
      return respond(data);
    }

    if (body.action === "return_to_room") {
      const { data: snapshot, error } = await db.rpc("rock_paper_scissors_match_snapshot", {
        p_room_id: roomId,
        p_user_id: userId,
      });
      if (error) return fail("Не удалось получить состояние матча", 409);
      if (snapshot?.match?.status !== "completed") return fail("Матч ещё не завершён", 409);

      const returnedRoom = snapshot.room?.status === "playing"
        ? await finishSharedGame(db, roomId, snapshot.match.startedAt)
        : snapshot.room;
      await broadcast(db, roomId, "room_finished");
      return respond({ room: returnedRoom });
    }

    if (body.action === "submit_choice") {
      const matchId = typeof body.matchId === "string" ? body.matchId : "";
      const roundNumber = Number(body.roundNumber);
      const choice = typeof body.choice === "string" ? body.choice : "";
      if (!/^[0-9a-f-]{36}$/i.test(matchId)) return fail("A valid matchId is required", 400);
      if (!Number.isInteger(roundNumber) || roundNumber < 1) return fail("Invalid round number", 400);
      if (!["rock", "scissors", "paper"].includes(choice)) return fail("Invalid choice", 400);

      const { data, error } = await db.rpc("rock_paper_scissors_submit_choice", {
        p_room_id: roomId,
        p_match_id: matchId,
        p_round_number: roundNumber,
        p_user_id: userId,
        p_choice: choice,
      });
      if (error) return fail("Выбор не принят. Возможно, время уже вышло.", 409);
      await broadcast(db, roomId, "choice_updated");
      return respond(data);
    }

    const matchId = typeof body.matchId === "string" ? body.matchId : "";
    if (matchId && !/^[0-9a-f-]{36}$/i.test(matchId)) return fail("Invalid matchId", 400);

    const { data: snapshot, error } = await db.rpc("rock_paper_scissors_match_snapshot", {
      p_room_id: roomId,
      p_user_id: userId,
    });
    if (error) return fail("Не удалось получить состояние матча", 403);

    if (matchId && snapshot?.match?.matchId && matchId !== snapshot.match.matchId) {
      return fail("Матч уже изменился. Обновите игру.", 409);
    }

    if (snapshot?.advanced) {
      await broadcast(
        db,
        roomId,
        snapshot.match?.status === "completed" ? "match_finished" : "round_updated",
      );
    }
    return respond(snapshot);
  } catch (error) {
    console.error(
      "Rock Paper Scissors function error",
      error instanceof Error ? error.message : "Unknown error",
    );
    return fail("Внутренняя ошибка Rock Paper Scissors", 500);
  }
});

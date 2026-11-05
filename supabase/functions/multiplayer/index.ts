import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-multiplayer-game-server-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JWT_KEY_ID = "d27b354d-84aa-4d2a-864e-e953408cb575";
const TOKEN_LIFETIME_SECONDS = 3600;
const GAME_SERVER_USER_ID = "__game_server__";

type TelegramUser = { id: number; first_name?: string; username?: string };

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("Invalid hash");
  return new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}

function constantTimeEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index++) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
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
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(botToken));
  const validationKey = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const calculated = await crypto.subtle.sign("HMAC", validationKey, encoder.encode(checkString));
  const expected = [...new Uint8Array(calculated)].map((b) => b.toString(16).padStart(2, "0")).join("");
  let receivedBytes: Uint8Array;
  let expectedBytes: Uint8Array;
  try {
    receivedBytes = hexToBytes(hash);
    expectedBytes = hexToBytes(expected);
  } catch {
    return null;
  }
  if (receivedBytes.length !== expectedBytes.length) return null;
  let diff = 0;
  for (let i = 0; i < receivedBytes.length; i++) diff |= receivedBytes[i] ^ expectedBytes[i];
  if (diff !== 0) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null");
    return user?.id && Number.isSafeInteger(user.id) ? user as TelegramUser : null;
  } catch {
    return null;
  }
}

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signRoomToken(telegramId: string, roomId: string, jwkText: string) {
  const jwk = JSON.parse(jwkText);
  if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || typeof jwk?.d !== "string") {
    throw new Error("Invalid ES256 private JWK");
  }
  const now = Math.floor(Date.now() / 1000);
  const expires = now + TOKEN_LIFETIME_SECONDS;
  const encodedHeader = base64Url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: JWT_KEY_ID }));
  const encodedPayload = base64Url(JSON.stringify({
    iss: "supabase",
    aud: "authenticated",
    role: "authenticated",
    sub: telegramId,
    telegram_id: telegramId,
    room_id: roomId,
    iat: now,
    exp: expires,
  }));
  const input = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input),
  );
  return {
    accessToken: `${input}.${base64Url(new Uint8Array(signature))}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

function respond(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}
function fail(message: string, status: number): Response {
  return respond({ error: message }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      console.error("Missing required server configuration");
      return fail("Server configuration missing", 500);
    }

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid request body", 400);
    const action = body.action;
    const gameServerActions = ["start_game", "finish_game"];
    const publicActions = [
      "create_room", "join_room", "get_room", "set_ready",
      "leave_room", "close_room", "heartbeat", "get_room_token",
    ];
    if (typeof action !== "string" || ![...publicActions, ...gameServerActions].includes(action)) {
      return fail("Unknown multiplayer action", 400);
    }

    const isGameServerAction = gameServerActions.includes(action);
    let telegramId = GAME_SERVER_USER_ID;
    let displayName = "Game server";

    if (isGameServerAction) {
      const expectedSecret = Deno.env.get("MULTIPLAYER_GAME_SERVER_SECRET");
      const receivedSecret = req.headers.get("x-multiplayer-game-server-secret") ?? "";
      if (!expectedSecret || expectedSecret.length < 32) {
        console.error("MULTIPLAYER_GAME_SERVER_SECRET is missing or too short");
        return fail("Game server authentication is not configured", 503);
      }
      if (!constantTimeEquals(receivedSecret, expectedSecret)) {
        return fail("Game server authentication failed", 401);
      }
    } else {
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
      if (!botToken) {
        console.error("Missing TELEGRAM_BOT_TOKEN secret");
        return fail("Server configuration missing", 500);
      }
      if (typeof body.initData !== "string" || body.initData.length === 0 || body.initData.length > 10000) {
        return fail("Invalid Telegram data", 400);
      }
      const user = await verifyTelegram(body.initData, botToken);
      if (!user) return fail("Telegram verification failed", 401);
      telegramId = String(user.id);
      displayName = user.first_name?.trim().slice(0, 100) || "Игрок";
    }

    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const payload: Record<string, unknown> = {};

    if (action === "create_room") {
      payload.gameId = body.gameId;
      if (body.maxPlayers !== undefined) payload.maxPlayers = body.maxPlayers;
    } else if (action === "join_room") {
      payload.inviteCode = body.inviteCode;
    } else {
      payload.roomId = body.roomId;
      if (action === "set_ready") payload.isReady = body.isReady;
      if (action === "finish_game") payload.startedAt = body.startedAt;
    }

    const { data, error } = await supabase.rpc("multiplayer_execute_action", {
      p_action: action,
      p_user_id: telegramId,
      p_display_name: displayName,
      p_payload: payload,
    });

    if (error) {
      console.warn("Multiplayer action rejected:", action, error.code, error.message);
      if (error.code === "P0002") return fail("Комната не найдена", 404);
      if (error.code === "42501") return fail("Недостаточно прав для этой операции", 403);
      if (error.code === "23505") return fail("Игрок уже состоит в комнате", 409);
      if (error.code === "55000" || error.code === "54000") return fail(error.message, 409);
      if (error.code === "22023") return fail(error.message, 400);
      return fail("Не удалось выполнить действие с комнатой", 500);
    }

    if (action === "get_room_token") {
      const privateJwk = Deno.env.get("MULTIPLAYER_JWT_PRIVATE_JWK");
      if (!privateJwk) {
        console.error("Missing MULTIPLAYER_JWT_PRIVATE_JWK secret");
        return fail("Room token service is not configured", 503);
      }
      try {
        const roomId = (data as { roomId: string }).roomId;
        return respond({ roomId, ...await signRoomToken(telegramId, roomId, privateJwk) });
      } catch (error) {
        console.error("Room token signing failed:", error instanceof Error ? error.message : "Unknown error");
        return fail("Не удалось выпустить токен комнаты", 503);
      }
    }

    // Notify subscribers after the database transaction has committed.
    const roomId = (data as { roomId?: string } | null)?.roomId;
    const eventByAction: Record<string, string> = {
      create_room: "room_updated",
      join_room: "player_joined",
      set_ready: "player_updated",
      leave_room: "player_left",
      close_room: "room_updated",
      start_game: "room_updated",
      finish_game: "room_finished",
    };
    const event = eventByAction[action];
    if (roomId && event) {
      try {
        const channel = supabase.channel(`room:${roomId}`, { config: { private: true } });
        const sent = await channel.send({
          type: "broadcast",
          event,
          payload: isGameServerAction
            ? { roomId, source: "game_module" }
            : { roomId, changedBy: telegramId },
        });
        if (sent !== "ok") console.warn("Multiplayer broadcast was not acknowledged:", sent);
        await supabase.removeChannel(channel);
      } catch (broadcastError) {
        console.warn(
          "Multiplayer broadcast failed:",
          broadcastError instanceof Error ? broadcastError.message : "Unknown error",
        );
      }
    }

    return respond(data);
  } catch (error) {
    console.error("Multiplayer function error:", error instanceof Error ? error.message : "Unknown error");
    return fail("Unexpected server error", 500);
  }
});

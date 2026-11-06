import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TelegramUser = { id: number; first_name?: string; username?: string };
type ServerQuestion = {
  id: number;
  category: "logic" | "math" | "attention" | "general";
  question: string;
  answers: string[];
  correctAnswer: number;
  explanation: string;
};

const questionBank: ServerQuestion[] = [
  { id: 1, category: "logic", question: "Какое число должно быть следующим: 2, 4, 8, 16, ...?", answers: ["24", "30", "32", "36"], correctAnswer: 2, explanation: "Каждое число умножается на 2." },
  { id: 2, category: "logic", question: "У всех кошек четыре лапы. У Мурки четыре лапы. Значит ли это, что Мурка — кошка?", answers: ["Да", "Нет", "Всегда", "Невозможно определить"], correctAnswer: 3, explanation: "Четыре лапы есть не только у кошек." },
  { id: 3, category: "logic", question: "Что становится больше, если его перевернуть вверх ногами?", answers: ["Число 6", "Число 8", "Число 9", "Число 3"], correctAnswer: 0, explanation: "Перевёрнутая шестёрка становится девяткой." },
  { id: 4, category: "math", question: "Сколько будет 15 × 4?", answers: ["45", "50", "60", "65"], correctAnswer: 2, explanation: "15 × 4 = 60." },
  { id: 5, category: "math", question: "У тебя было 100 монет. Ты потратил 35. Сколько осталось?", answers: ["55", "65", "75", "85"], correctAnswer: 1, explanation: "100 − 35 = 65." },
  { id: 6, category: "math", question: "Какое число составляет половину от 90?", answers: ["35", "40", "45", "50"], correctAnswer: 2, explanation: "90 ÷ 2 = 45." },
  { id: 7, category: "attention", question: "Сколько букв «А» в слове «КАРАНДАШ»?", answers: ["1", "2", "3", "4"], correctAnswer: 1, explanation: "В слове КАРАНДАШ две буквы А." },
  { id: 8, category: "attention", question: "Какого цвета обычно бывает спелый лимон?", answers: ["Красный", "Синий", "Жёлтый", "Зелёный"], correctAnswer: 2, explanation: "Спелые лимоны обычно жёлтые." },
  { id: 9, category: "general", question: "Какая планета известна как Красная планета?", answers: ["Венера", "Марс", "Юпитер", "Сатурн"], correctAnswer: 1, explanation: "Марс имеет характерный красноватый оттенок." },
  { id: 10, category: "general", question: "Сколько континентов традиционно выделяют в школьной географии?", answers: ["5", "6", "7", "8"], correctAnswer: 2, explanation: "В распространённой модели выделяют семь континентов." },
];

function selectQuestions(): ServerQuestion[] {
  const shuffled = [...questionBank];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function respond(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function fail(message: string, status: number): Response {
  return respond({ error: message }, status);
}

function errorResponse(error: { code?: string; message?: string }): Response {
  if (error.code === "P0002") return fail("Комната или матч не найдены", 404);
  if (error.code === "42501") return fail("Недостаточно прав для этой операции", 403);
  if (error.code === "55000" || error.code === "54000") return fail(error.message ?? "Действие сейчас недоступно", 409);
  if (error.code === "22023") return fail(error.message ?? "Некорректный запрос", 400);
  if (error.code === "23505") return fail("Ответ на этот вопрос уже отправлен", 409);
  return fail("Не удалось выполнить действие Brain Battle", 500);
}

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
  const calculated = await crypto.subtle.sign("HMAC", validationKey, encoder.encode(checkString));
  const expected = [...new Uint8Array(calculated)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

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
  for (let index = 0; index < receivedBytes.length; index++) difference |= receivedBytes[index] ^ expectedBytes[index];
  if (difference !== 0) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null");
    return user?.id && Number.isSafeInteger(user.id) ? user as TelegramUser : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!supabaseUrl || !serviceKey || !botToken) {
      console.error("Missing Brain Battle server configuration");
      return fail("Server configuration missing", 500);
    }

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid request body", 400);
    const action = body.action;
    if (!["start_match", "submit_answer", "get_match"].includes(action)) return fail("Unknown Brain Battle action", 400);

    const initData = typeof body.initData === "string" ? body.initData : "";
    if (!initData || initData.length > 10000) return fail("Invalid Telegram data", 400);
    const user = await verifyTelegram(initData, botToken);
    if (!user) return fail("Telegram verification failed", 401);

    const userId = String(user.id);
    const displayName = user.first_name?.trim().slice(0, 100) || "Игрок";
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    if (!roomId || roomId.length > 80) return fail("A valid roomId is required", 400);

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "start_match") {
      const { data: room, error: roomError } = await supabase.rpc("multiplayer_execute_action", {
        p_action: "get_room",
        p_user_id: userId,
        p_display_name: displayName,
        p_payload: { roomId },
      });
      if (roomError) return errorResponse(roomError);
      if (!room || room.gameId !== "brain-battle") return fail("В комнате должна быть выбрана Brain Battle", 409);
      const member = Array.isArray(room.players)
        ? room.players.find((player: { userId?: string }) => player.userId === userId)
        : null;
      if (!member) return fail("Вы не участник этой комнаты", 403);
      if (!member.isHost) return fail("Начать матч может только ведущий комнаты", 403);

      const { data, error } = await supabase.rpc("brain_battle_start_match", {
        p_room_id: roomId,
        p_user_id: userId,
        p_questions: selectQuestions(),
      });
      if (error) return errorResponse(error);
      await broadcast(supabase, roomId, "match_started", data);
      return respond(data);
    }

    if (action === "submit_answer") {
      const matchId = typeof body.matchId === "string" ? body.matchId : "";
      const questionIndex = Number(body.questionIndex);
      const selectedAnswer = body.selectedAnswer === null ? null : Number(body.selectedAnswer);
      if (!matchId || !Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex > 9) {
        return fail("A valid matchId and questionIndex are required", 400);
      }
      if (selectedAnswer !== null && (!Number.isInteger(selectedAnswer) || selectedAnswer < 0 || selectedAnswer > 3)) {
        return fail("A valid selectedAnswer is required", 400);
      }
      const { data, error } = await supabase.rpc("brain_battle_submit_answer", {
        p_room_id: roomId,
        p_match_id: matchId,
        p_user_id: userId,
        p_question_index: questionIndex,
        p_selected_answer: selectedAnswer,
      });
      if (error) return errorResponse(error);
      const advanced = data?.advance;
      await broadcast(
        supabase,
        roomId,
        advanced?.matchFinished ? "match_finished" : advanced?.status === "advanced" ? "question_advanced" : "answer_submitted",
        { questionIndex, userId },
      );
      return respond(data);
    }

    const { data: room, error: roomError } = await supabase.rpc("multiplayer_execute_action", {
      p_action: "get_room",
      p_user_id: userId,
      p_display_name: displayName,
      p_payload: { roomId },
    });
    if (roomError) return errorResponse(roomError);
    if (!room || room.gameId !== "brain-battle") return fail("В комнате должна быть выбрана Brain Battle", 409);

    const { data: activeMatch, error: matchError } = await supabase
      .from("games_brain_battle_matches")
      .select("id")
      .eq("room_id", roomId)
      .eq("status", "playing")
      .maybeSingle();
    if (matchError) return errorResponse(matchError);

    if (activeMatch?.id) {
      const { data: advance, error: advanceError } = await supabase.rpc("brain_battle_advance_if_due", {
        p_room_id: roomId,
        p_match_id: activeMatch.id,
      });
      if (advanceError) return errorResponse(advanceError);
      if (advance?.status === "advanced" || advance?.matchFinished) {
        await broadcast(supabase, roomId, advance.matchFinished ? "match_finished" : "question_advanced", advance);
      }
    }

    const { data, error } = await supabase.rpc("brain_battle_match_snapshot", {
      p_room_id: roomId,
      p_user_id: userId,
    });
    if (error) return errorResponse(error);
    return respond(data);
  } catch (error) {
    console.error("Brain Battle function error:", error instanceof Error ? error.message : "Unknown error");
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
      payload: { roomId, source: "brain-battle", data },
    });
    if (sent !== "ok") console.warn("Brain Battle broadcast was not acknowledged:", sent);
    await supabase.removeChannel(channel);
  } catch (error) {
    console.warn("Brain Battle broadcast failed:", error instanceof Error ? error.message : "Unknown error");
  }
}

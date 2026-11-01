
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ServerQuestion = {
  id: number;
  category: "logic" | "math" | "attention" | "general";
  question: string;
  answers: string[];
  correctAnswer: number;
  explanation: string;
};

const brainBattleQuestions: ServerQuestion[] = [
  {
    id: 1,
    category: "logic",
    question: "Какое число должно быть следующим: 2, 4, 8, 16, ...?",
    answers: ["24", "30", "32", "36"],
    correctAnswer: 2,
    explanation: "Каждое число умножается на 2.",
  },
  {
    id: 2,
    category: "logic",
    question:
      "У всех кошек четыре лапы. У Мурки четыре лапы. Значит ли это, что Мурка — кошка?",
    answers: ["Да", "Нет", "Всегда", "Невозможно определить"],
    correctAnswer: 3,
    explanation: "Четыре лапы есть не только у кошек.",
  },
  {
    id: 3,
    category: "logic",
    question: "Что становится больше, если его перевернуть вверх ногами?",
    answers: ["Число 6", "Число 8", "Число 9", "Число 3"],
    correctAnswer: 0,
    explanation: "Перевёрнутая шестёрка становится девяткой.",
  },
  {
    id: 4,
    category: "math",
    question: "Сколько будет 15 × 4?",
    answers: ["45", "50", "60", "65"],
    correctAnswer: 2,
    explanation: "15 × 4 = 60.",
  },
  {
    id: 5,
    category: "math",
    question: "У тебя было 100 монет. Ты потратил 35. Сколько осталось?",
    answers: ["55", "65", "75", "85"],
    correctAnswer: 1,
    explanation: "100 − 35 = 65.",
  },
  {
    id: 6,
    category: "math",
    question: "Какое число составляет половину от 90?",
    answers: ["35", "40", "45", "50"],
    correctAnswer: 2,
    explanation: "90 ÷ 2 = 45.",
  },
  {
    id: 7,
    category: "attention",
    question: "Сколько букв «А» в слове «КАРАНДАШ»?",
    answers: ["1", "2", "3", "4"],
    correctAnswer: 1,
    explanation: "В слове КАРАНДАШ две буквы А.",
  },
  {
    id: 8,
    category: "attention",
    question: "Какого цвета обычно бывает спелый лимон?",
    answers: ["Красный", "Синий", "Жёлтый", "Зелёный"],
    correctAnswer: 2,
    explanation: "Спелые лимоны обычно жёлтые.",
  },
  {
    id: 9,
    category: "general",
    question: "Какая планета известна как Красная планета?",
    answers: ["Венера", "Марс", "Юпитер", "Сатурн"],
    correctAnswer: 1,
    explanation: "Марс имеет характерный красноватый оттенок.",
  },
  {
    id: 10,
    category: "general",
    question: "Сколько континентов традиционно выделяют в школьной географии?",
    answers: ["5", "6", "7", "8"],
    correctAnswer: 2,
    explanation: "В распространённой модели выделяют семь континентов.",
  },
];

function selectServerQuestions(count = 10): ServerQuestion[] {
  const shuffled = [...brainBattleQuestions];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
}

type TelegramUser = {
  id: number;
  first_name?: string;
  username?: string;
};

type SubmitAnswerResult = {
  success: boolean;
  status: "waiting" | "advanced" | "finished";
  currentQuestionIndex: number;
  questionStartedAt: string | null;
  questionEndsAt: string | null;
  score: number;
  winnerTelegramId?: string | null;
};

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};

async function callBrainBattleRpc(
  supabase: any,
  functionName: string,
  params: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(functionName, params);

  return { data, error };
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("Invalid hash");
  }

  return new Uint8Array(
    hex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
  );
}

async function verifyTelegram(
  initData: string,
  botToken: string,
): Promise<TelegramUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));

  if (!hash || !Number.isFinite(authDate)) return null;

  const now = Math.floor(Date.now() / 1000);

  if (now - authDate > 3600 || authDate > now + 30) {
    return null;
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
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

  const secret = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    encoder.encode(botToken),
  );

  const validationKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const calculated = await crypto.subtle.sign(
    "HMAC",
    validationKey,
    encoder.encode(dataCheckString),
  );

  const calculatedHash = [...new Uint8Array(calculated)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const received = hexToBytes(hash);
  const expected = hexToBytes(calculatedHash);

  if (received.length !== expected.length) return null;

  let difference = 0;

  for (let i = 0; i < received.length; i++) {
    difference |= received[i] ^ expected[i];
  }

  if (difference !== 0) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null");
    return user?.id ? user as TelegramUser : null;
  } catch {
    return null;
  }
}

async function submitBrainBattleAnswer(
  supabase: {
    rpc: (...args: any[]) => any;
  },
  roomId: string,
  telegramId: string,
  questionIndex: number,
  selectedAnswer: number | null,
):
Promise<SubmitAnswerResult> {
  const { data, error } = await callBrainBattleRpc(
    supabase,
    "submit_brain_battle_answer",
    {
      p_room_id: roomId,
      p_telegram_id: telegramId,
      p_question_index: questionIndex,
      p_selected_answer: selectedAnswer,
    },
  );

  if (error) {
    console.error("Submit answer error:", error.message);
    throw new Error("Не удалось отправить ответ");
  }

  return data as SubmitAnswerResult;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const respond = (body: unknown, status = 200): Response => {
    return Response.json(body, { status, headers: corsHeaders });
  };

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!botToken || !supabaseUrl || !serviceKey) {
      console.error("Missing server configuration");
      return respond({ error: "Server configuration missing" }, 500);
    }

    const body = await req.json();
    const initData = body?.initData;
    const action = body?.action;

    const roomId =
      typeof body?.roomId === "string" ? body.roomId.trim() : "";

    const questionIndex = Number.isInteger(body?.questionIndex)
      ? body.questionIndex as number
      : undefined;

    const selectedAnswer =
      body?.selectedAnswer === null
        ? null
        : Number.isInteger(body?.selectedAnswer)
          ? body.selectedAnswer as number
          : undefined;

    const inviteCode =
      typeof body?.inviteCode === "string"
        ? body.inviteCode.trim().toLowerCase()
        : "";

    if (
      typeof action !== "string" ||
      !["check", "create", "join", "ready", "get", "submit"].includes(action)
    ) {
      return respond({ error: "Unknown action" }, 400);
    }

    if (
      typeof initData !== "string" ||
      initData.length === 0 ||
      initData.length > 10000
    ) {
      return respond({ error: "Invalid Telegram data" }, 400);
    }

    if (action === "submit") {
      if (!roomId) {
        return respond({ error: "Не указан идентификатор комнаты" }, 400);
      }

      if (
        questionIndex === undefined ||
        questionIndex < 0 ||
        questionIndex > 9
      ) {
        return respond({ error: "Некорректный индекс вопроса" }, 400);
      }

      if (
        selectedAnswer !== null &&
        (selectedAnswer === undefined ||
          selectedAnswer < 0 ||
          selectedAnswer > 3)
      ) {
        return respond({ error: "Некорректный вариант ответа" }, 400);
      }
    }

    const user = await verifyTelegram(initData, botToken);

    if (!user) {
      return respond({ error: "Telegram verification failed" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const telegramId = String(user.id);
    const playerName = user.first_name?.trim().slice(0, 100) || "Игрок";

    console.log("Authenticated BRAIN BATTLE request:", telegramId);

    // Проверка доступности сервера.
    if (action === "check") {
      return respond({
        success: true,
        message: "BRAIN BATTLE server is ready",
        player: {
          telegram_id: telegramId,
          player_name: playerName,
        },
      });
    }

    // Отправка ответа на вопрос.
    if (action === "submit") {
      try {
        const result = await submitBrainBattleAnswer(
          supabase,
          roomId,
          telegramId,
          questionIndex!,
          selectedAnswer!,
        );

        return respond({
          success: true,
          result,
        });
      } catch (error) {
        return respond(
          {
            error: error instanceof Error
              ? error.message
              : "Не удалось отправить ответ",
          },
          400,
        );
      }
    }

    // Получение состояния комнаты и обработка тайм-аута.
    if (action === "get") {
      if (!roomId) {
        return respond({ error: "Не указан идентификатор комнаты" }, 400);
      }

      const { data: room, error: roomError } = await supabase
        .from("brain_battle_rooms")
        .select(`
          id,
          invite_code,
          status,
          player1_telegram_id,
          player2_telegram_id
        `)
        .eq("id", roomId)
        .maybeSingle();

      if (roomError) {
        console.error("Room state error:", roomError.message);
        return respond(
          { error: "Не удалось получить состояние комнаты" },
          500,
        );
      }

      if (!room) {
        return respond({ error: "Комната не найдена" }, 404);
      }

      const isPlayer =
        room.player1_telegram_id === telegramId ||
        room.player2_telegram_id === telegramId;

      if (!isPlayer) {
        return respond(
          { error: "Вы не участник этой комнаты" },
          403,
        );
      }

      // Проверяем, не истекло ли время текущего вопроса.
      const { error: advanceError } = await callBrainBattleRpc(
        supabase,
        "advance_brain_battle_if_due",
        { p_room_id: roomId },
      );

      if (advanceError) {
        console.error(
          "Battle timeout processing error:",
          advanceError.message,
        );
        return respond(
          { error: "Не удалось обновить состояние игры" },
          500,
        );
      }

      // Повторно читаем комнату после возможного перехода.
      const { data: updatedRoom, error: updatedRoomError } = await supabase
        .from("brain_battle_rooms")
        .select(`
          id,
          invite_code,
          status,
          current_question_index,
          started_at,
          question_started_at,
          question_ends_at,
          winner_telegram_id
        `)
        .eq("id", roomId)
        .single();

      if (updatedRoomError || !updatedRoom) {
        return respond(
          { error: "Не удалось получить обновлённое состояние комнаты" },
          500,
        );
      }

            const questions = updatedRoom.status === "playing"
        ? await supabase
            .from("brain_battle_rooms")
            .select("questions")
            .eq("id", roomId)
            .single()
        : null;

      if (questions?.error) {
        console.error("Question loading error:", questions.error.message);
        return respond(
          { error: "Не удалось загрузить текущий вопрос" },
          500,
        );
      }

      const rawQuestion =
        questions?.data?.questions?.[updatedRoom.current_question_index];

      const currentQuestion = rawQuestion
        ? {
            id: rawQuestion.id,
            category: rawQuestion.category,
            question: rawQuestion.question,
            answers: rawQuestion.answers,
          }
        : null;

      const { data: players, error: playersError } = await supabase
        .from("brain_battle_players")
        .select(`
          telegram_id,
          player_name,
          is_ready,
          correct_answers,
          incorrect_answers,
          skipped_questions,
          total_score
        `)
        .eq("room_id", roomId);

      if (playersError) {
        console.error("Players state error:", playersError.message);
        return respond(
          { error: "Не удалось получить состояние игроков" },
          500,
        );
      }

      return respond({
        success: true,
        room: {
          id: updatedRoom.id,
          invite_code: updatedRoom.invite_code,
          status: updatedRoom.status,
          current_question_index: updatedRoom.current_question_index,
          started_at: updatedRoom.started_at,
          question_started_at: updatedRoom.question_started_at,
          question_ends_at: updatedRoom.question_ends_at,
          winner_telegram_id: updatedRoom.winner_telegram_id,
        },
        players: players ?? [],
                currentQuestion,
      });
    }

    // Создание комнаты.
    if (action === "create") {
      const { data: room, error: roomError } = await supabase
        .from("brain_battle_rooms")
        .insert({
          player1_telegram_id: telegramId,
          player1_name: playerName,
          status: "waiting",
          questions: selectServerQuestions(10),
        })
        .select("id, invite_code, status")
        .single();

      if (roomError || !room) {
        console.error("Room creation error:", roomError?.message);
        return respond(
          { error: "Не удалось создать комнату" },
          500,
        );
      }

      const { error: playerError } = await supabase
        .from("brain_battle_players")
        .insert({
          room_id: room.id,
          telegram_id: telegramId,
          player_name: playerName,
        });

      if (playerError) {
        console.error("Player creation error:", playerError.message);

        await supabase
          .from("brain_battle_rooms")
          .delete()
          .eq("id", room.id);

        return respond(
          { error: "Не удалось добавить игрока в комнату" },
          500,
        );
      }

      return respond({
        success: true,
        room: {
          id: room.id,
          invite_code: room.invite_code,
          status: room.status,
        },
        player: {
          telegram_id: telegramId,
          player_name: playerName,
        },
      });
    }

    // Присоединение к комнате.
    if (action === "join") {
      if (!inviteCode || inviteCode.length > 100) {
        return respond(
          { error: "Некорректный код приглашения" },
          400,
        );
      }

      const { data: room, error: roomError } = await supabase
        .from("brain_battle_rooms")
        .select("id, status, player1_telegram_id, player2_telegram_id")
        .eq("invite_code", inviteCode)
        .maybeSingle();

      if (roomError) {
        console.error("Room lookup error:", roomError.message);
        return respond({ error: "Не удалось найти комнату" }, 500);
      }

      if (!room) {
        return respond({ error: "Комната не найдена" }, 404);
      }

      if (room.status !== "waiting") {
        return respond(
          { error: "Эта комната уже недоступна" },
          400,
        );
      }

      if (room.player1_telegram_id === telegramId) {
        return respond(
          { error: "Нельзя присоединиться к собственной комнате" },
          400,
        );
      }

      if (room.player2_telegram_id) {
        return respond(
          { error: "В комнате уже есть второй игрок" },
          409,
        );
      }

      const { data: claimedRoom, error: claimError } = await supabase
        .from("brain_battle_rooms")
        .update({
          player2_telegram_id: telegramId,
          player2_name: playerName,
        })
        .eq("id", room.id)
        .eq("status", "waiting")
        .is("player2_telegram_id", null)
        .select("id, invite_code, status")
        .maybeSingle();

      if (claimError) {
        console.error("Room join error:", claimError.message);
        return respond(
          { error: "Не удалось присоединиться к комнате" },
          500,
        );
      }

      if (!claimedRoom) {
        return respond(
          { error: "В комнате уже есть второй игрок" },
          409,
        );
      }

      const { error: playerError } = await supabase
        .from("brain_battle_players")
        .insert({
          room_id: room.id,
          telegram_id: telegramId,
          player_name: playerName,
        });

      if (playerError) {
        console.error("Player join error:", playerError.message);

        await supabase
          .from("brain_battle_rooms")
          .update({
            player2_telegram_id: null,
            player2_name: null,
          })
          .eq("id", room.id)
          .eq("player2_telegram_id", telegramId)
          .eq("status", "waiting");

        return respond(
          { error: "Не удалось добавить игрока в комнату" },
          500,
        );
      }

      return respond({
        success: true,
        room: {
          id: claimedRoom.id,
          invite_code: claimedRoom.invite_code,
          status: claimedRoom.status,
        },
        player: {
          telegram_id: telegramId,
          player_name: playerName,
        },
      });
    }

    // Подтверждение готовности.
    if (action === "ready") {
      if (!roomId) {
        return respond(
          { error: "Не указан идентификатор комнаты" },
          400,
        );
      }

      const { data: room, error: roomError } = await supabase
        .from("brain_battle_rooms")
        .select(`
          id,
          status,
          player1_telegram_id,
          player2_telegram_id,
          started_at
        `)
        .eq("id", roomId)
        .maybeSingle();

      if (roomError || !room) {
        return respond({ error: "Комната не найдена" }, 404);
      }

      const isPlayer =
        room.player1_telegram_id === telegramId ||
        room.player2_telegram_id === telegramId;

      if (!isPlayer) {
        return respond(
          { error: "Вы не участник этой комнаты" },
          403,
        );
      }

      if (room.status === "finished") {
        return respond({ error: "Игра уже завершена" }, 400);
      }

      if (!room.player2_telegram_id) {
        return respond({ error: "Ожидаем второго игрока" }, 400);
      }

      if (room.status === "playing") {
        const { data: players, error: playersError } = await supabase
          .from("brain_battle_players")
          .select("telegram_id, is_ready")
          .eq("room_id", roomId);

        if (playersError) {
          return respond(
            { error: "Не удалось получить состояние игроков" },
            500,
          );
        }

        const currentPlayer = players?.find(
          (player) => player.telegram_id === telegramId,
        );

        return respond({
          success: true,
          ready: currentPlayer?.is_ready ?? true,
          started: true,
          started_at: room.started_at,
        });
      }

      const { error: readyError } = await supabase
        .from("brain_battle_players")
        .update({ is_ready: true })
        .eq("room_id", roomId)
        .eq("telegram_id", telegramId);

      if (readyError) {
        console.error("Player ready error:", readyError.message);
        return respond(
          { error: "Не удалось подтвердить готовность" },
          500,
        );
      }

      const { data: startResult, error: startError } =
        await callBrainBattleRpc(
          supabase,
          "start_brain_battle_if_ready",
          { p_room_id: roomId },
        );

      if (startError) {
        console.error("Battle start error:", startError.message);
        return respond(
          { error: "Не удалось проверить готовность игроков" },
          500,
        );
      }

      const result = Array.isArray(startResult)
        ? startResult[0]
        : startResult as {
            started?: boolean;
            started_at?: string | null;
          } | null;

      return respond({
        success: true,
        ready: true,
        started: result?.started ?? false,
        started_at: result?.started_at ?? null,
      });
    }

    return respond({ error: "Неизвестное действие" }, 400);
  } catch (error) {
    console.error(
      "BRAIN BATTLE function error:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return respond({ error: "Unexpected server error" }, 500);
  }
};

Deno.serve(handler);

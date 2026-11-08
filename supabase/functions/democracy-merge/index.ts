import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  generateCharacterSequence,
  isBoardFull,
  placeCharacter,
} from "../../../src/games/DemocracyMerge/logic/gameEngine.ts";
import {
  applyToolReward,
  buyTool,
  generateObstacleSequence,
  placeObstacleAtRandomFreeCell,
  rollMergeRewards,
} from "../../../src/games/DemocracyMerge/logic/events.ts";
import {
  canFreeCellWithTools,
  replaceCurrentCharacter,
  returnStoredCharacter,
  storeCharacter,
  swapCharacters,
  applySaw,
  type ToolInventory,
  type ToolType,
} from "../../../src/games/DemocracyMerge/logic/tools.ts";

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

async function broadcast(db: SupabaseClient, roomId: string, event: string) {
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
    const actions = ["start_match", "get_match", "place_character", "use_tool", "buy_tool", "surrender", "leave_match", "return_to_room"];
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
      return respond({
        room: data.room,
        match: {
          matchId: data.matchId,
          startedAt: data.startedAt,
          gameStartedAt: data.gameStartedAt,
          deadlineAt: data.deadlineAt,
        },
      });
    }

    if (["place_character", "use_tool", "buy_tool", "surrender"].includes(body.action)) {
      const actionStartedAt = new Date().toISOString();
      if (typeof body.actionId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.actionId)) {
        return fail("A valid actionId is required", 400);
      }
      const { data: snapshot, error: snapshotError } = await db.rpc("democracy_merge_match_snapshot", {
        p_room_id: roomId,
        p_user_id: userId,
      });
      if (snapshotError) return fail("Не удалось получить состояние матча", 409);
      const match = snapshot?.match;
      const me = match?.me;
      if (match?.status !== "playing" || me?.status !== "active") {
        return fail("Матч или ваша партия уже завершены", 409);
      }

      const board = me.board;
      let nextBoard = board;
      let inventory = me.inventory as ToolInventory;
      let storage = me.storage;
      let coins = Number(me.coins);
      let score = Number(me.score);
      let maxLevel = Number(me.maxLevel);
      let turnNumber = Number(me.turnNumber);
      let mergeCount = Number(me.mergeCount);
      let chainReactions = Number(me.chainReactions);
      let toolsUsed = Number(me.toolsUsed);
      let level6MergeCount = Number(me.level6MergeCount);
      let status: "active" | "completed" | "surrendered" = "active";
      let result: Record<string, unknown> | null = null;
      const rewards: Array<Record<string, unknown>> = [];

      try {
      if (body.action === "place_character") {
        if (!Number.isInteger(body.cellIndex) || !match.currentCharacter) {
          return fail("Выберите свободную клетку для текущего персонажа", 400);
        }
        const placement = placeCharacter(board, body.cellIndex, match.currentCharacter, level6MergeCount);
        nextBoard = placement.board;
        score += placement.scoreDelta;
        mergeCount += placement.merges.length;
        if (placement.merges.length > 1) chainReactions += 1;
        level6MergeCount = placement.level6MergeCount;
        turnNumber += 1;

        for (const reward of rollMergeRewards(placement.merges.length, secureRandomUnit)) {
          if (reward.kind === "money_bag") {
            coins += reward.coins;
            rewards.push(reward);
          } else {
            const awarded = applyToolReward(inventory, reward.tool);
            inventory = awarded.inventory;
            if (awarded.awarded) rewards.push(reward);
          }
        }

        if (match.obstacleEvent) {
          nextBoard = placeObstacleAtRandomFreeCell(nextBoard, match.obstacleEvent, secureRandomUnit).board;
        }
        const levels = nextBoard.flatMap((cell: { kind: string; level?: number } | null) =>
          cell?.kind === "character" && typeof cell.level === "number" ? [cell.level] : []);
        maxLevel = Math.max(maxLevel, ...levels, 1);
        if (isBoardFull(nextBoard) && !canFreeCellWithTools(nextBoard, inventory, storage, coins)) {
          status = "completed";
        }
      } else if (body.action === "buy_tool") {
        if (!["saw", "storage", "swap", "replace"].includes(body.tool)) return fail("Неизвестный инструмент", 400);
        const purchase = buyTool(inventory, body.tool as ToolType, coins);
        inventory = purchase.inventory;
        coins = purchase.coins;
      } else if (body.action === "use_tool") {
        if (!["saw", "storage", "swap", "replace"].includes(body.tool)) return fail("Неизвестный инструмент", 400);
        if (body.tool === "saw") {
          const used = applySaw(board, body.cellIndex, inventory, coins);
          nextBoard = used.board;
          inventory = used.inventory;
          coins = used.coins;
          toolsUsed += 1;
        } else if (body.tool === "storage") {
          if (body.storageAction === "store") {
            const stored = storeCharacter(board, body.cellIndex, storage, inventory);
            nextBoard = stored.board;
            storage = stored.storage;
            inventory = stored.inventory;
          } else if (body.storageAction === "return") {
            const returned = returnStoredCharacter(board, body.cellIndex, storage, inventory);
            nextBoard = returned.board;
            storage = returned.storage;
            inventory = returned.inventory;
            toolsUsed += 1;
          } else {
            return fail("Укажите действие хранилища", 400);
          }
        } else if (body.tool === "swap") {
          const swapped = swapCharacters(board, body.firstCellIndex, body.secondCellIndex, inventory);
          nextBoard = swapped.board;
          inventory = swapped.inventory;
          toolsUsed += 1;
        } else {
          if (!match.currentCharacter) return fail("Нет текущего персонажа для замены", 409);
          const replaced = replaceCurrentCharacter(match.currentCharacter, inventory);
          inventory = replaced.inventory;
          toolsUsed += 1;
        }
        if (isBoardFull(nextBoard) && !canFreeCellWithTools(nextBoard, inventory, storage, coins)) {
          status = "completed";
        }
      } else {
        status = "surrendered";
      }

      } catch (actionError) {
        return fail(actionError instanceof Error ? actionError.message : "Некорректное действие", 400);
      }

      if (status !== "active") {
        result = {
          score, maxLevel, mergeCount, chainReactions, toolsUsed, coins,
          status, completedAt: new Date().toISOString(),
        };
      }
      const state = {
        // Generated by the trusted Edge Function before reading match state.
        // This lets a placement already in flight at the deadline finish atomically.
        actionStartedAt,
        status,
        board: nextBoard,
        turnNumber,
        score,
        maxLevel,
        mergeCount,
        chainReactions,
        toolsUsed,
        coins,
        inventory,
        storage,
        level6MergeCount,
        result,
        rewards,
      };
      const { data, error } = await db.rpc("democracy_merge_commit_player_action", {
        p_room_id: roomId,
        p_match_id: match.matchId,
        p_user_id: userId,
        p_action_id: body.actionId,
        p_action_type: body.action === "place_character" ? "place_character"
          : body.action === "buy_tool" ? "buy_tool"
          : body.action === "use_tool" ? "use_tool" : "surrender",
        p_expected_revision: me.revision,
        p_state: state,
      });
      if (error) {
        const statusCode = error.code === "40001" ? 409 : 400;
        return fail(error.code === "40001" ? "Состояние изменилось. Обновите матч и повторите действие." : "Не удалось сохранить действие", statusCode);
      }
      await broadcast(db, roomId, "match_updated");
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
      if (snapshot?.room?.status === "cancelled") {
        return respond({ room: snapshot.room, closed: true });
      }
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

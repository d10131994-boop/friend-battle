import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { NO_COUNT_IT_SERVER_TEXTS } from "./texts.ts";
import { generateCandyJarScene } from "../_shared/no_count_it_scene/sceneGenerator.ts";
import { renderCandyJarSvg } from "../_shared/no_count_it_scene/svgRenderer.ts";
import type { NoCountItScene } from "../_shared/no_count_it_scene/types.ts";
import { selectNoCountItBackground } from "./backgroundAssets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
type TelegramUser = { id: number; first_name?: string };

function respond(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}
function fail(error: string, status: number) { return respond({ error }, status); }

async function verifyTelegram(initData: string, botToken: string): Promise<TelegramUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!hash || !Number.isFinite(authDate)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 3600 || authDate > now + 30) return null;
  params.delete("hash");
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey("raw", encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(botToken));
  const validationKey = await crypto.subtle.importKey("raw", secret,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", validationKey, encoder.encode(checkString));
  const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!/^[0-9a-f]{64}$/i.test(hash) || hash.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.toLowerCase().charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null");
    return user?.id && Number.isSafeInteger(user.id) ? user as TelegramUser : null;
  } catch { return null; }
}

type Scene = NoCountItScene;

async function uploadScene(db:SupabaseClient,roomId:string,round:number){
  let scene:Scene|undefined;
  let lastError:unknown;
  for(let attempt=0;attempt<5&&!scene;attempt++){
    try{scene=generateCandyJarScene({seed:crypto.randomUUID()});}catch(error){lastError=error;}
  }
  if(!scene)throw lastError??new Error("Could not generate a valid candy scene.");
  const background=selectNoCountItBackground(scene.seed);
  const svg=renderCandyJarSvg(scene,{backgroundImageDataUri:background.dataUri});
  const blob=new Blob([svg],{type:"image/svg+xml"});
  if(blob.size>1_048_576)throw new Error("Generated NoCountIt scene exceeds the Storage bucket size limit.");
  const path=`${roomId}/round-${round}/${crypto.randomUUID()}.svg`;
  const {error}=await db.storage.from("no-count-it-scenes").upload(path,blob,{contentType:"image/svg+xml",upsert:false});
  if(error)throw error;
  return {scene,path};
}
async function finishSharedGame(db:SupabaseClient,roomId:string,startedAt:string){
 const {data,error}=await db.rpc("multiplayer_execute_action",{p_action:"finish_game",p_user_id:"__game_server__",p_display_name:"Game server",p_payload:{roomId,gameId:"no-count-it",startedAt}});
 if(error)throw error;
 return data;
}
async function broadcast(db:SupabaseClient,roomId:string,event:string){
 try{const channel=db.channel(`room:${roomId}`,{config:{private:true}});
  await channel.send({type:"broadcast",event,payload:{roomId,source:"no-count-it"}});
  await db.removeChannel(channel);
 }catch(error){console.warn("NoCountIt broadcast failed",error);}
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return fail(NO_COUNT_IT_SERVER_TEXTS.methodNotAllowed,405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),token=Deno.env.get("TELEGRAM_BOT_TOKEN");
  if(!url||!key||!token)return fail(NO_COUNT_IT_SERVER_TEXTS.serverConfigurationMissing,500);
  const body=await req.json();
  if(!body||typeof body!=="object"||Array.isArray(body))return fail(NO_COUNT_IT_SERVER_TEXTS.invalidRequestBody,400);
  const actions=["start_match","get_match","round_ready","submit_answer","return_to_room","early_exit"];
  if(!actions.includes(body.action))return fail(NO_COUNT_IT_SERVER_TEXTS.unknownAction,400);
  const initData=typeof body.initData==="string"?body.initData:"";
  if(!initData||initData.length>10000)return fail(NO_COUNT_IT_SERVER_TEXTS.invalidTelegramData,400);
  const user=await verifyTelegram(initData,token);
  if(!user)return fail(NO_COUNT_IT_SERVER_TEXTS.telegramVerificationFailed,401);
  const userId=String(user.id),displayName=user.first_name?.trim().slice(0,100)||"Игрок";
  const roomId=typeof body.roomId==="string"?body.roomId.trim():"";
  if(!/^[0-9a-f-]{36}$/i.test(roomId))return fail(NO_COUNT_IT_SERVER_TEXTS.validRoomIdRequired,400);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

  if(body.action==="return_to_room"){
    const {data:snapshot,error:snapshotError}=await db.rpc("no_count_it_match_snapshot",{p_room_id:roomId,p_user_id:userId});
    if(snapshotError)return fail(NO_COUNT_IT_SERVER_TEXTS.matchStateUnavailable,409);
    if(snapshot?.match?.status!=="completed" && snapshot?.match?.status!=="technical_aborted")return fail(NO_COUNT_IT_SERVER_TEXTS.matchNotFinished,409);
    const finishedRoom=await finishSharedGame(db,roomId,snapshot.match.startedAt);
    await broadcast(db,roomId,"room_finished");
    return respond({room:finishedRoom});
  }

  if(body.action==="early_exit"){
    const earlyExitMatchId=typeof body.matchId==="string"?body.matchId:"";
    if(!/^[0-9a-f-]{36}$/i.test(earlyExitMatchId))return fail(NO_COUNT_IT_SERVER_TEXTS.validMatchIdRequired,400);
    const {data,error}=await db.rpc("no_count_it_exit_early",{p_room_id:roomId,p_match_id:earlyExitMatchId,p_user_id:userId});
    if(error)return fail(NO_COUNT_IT_SERVER_TEXTS.earlyExitFailed,409);
    await broadcast(db,roomId,"room_finished");
    return respond(data);
  }

  if(body.action==="start_match"){
    const {data:room,error}=await db.rpc("multiplayer_execute_action",{p_action:"get_room",p_user_id:userId,p_display_name:displayName,p_payload:{roomId}});
    if(error)return fail(NO_COUNT_IT_SERVER_TEXTS.roomCheckFailed,403);
    if(room?.gameId!=="no-count-it")return fail(NO_COUNT_IT_SERVER_TEXTS.gameSelectionRequired,409);
    const member=room.players?.find((p:{userId:string})=>p.userId===userId);
    if(!member||!member.isHost)return fail(NO_COUNT_IT_SERVER_TEXTS.hostOnlyStart,403);
    const {scene,path}=await uploadScene(db,roomId,1);
    const {data,error:startError}=await db.rpc("no_count_it_start_match",{p_room_id:roomId,p_user_id:userId,p_display_name:displayName,p_scene:scene,p_image_path:path});
    if(startError){await db.storage.from("no-count-it-scenes").remove([path]);return fail(NO_COUNT_IT_SERVER_TEXTS.matchStartFailed,409);}
    await broadcast(db,roomId,"match_started");
    return respond(data);
  }

  const matchId=typeof body.matchId==="string"?body.matchId:"";
  if(body.action==="round_ready" || body.action==="submit_answer"){
    if(!/^[0-9a-f-]{36}$/i.test(matchId))return fail(NO_COUNT_IT_SERVER_TEXTS.validMatchIdRequired,400);
  }
  if(body.action==="round_ready"){
    const {data,error}=await db.rpc("no_count_it_round_ready",{p_room_id:roomId,p_match_id:matchId,p_user_id:userId});
    if(error)return fail(NO_COUNT_IT_SERVER_TEXTS.roundReadyFailed,409);
    await broadcast(db,roomId,"round_updated");
    return respond(data);
  }
  if(body.action==="submit_answer"){
    const roundNumber=Number(body.roundNumber),answer=typeof body.answer==="string"&&/^\d{1,15}$/.test(body.answer)?BigInt(body.answer):null;
    if(!Number.isInteger(roundNumber)||roundNumber<1||roundNumber>3||answer===null||answer>9223372036854775807n)return fail(NO_COUNT_IT_SERVER_TEXTS.invalidAnswer,400);
    const {data,error}=await db.rpc("no_count_it_submit_answer",{p_room_id:roomId,p_match_id:matchId,p_round_number:roundNumber,p_user_id:userId,p_answer:answer.toString()});
    if(error)return fail(NO_COUNT_IT_SERVER_TEXTS.answerRejected,409);
    await broadcast(db,roomId,"answer_submitted");
    return respond(data);
  }

  const {data:room,error:roomError}=await db.rpc("multiplayer_execute_action",{p_action:"get_room",p_user_id:userId,p_display_name:displayName,p_payload:{roomId}});
  if(roomError)return fail(NO_COUNT_IT_SERVER_TEXTS.notRoomMember,403);
  const {data:initialSnapshot,error:initialSnapshotError}=await db.rpc("no_count_it_match_snapshot",{p_room_id:roomId,p_user_id:userId});
  if(initialSnapshotError)return fail(NO_COUNT_IT_SERVER_TEXTS.matchStateUnavailable,409);
  const currentMatchId=initialSnapshot?.match?.matchId;
  if(!currentMatchId)return respond({room,match:null});
  if(matchId && matchId!==currentMatchId)return fail(NO_COUNT_IT_SERVER_TEXTS.matchChanged,409);
  const activeMatchId=matchId||currentMatchId;
  const {data:prep,error:prepError}=await db.rpc("no_count_it_finalize_preparation",{p_room_id:roomId,p_match_id:activeMatchId});
  if(!prepError&&prep?.status==="technical_aborted"){
    await broadcast(db,roomId,"match_finished");
  }
  const {data:snapshot,error}=await db.rpc("no_count_it_match_snapshot",{p_room_id:roomId,p_user_id:userId});
  if(error)return fail(NO_COUNT_IT_SERVER_TEXTS.matchStateUnavailable,409);
  const match=snapshot?.match;
  if(match?.round?.status==="revealing"){
    const {data:round}=await db.from("games_no_count_it_rounds").select("reveal_started_at").eq("match_id",activeMatchId).eq("round_number",match.currentRound).maybeSingle();
    if(round?.reveal_started_at&&Date.now()-Date.parse(round.reveal_started_at)>=6000){
      if(match.currentRound<3){
        const {scene,path}=await uploadScene(db,roomId,match.currentRound+1);
        const {data:progress,error:progressError}=await db.rpc("no_count_it_prepare_next_round",{p_room_id:roomId,p_match_id:activeMatchId,p_scene:scene,p_image_path:path});
        if(progressError){await db.storage.from("no-count-it-scenes").remove([path]);}
        else await broadcast(db,roomId,"round_updated");
        if(progress?.status==="completed"){await broadcast(db,roomId,"match_finished");}
      }else{
        const {data:progress,error:progressError}=await db.rpc("no_count_it_prepare_next_round",{p_room_id:roomId,p_match_id:activeMatchId,p_scene:{},p_image_path:""});
        if(!progressError&&progress?.status==="completed"){await broadcast(db,roomId,"match_finished");}
      }
    }
  }
  const {data:latest,error:latestError}=await db.rpc("no_count_it_match_snapshot",{p_room_id:roomId,p_user_id:userId});
  if(latestError)return fail(NO_COUNT_IT_SERVER_TEXTS.matchRefreshFailed,500);
  const current=latest?.match;
  if(current?.round?.imagePath){
    const {data:signed,error:signedError}=await db.storage.from("no-count-it-scenes").createSignedUrl(current.round.imagePath,600);
    if(!signedError&&signed?.signedUrl){current.round.imageUrl=signed.signedUrl;delete current.round.imagePath;}
  }
  return respond({room:latest.room??room,match:current??null});
 }catch(error){
  console.error("NoCountIt function error",error instanceof Error?error.message:"Unknown error");
  return fail(NO_COUNT_IT_SERVER_TEXTS.internalError,500);
 }
});

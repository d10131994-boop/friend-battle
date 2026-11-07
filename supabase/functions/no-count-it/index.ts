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

type CandyColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "teal" | "white" | "brown";
type Candy = { id: number; x: number; y: number; rotation: number; scale: number; color: CandyColor; shape: "round" | "oval" | "wrapped" };
type Scene = { version: 1; seed: string; generator: "candy-jar"; objects: Candy[]; targetColor: CandyColor; correctCount: number };
const COLORS: CandyColor[] = ["red","orange","yellow","green","blue","purple","pink","teal","white","brown"];
const PALETTE: Record<CandyColor, [string,string,string]> = {
  red:["#D95755","#F28A7B","#983B43"], orange:["#E98C42","#F7B96F","#B95E32"],
  yellow:["#E7C94E","#F7E58A","#B99736"], green:["#65A978","#9BD19A","#3F795B"],
  blue:["#5B91C5","#9CC4E5","#3D638F"], purple:["#9675B7","#C0A1D8","#6B508E"],
  pink:["#D77FA0","#F1B2C5","#A9567D"], teal:["#55AFA9","#91D5C9","#367D7B"],
  white:["#E8E4D9","#FFFFFF","#B9B5AB"], brown:["#9C7055","#C49A78","#694A3B"],
};
function seeded(seed: string) {
  let state = 2166136261;
  for (const char of seed) { state ^= char.charCodeAt(0); state = Math.imul(state,16777619); }
  return () => {
    state += 0x6d2b79f5; let value=state;
    value=Math.imul(value^(value>>>15),value|1); value^=value+Math.imul(value^(value>>>7),value|61);
    return ((value^(value>>>14))>>>0)/4294967296;
  };
}
function int(r:()=>number,min:number,max:number){return min+Math.floor(r()*(max-min+1));}
function shuffle<T>(items:T[],r:()=>number){const a=[...items];for(let i=a.length-1;i>0;i--){const j=int(r,0,i);[a[i],a[j]]=[a[j],a[i]];}return a;}
function halfWidth(y:number){if(y<145||y>930)return 0;if(y<245)return 250+(y-145)*.55;if(y<790)return 305;return 305-(y-790)*(45/140);}
function generateScene(): Scene {
  const seed=crypto.randomUUID(), r=seeded(seed), count=int(r,40,120), colorCount=int(r,4,10);
  const selected=shuffle(COLORS,r).slice(0,colorCount), colors: CandyColor[]=[];
  for(const c of selected)for(let i=0;i<3;i++)colors.push(c);
  while(colors.length<count)colors.push(selected[int(r,0,selected.length-1)]);
  const shuffled=shuffle(colors,r), targetColor=selected[int(r,0,selected.length-1)];
  const objects:Candy[]=[];
  for(let i=0;i<shuffled.length;i++){
    let placed:Candy|null=null;
    for(let attempt=0;attempt<700&&!placed;attempt++){
      const radius=int(r,23,29),y=int(r,190,875),half=halfWidth(y)-radius-8;
      if(half<=0)continue;
      const x=int(r,500-half,500+half),inset=radius-4,edge=Math.abs(x-500)+inset;
      if(edge>halfWidth(y)||edge>halfWidth(y-inset)||edge>halfWidth(y+inset))continue;
      const candidate:Candy={id:i+1,x,y,rotation:int(r,-180,180),scale:radius/29,color:shuffled[i],shape:(["round","oval","wrapped"] as const)[int(r,0,2)]};
      if(objects.every(o=>Math.hypot(x-o.x,y-o.y)>=(radius+29*o.scale)*.76))placed=candidate;
    }
    if(!placed)throw new Error("Scene placement failed; retry generation.");
    objects.push(placed);
  }
  return {version:1,seed,generator:"candy-jar",objects,targetColor,correctCount:objects.filter(o=>o.color===targetColor).length};
}
function renderSvg(scene:Scene):string{
  const candies=scene.objects.map(o=>{
    const [base,light,dark]=PALETTE[o.color],id=`c${o.id}`,shape=o.shape==="oval"
      ?'<ellipse cx="0" cy="0" rx="29" ry="22"/>'
      :o.shape==="wrapped"
      ?'<path d="M-29 -11 L-22 -6 L-22 6 L-29 11 L-25 0 Z M29 -11 L22 -6 L22 6 L29 11 L25 0 Z"/><rect x="-22" y="-15" width="44" height="30" rx="14"/>'
      :'<circle cx="0" cy="0" r="29"/>';
    return `<g transform="translate(${o.x} ${o.y}) rotate(${o.rotation}) scale(${o.scale})"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${light}"/><stop offset=".56" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><g fill="url(#${id})" stroke="#654B45" stroke-opacity=".2" stroke-width="2">${shape}</g><ellipse cx="-9" cy="-11" rx="8" ry="4" fill="#fff" opacity=".22"/></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs><clipPath id="inside"><path d="M255 145 Q255 115 290 115 H710 Q745 115 745 145 L790 215 Q825 270 825 340 V790 Q825 900 715 920 H285 Q175 900 175 790 V340 Q175 270 210 215 Z"/></clipPath></defs><g clip-path="url(#inside)">${candies}</g><path d="M255 145 Q255 115 290 115 H710 Q745 115 745 145 L790 215 Q825 270 825 340 V790 Q825 900 715 920 H285 Q175 900 175 790 V340 Q175 270 210 215 Z" fill="#D9ECEA" fill-opacity=".08" stroke="#A8C9CB" stroke-opacity=".72" stroke-width="13"/><path d="M260 105 Q260 80 292 80 H708 Q740 80 740 105 V135 Q740 155 710 155 H290 Q260 155 260 135 Z" fill="#D8E6E3" fill-opacity=".65" stroke="#A8C9CB" stroke-width="11"/><path d="M465 82 C430 25 385 48 420 92 C445 115 470 100 500 90 C530 100 555 115 580 92 C615 48 570 25 535 82" fill="#D98A9D" stroke="#A95F76" stroke-width="7"/><circle cx="500" cy="91" r="17" fill="#E9A7B5" stroke="#A95F76" stroke-width="6"/></svg>`;
}
async function uploadScene(db:SupabaseClient,roomId:string,round:number){
 let scene:Scene|undefined;
 let lastError:unknown;
 for(let attempt=0;attempt<5&&!scene;attempt++){
  try{scene=generateScene();}catch(error){lastError=error;}
 }
 if(!scene)throw lastError??new Error("Could not generate a valid candy scene.");
 const path=`${roomId}/round-${round}/${crypto.randomUUID()}.svg`;
 const {error}=await db.storage.from("no-count-it-scenes").upload(path,new Blob([renderSvg(scene)],{type:"image/svg+xml"}),{contentType:"image/svg+xml",upsert:false});
 if(error)throw error;
 return {scene,path};
}
async function finishSharedGame(db:SupabaseClient,roomId:string,startedAt:string){
 const {error}=await db.rpc("multiplayer_execute_action",{p_action:"finish_game",p_user_id:"__game_server__",p_display_name:"Game server",p_payload:{roomId,gameId:"no-count-it",startedAt}});
 if(error)throw error;
}
async function broadcast(db:SupabaseClient,roomId:string,event:string){
 try{const channel=db.channel(`room:${roomId}`,{config:{private:true}});
  await channel.send({type:"broadcast",event,payload:{roomId,source:"no-count-it"}});
  await db.removeChannel(channel);
 }catch(error){console.warn("NoCountIt broadcast failed",error);}
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return fail("Method not allowed",405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),token=Deno.env.get("TELEGRAM_BOT_TOKEN");
  if(!url||!key||!token)return fail("Server configuration missing",500);
  const body=await req.json();
  if(!body||typeof body!=="object"||Array.isArray(body))return fail("Invalid request body",400);
  const actions=["start_match","get_match","round_ready","submit_answer"];
  if(!actions.includes(body.action))return fail("Unknown NoCountIt action",400);
  const initData=typeof body.initData==="string"?body.initData:"";
  if(!initData||initData.length>10000)return fail("Invalid Telegram data",400);
  const user=await verifyTelegram(initData,token);
  if(!user)return fail("Telegram verification failed",401);
  const userId=String(user.id),displayName=user.first_name?.trim().slice(0,100)||"Игрок";
  const roomId=typeof body.roomId==="string"?body.roomId.trim():"";
  if(!/^[0-9a-f-]{36}$/i.test(roomId))return fail("A valid roomId is required",400);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

  if(body.action==="start_match"){
    const {data:room,error}=await db.rpc("multiplayer_execute_action",{p_action:"get_room",p_user_id:userId,p_display_name:displayName,p_payload:{roomId}});
    if(error)return fail("Не удалось проверить комнату",403);
    if(room?.gameId!=="no-count-it")return fail("В комнате должна быть выбрана NoCountIt",409);
    const member=room.players?.find((p:{userId:string})=>p.userId===userId);
    if(!member||!member.isHost)return fail("Начать матч может только ведущий комнаты",403);
    const {scene,path}=await uploadScene(db,roomId,1);
    const {data,error:startError}=await db.rpc("no_count_it_start_match",{p_room_id:roomId,p_user_id:userId,p_display_name:displayName,p_scene:scene,p_image_path:path});
    if(startError){await db.storage.from("no-count-it-scenes").remove([path]);return fail("Не удалось начать матч",409);}
    await broadcast(db,roomId,"match_started");
    return respond(data);
  }

  const matchId=typeof body.matchId==="string"?body.matchId:"";
  if(body.action==="round_ready" || body.action==="submit_answer"){
    if(!/^[0-9a-f-]{36}$/i.test(matchId))return fail("A valid matchId is required",400);
  }
  if(body.action==="round_ready"){
    const {data,error}=await db.rpc("no_count_it_round_ready",{p_room_id:roomId,p_match_id:matchId,p_user_id:userId});
    if(error)return fail("Не удалось подтвердить готовность раунда",409);
    if(data?.status==="technical_aborted")await finishSharedGame(db,roomId,data.startedAt);
    await broadcast(db,roomId,"round_updated");
    return respond(data);
  }
  if(body.action==="submit_answer"){
    const roundNumber=Number(body.roundNumber),answer=typeof body.answer==="string"&&/^\d{1,15}$/.test(body.answer)?BigInt(body.answer):null;
    if(!Number.isInteger(roundNumber)||roundNumber<1||roundNumber>3||answer===null||answer>9223372036854775807n)return fail("Некорректный ответ",400);
    const {data,error}=await db.rpc("no_count_it_submit_answer",{p_room_id:roomId,p_match_id:matchId,p_round_number:roundNumber,p_user_id:userId,p_answer:answer.toString()});
    if(error)return fail("Ответ не принят. Возможно, время вышло или ответ уже отправлен.",409);
    await broadcast(db,roomId,"answer_submitted");
    return respond(data);
  }

  const {data:room,error:roomError}=await db.rpc("multiplayer_execute_action",{p_action:"get_room",p_user_id:userId,p_display_name:displayName,p_payload:{roomId}});
  if(roomError)return fail("Вы не участник этой комнаты",403);
  const {data:initialSnapshot,error:initialSnapshotError}=await db.rpc("no_count_it_match_snapshot",{p_room_id:roomId,p_user_id:userId});
  if(initialSnapshotError)return fail("Не удалось получить состояние матча",409);
  const currentMatchId=initialSnapshot?.match?.matchId;
  if(!currentMatchId)return respond({room,match:null});
  if(matchId && matchId!==currentMatchId)return fail("Матч уже изменился. Обновите игру.",409);
  const activeMatchId=matchId||currentMatchId;
  const {data:prep,error:prepError}=await db.rpc("no_count_it_finalize_preparation",{p_room_id:roomId,p_match_id:activeMatchId});
  if(!prepError&&prep?.status==="technical_aborted"){
    await finishSharedGame(db,roomId,prep.startedAt);
    await broadcast(db,roomId,"match_finished");
  }
  const {data:snapshot,error}=await db.rpc("no_count_it_match_snapshot",{p_room_id:roomId,p_user_id:userId});
  if(error)return fail("Не удалось получить состояние матча",409);
  const match=snapshot?.match;
  if(match?.round?.status==="revealing"){
    const {data:round}=await db.from("games_no_count_it_rounds").select("reveal_started_at").eq("match_id",activeMatchId).eq("round_number",match.currentRound).maybeSingle();
    if(round?.reveal_started_at&&Date.now()-Date.parse(round.reveal_started_at)>=4000){
      if(match.currentRound<3){
        const {scene,path}=await uploadScene(db,roomId,match.currentRound+1);
        const {data:progress,error:progressError}=await db.rpc("no_count_it_prepare_next_round",{p_room_id:roomId,p_match_id:activeMatchId,p_scene:scene,p_image_path:path});
        if(progressError){await db.storage.from("no-count-it-scenes").remove([path]);}
        else await broadcast(db,roomId,"round_updated");
        if(progress?.status==="completed"){await finishSharedGame(db,roomId,match.startedAt);await broadcast(db,roomId,"match_finished");}
      }else{
        const {data:progress,error:progressError}=await db.rpc("no_count_it_prepare_next_round",{p_room_id:roomId,p_match_id:activeMatchId,p_scene:{},p_image_path:""});
        if(!progressError&&progress?.status==="completed"){await finishSharedGame(db,roomId,match.startedAt);await broadcast(db,roomId,"match_finished");}
      }
    }
  }
  if((match?.status==="completed" || match?.status==="technical_aborted") && room?.status==="playing")await finishSharedGame(db,roomId,match.startedAt);
  const {data:latest,error:latestError}=await db.rpc("no_count_it_match_snapshot",{p_room_id:roomId,p_user_id:userId});
  if(latestError)return fail("Не удалось обновить состояние матча",500);
  const current=latest?.match;
  if(current?.round?.imagePath){
    const {data:signed,error:signedError}=await db.storage.from("no-count-it-scenes").createSignedUrl(current.round.imagePath,600);
    if(!signedError&&signed?.signedUrl){current.round.imageUrl=signed.signedUrl;delete current.round.imagePath;}
  }
  return respond({room:latest.room??room,match:current??null});
 }catch(error){
  console.error("NoCountIt function error",error instanceof Error?error.message:"Unknown error");
  return fail("Внутренняя ошибка NoCountIt",500);
 }
});

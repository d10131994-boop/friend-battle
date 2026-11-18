create or replace function public.duel_ensure_match(p_room_id uuid,p_user_id text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r public.common_multiplayer_rooms%rowtype; ids text[]; m public.games_duel_matches%rowtype;
begin
 select * into r from public.common_multiplayer_rooms where id=p_room_id for update;
 if not found or r.game_id <> 'duel' or r.status <> 'playing' or r.started_at is null then
   raise exception 'Duel room is not playing' using errcode='P0001';
 end if;
 select array_agg(user_id order by joined_at,id) into ids from public.common_multiplayer_players where room_id=p_room_id;
 if coalesce(array_length(ids,1),0)<>2 or not p_user_id=any(ids) then
   raise exception 'Two authorized duel players required' using errcode='P0003';
 end if;
 select * into m from public.games_duel_matches where room_id=p_room_id and started_at=r.started_at;
 if not found then
   -- Only a new room session may initialize a match.
   insert into public.games_duel_matches(room_id,started_at,player_ids)
   values(p_room_id,r.started_at,ids) returning * into m;
 end if;
 if not p_user_id=any(m.player_ids) then raise exception 'Not a match participant' using errcode='P0003'; end if;
 return jsonb_build_object('matchId',m.id,'exchange',m.exchange,'status',m.status);
end $$;
revoke all on function public.duel_ensure_match(uuid,text) from public,anon,authenticated;
grant execute on function public.duel_ensure_match(uuid,text) to service_role;
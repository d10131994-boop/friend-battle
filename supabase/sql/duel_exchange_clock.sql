alter table public.games_duel_matches
  add column if not exists exchange_deadline timestamptz not null default (now() + interval '15 seconds'),
  add column if not exists both_ready_at timestamptz;
create or replace function public.duel_reset_exchange_clock()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.exchange <> old.exchange then
   new.exchange_deadline := clock_timestamp() + interval '15 seconds';
   new.both_ready_at := null;
 end if;
 return new;
end $$;
drop trigger if exists duel_reset_exchange_clock on public.games_duel_matches;
create trigger duel_reset_exchange_clock before update of exchange on public.games_duel_matches
for each row execute function public.duel_reset_exchange_clock();

create or replace function public.duel_tick(p_match_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 m public.games_duel_matches%rowtype;
 pending_choices jsonb;
 idx integer;
 actions jsonb;
 now_at timestamptz := clock_timestamp();
begin
 select * into m from public.games_duel_matches where id=p_match_id for update;
 if not found then raise exception 'Duel match not found' using errcode='P0002'; end if;
 if m.status <> 'playing' then return jsonb_build_object('status','completed'); end if;
 pending_choices:=m.pending;
 if now_at >= m.exchange_deadline then
   for idx in 1..2 loop
     if not (pending_choices ? idx::text) then
       select jsonb_agg(jsonb_build_object('kind',kind,'zone',zone)) into actions
       from (
         select kind,zone from (
           values ('attack','head'),('defend','head'),('attack','chest'),('defend','chest'),
                  ('attack','belly'),('defend','belly'),('attack','legs'),('defend','legs')
         ) as choices(kind,zone) order by random() limit 2
       ) as chosen;
       pending_choices:=jsonb_set(pending_choices,array[idx::text],actions,true);
     end if;
   end loop;
 end if;
 if pending_choices is distinct from m.pending then
   update public.games_duel_matches set pending=pending_choices where id=m.id;
 end if;
 if pending_choices ? '1' and pending_choices ? '2' then
   if m.both_ready_at is null then
     update public.games_duel_matches set both_ready_at=now_at where id=m.id;
     return jsonb_build_object('status','both_ready','resolveAfter',now_at+interval '2 seconds');
   end if;
   if now_at >= m.both_ready_at + interval '2 seconds' then
     return public.duel_resolve_exchange(m.id);
   end if;
   return jsonb_build_object('status','both_ready','resolveAfter',m.both_ready_at+interval '2 seconds');
 end if;
 return jsonb_build_object('status','waiting','deadline',m.exchange_deadline);
end $$;
revoke all on function public.duel_tick(uuid) from public,anon,authenticated;
grant execute on function public.duel_tick(uuid) to service_role;
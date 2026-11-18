-- Applied to Supabase as duel_match_storage_and_atomic_pending.
-- Server-only persistence. No direct client grants and RLS enabled.
create table if not exists public.games_duel_matches (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.common_multiplayer_rooms(id) on delete cascade,
 started_at timestamptz not null,
 player_ids text[] not null check (array_length(player_ids,1)=2 and player_ids[1]<>player_ids[2]),
 status text not null default 'playing' check (status in ('playing','completed')),
 exchange integer not null default 1 check(exchange>0),
 match_state jsonb not null default '{"wins":[0,0],"health":[3,3],"round":1,"exchanges":0,"finished":false,"winner":null}'::jsonb,
 pending jsonb not null default '{}'::jsonb,
 last_result jsonb,
 created_at timestamptz not null default now(),
 unique(room_id,started_at)
);
create unique index if not exists games_duel_active_room on public.games_duel_matches(room_id) where status='playing';
alter table public.games_duel_matches enable row level security;
revoke all on public.games_duel_matches from public,anon,authenticated;
grant select,insert,update,delete on public.games_duel_matches to service_role;
create or replace function public.duel_submit_pending(p_room_id uuid,p_match_id uuid,p_user_id text,p_exchange integer,p_choices jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare m public.games_duel_matches%rowtype; idx integer; updated jsonb;
begin
 select * into m from public.games_duel_matches where id=p_match_id and room_id=p_room_id for update;
 if not found then raise exception 'Duel match not found' using errcode='P0002'; end if;
 if m.status<>'playing' or m.exchange<>p_exchange then raise exception 'Stale duel exchange' using errcode='P0001'; end if;
 idx:=array_position(m.player_ids,p_user_id);
 if idx is null then raise exception 'Not a duel player' using errcode='P0003'; end if;
 if jsonb_typeof(p_choices)<>'array' or jsonb_array_length(p_choices)<>2 then raise exception 'Invalid choice' using errcode='22023'; end if;
 if m.pending ? idx::text then raise exception 'Choice already submitted' using errcode='P0001'; end if;
 updated:=jsonb_set(m.pending,array[idx::text],p_choices,true);
 update public.games_duel_matches set pending=updated where id=m.id;
 return jsonb_build_object('status',case when updated ? '1' and updated ? '2' then 'both_ready' else 'waiting' end,'matchId',m.id,'exchange',m.exchange);
end $$;
revoke all on function public.duel_submit_pending(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.duel_submit_pending(uuid,uuid,text,integer,jsonb) to service_role;

-- Keep the room engine disabled until the owner enables Duel multiplayer.
create or replace function public.duel_sync_room_availability()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.game_id='duel' then
    update public.common_multiplayer_game_rules
       set is_enabled = new.is_multiplayer_enabled and new.is_enabled,
           min_players = 2, max_players = 2
     where game_id='duel';
  end if;
  return new;
end $$;
drop trigger if exists duel_sync_room_availability on public.common_game_availability;
create trigger duel_sync_room_availability
after insert or update of is_multiplayer_enabled,is_enabled on public.common_game_availability
for each row execute function public.duel_sync_room_availability();
update public.common_multiplayer_game_rules
   set is_enabled=false
 where game_id='duel';
revoke all on function public.duel_sync_room_availability() from public,anon,authenticated;

create or replace function public.duel_record_room_result()
returns trigger language plpgsql security invoker set search_path=public as $$
declare
  fighter integer;
  winner_index integer;
begin
  if old.status <> 'completed' and new.status='completed'
     and new.match_state->>'finished'='true'
     and new.match_state->>'winner' in ('0','1') then
    winner_index:=(new.match_state->>'winner')::integer;
    for fighter in 1..2 loop
      insert into public.common_multiplayer_room_stats(room_id,user_id,wins,matches_played,updated_at)
      values(new.room_id,new.player_ids[fighter],case when fighter-1=winner_index then 1 else 0 end,1,clock_timestamp())
      on conflict(room_id,user_id) do update
        set wins=public.common_multiplayer_room_stats.wins+excluded.wins,
            matches_played=public.common_multiplayer_room_stats.matches_played+1,
            updated_at=clock_timestamp();
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists duel_record_room_result on public.games_duel_matches;
create trigger duel_record_room_result
after update of status on public.games_duel_matches
for each row execute function public.duel_record_room_result();
revoke all on function public.duel_record_room_result() from public,anon,authenticated;

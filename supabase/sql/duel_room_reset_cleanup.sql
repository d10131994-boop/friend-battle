create or replace function public.duel_cancel_match_on_room_reset()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if old.game_id = 'duel' and old.status = 'playing' and
     (new.status in ('waiting','cancelled') or new.game_id is distinct from old.game_id or
      new.started_at is distinct from old.started_at) then
    update public.games_duel_matches
       set status='completed', pending='{}'::jsonb
     where room_id=old.id and status='playing' and started_at=old.started_at;
  end if;
  return new;
end $$;
drop trigger if exists duel_cancel_match_on_room_reset on public.common_multiplayer_rooms;
create trigger duel_cancel_match_on_room_reset
after update of status,game_id,started_at on public.common_multiplayer_rooms
for each row execute function public.duel_cancel_match_on_room_reset();
revoke all on function public.duel_cancel_match_on_room_reset() from public,anon,authenticated;
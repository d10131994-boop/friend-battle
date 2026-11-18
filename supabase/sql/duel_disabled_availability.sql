-- Register Duel without exposing it in either game menu.
insert into public.common_game_availability
  (game_id,is_solo_enabled,is_multiplayer_enabled,min_players,max_players,is_enabled,sort_order)
values ('duel',false,false,2,2,true,60)
on conflict (game_id) do update
set min_players=2,max_players=2,
    is_solo_enabled=false,is_multiplayer_enabled=false;
-- The room engine needs its own rule record when the user later enables Duel.
insert into public.common_multiplayer_game_rules(game_id,min_players,max_players,is_enabled)
values ('duel',2,2,true)
on conflict (game_id) do update
set min_players=2,max_players=2;

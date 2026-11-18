-- Transactional SQL/TypeScript reference fixtures. Leaves no persistent rooms or matches.
begin;
do $$
declare
  room_id uuid;
  match_id uuid;
  started timestamptz;
  result jsonb;
  fixture record;
begin
  for fixture in
    select * from (values
      ('reflection', '[{"kind":"attack","zone":"head"},{"kind":"defend","zone":"legs"}]'::jsonb,
        '[{"kind":"defend","zone":"head"},{"kind":"defend","zone":"chest"}]'::jsonb, '[1,0]'::jsonb),
      ('clash', '[{"kind":"attack","zone":"head"},{"kind":"defend","zone":"chest"}]'::jsonb,
        '[{"kind":"attack","zone":"head"},{"kind":"defend","zone":"legs"}]'::jsonb, '[0,0]'::jsonb),
      ('cross-strikes', '[{"kind":"attack","zone":"head"},{"kind":"defend","zone":"legs"}]'::jsonb,
        '[{"kind":"attack","zone":"chest"},{"kind":"defend","zone":"belly"}]'::jsonb, '[1,1]'::jsonb),
      ('covered-reflection', '[{"kind":"attack","zone":"head"},{"kind":"defend","zone":"head"}]'::jsonb,
        '[{"kind":"defend","zone":"head"},{"kind":"defend","zone":"chest"}]'::jsonb, '[0,0]'::jsonb)
    ) as v(label,left_actions,right_actions,expected_damage)
  loop
    insert into public.common_multiplayer_rooms(game_id,status,max_players,started_at)
    values('duel','playing',2,clock_timestamp())
    returning id,started_at into room_id,started;
    insert into public.games_duel_matches(room_id,started_at,player_ids,pending)
    values(room_id,started,array['test-left','test-right'],
      jsonb_build_object('1',fixture.left_actions,'2',fixture.right_actions))
    returning id into match_id;
    result:=public.duel_resolve_exchange(match_id);
    if result->'result'->'resolution'->'damage' is distinct from fixture.expected_damage then
      raise exception 'Duel SQL parity fixture % failed: expected %, actual %',
        fixture.label,fixture.expected_damage,result->'result'->'resolution'->'damage';
    end if;
    if not (result->'result'->'resolution' ? 'unusedDefenses') then
      raise exception 'Duel SQL fixture % omitted unusedDefenses',fixture.label;
    end if;
  end loop;
end $$;
rollback;

-- Canonical deployed atomic exchange resolver.
CREATE OR REPLACE FUNCTION public.duel_resolve_exchange(p_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
 m public.games_duel_matches%rowtype;
 left_actions jsonb; right_actions jsonb;
 zone text; a0 boolean; a1 boolean; d0 boolean; d1 boolean;
 damage integer[] := array[0,0]; hp integer[]; wins integer[];
 outcome text := 'continue'; winner integer := null;
 round_no integer; exchange_count integer; finished boolean;
 hits jsonb := '[]'::jsonb; clashes jsonb := '[]'::jsonb; blocks jsonb := '[]'::jsonb; unused_defenses jsonb := '[]'::jsonb;
 state jsonb; result jsonb; next_exchange integer;
begin
 select * into m from public.games_duel_matches where id=p_match_id for update;
 if not found then raise exception 'Match not found' using errcode='P0002'; end if;
 if m.status <> 'playing' then return jsonb_build_object('status','completed'); end if;
 if not (m.pending ? '1' and m.pending ? '2') then return jsonb_build_object('status','waiting'); end if;
 left_actions:=m.pending->'1'; right_actions:=m.pending->'2';
 if jsonb_typeof(left_actions)<>'array' or jsonb_typeof(right_actions)<>'array' or
    jsonb_array_length(left_actions)<>2 or jsonb_array_length(right_actions)<>2 then
    raise exception 'Invalid stored selection' using errcode='22023';
 end if;
 foreach zone in array array['head','chest','belly','legs'] loop
   a0:=left_actions @> jsonb_build_array(jsonb_build_object('kind','attack','zone',zone));
   a1:=right_actions @> jsonb_build_array(jsonb_build_object('kind','attack','zone',zone));
   d0:=left_actions @> jsonb_build_array(jsonb_build_object('kind','defend','zone',zone));
   d1:=right_actions @> jsonb_build_array(jsonb_build_object('kind','defend','zone',zone));
   if a0 and a1 then
     clashes:=clashes || jsonb_build_array(jsonb_build_object('zone',zone));
   else
     if a0 then
       if d1 then
         blocks:=blocks || jsonb_build_array(jsonb_build_object('defender',1,'attacker',0,'zone',zone,'reflected',not d0));
         if not d0 then
           damage[1]:=damage[1]+1;
           hits:=hits || jsonb_build_array(jsonb_build_object('source',1,'target',0,'zone',zone,'reflected',true));
         end if;
       else
         damage[2]:=damage[2]+1;
         hits:=hits || jsonb_build_array(jsonb_build_object('source',0,'target',1,'zone',zone,'reflected',false));
       end if;
     end if;
     if a1 then
       if d0 then
         blocks:=blocks || jsonb_build_array(jsonb_build_object('defender',0,'attacker',1,'zone',zone,'reflected',not d1));
         if not d1 then
           damage[2]:=damage[2]+1;
           hits:=hits || jsonb_build_array(jsonb_build_object('source',0,'target',1,'zone',zone,'reflected',true));
         end if;
       else
         damage[1]:=damage[1]+1;
         hits:=hits || jsonb_build_array(jsonb_build_object('source',1,'target',0,'zone',zone,'reflected',false));
       end if;
     end if;
   end if;
   if d0 and not a1 then unused_defenses:=unused_defenses || jsonb_build_array(jsonb_build_object('fighter',0,'zone',zone)); end if;
   if d1 and not a0 then unused_defenses:=unused_defenses || jsonb_build_array(jsonb_build_object('fighter',1,'zone',zone)); end if;
 end loop;
 state:=m.match_state;
 hp:=array[greatest(0,(state->'health'->>0)::integer-damage[1]),greatest(0,(state->'health'->>1)::integer-damage[2])];
 wins:=array[(state->'wins'->>0)::integer,(state->'wins'->>1)::integer];
 round_no:=(state->>'round')::integer;
 exchange_count:=(state->>'exchanges')::integer+1;
 if hp[1]=0 and hp[2]=0 then outcome:='draw';
 elsif hp[1]=0 then outcome:='right'; wins[2]:=wins[2]+1;
 elsif hp[2]=0 then outcome:='left'; wins[1]:=wins[1]+1;
 end if;
 if wins[1]>=2 then winner:=0; elsif wins[2]>=2 then winner:=1; end if;
 finished:=winner is not null;
 result:=jsonb_build_object('exchange',m.exchange,'roundResult',outcome,'roundEnded',outcome<>'continue',
   'resolution',jsonb_build_object('hits',hits,'clashes',clashes,'blocks',blocks,'unusedDefenses',unused_defenses,'damage',jsonb_build_array(damage[1],damage[2]),'healthAfter',jsonb_build_array(hp[1],hp[2]),'outcome',outcome));
 if outcome<>'continue' and not finished then
   if outcome<>'draw' then round_no:=round_no+1; end if;
   hp:=array[3,3];
 end if;
 state:=jsonb_build_object('wins',jsonb_build_array(wins[1],wins[2]),'health',jsonb_build_array(hp[1],hp[2]),
   'round',round_no,'exchanges',exchange_count,'finished',finished,'winner',winner);
 next_exchange:=m.exchange+1;
 update public.games_duel_matches set match_state=state,pending='{}'::jsonb,exchange=next_exchange,
   status=case when finished then 'completed' else 'playing' end,last_result=result where id=m.id;
 return jsonb_build_object('status',case when finished then 'completed' else 'resolved' end,'exchange',next_exchange,'match',state,'result',result);
end $function$
;
revoke all on function public.duel_resolve_exchange(uuid) from public,anon,authenticated;
grant execute on function public.duel_resolve_exchange(uuid) to service_role;

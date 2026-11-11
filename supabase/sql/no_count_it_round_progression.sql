-- NoCountIt round progression. Deployed as migration no_count_it_round_progression.
CREATE OR REPLACE FUNCTION public.no_count_it_prepare_next_round(p_room_id uuid,p_match_id uuid,p_scene jsonb,p_image_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_room public.common_multiplayer_rooms%ROWTYPE; v_match public.games_no_count_it_matches%ROWTYPE;
v_round public.games_no_count_it_rounds%ROWTYPE; v_next smallint; v_now timestamptz:=pg_catalog.clock_timestamp();
v_results jsonb; v_winner text; v_best bigint; v_best_count integer;
BEGIN
SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id=p_room_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE='P0002'; END IF;
SELECT * INTO v_match FROM public.games_no_count_it_matches WHERE id=p_match_id AND room_id=p_room_id FOR UPDATE;
IF NOT FOUND OR v_match.status<>'playing' OR v_room.status<>'playing' OR v_room.started_at IS DISTINCT FROM v_match.started_at THEN RAISE EXCEPTION 'Match is no longer active' USING ERRCODE='55000'; END IF;
SELECT * INTO v_round FROM public.games_no_count_it_rounds WHERE match_id=p_match_id AND round_number=v_match.current_round FOR UPDATE;
IF NOT FOUND OR v_round.status<>'revealing' OR v_round.reveal_started_at>v_now-interval '6 seconds' THEN RAISE EXCEPTION 'Round reveal is still active' USING ERRCODE='55000'; END IF;
IF v_match.current_round=3 THEN
 SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',user_id,'displayName',display_name,'totalError',total_error) ORDER BY total_error,joined_at,user_id),'[]'::jsonb),
 min(total_error),count(*) FILTER(WHERE total_error=(SELECT min(total_error) FROM public.games_no_count_it_match_players WHERE match_id=p_match_id))
 INTO v_results,v_best,v_best_count FROM public.games_no_count_it_match_players WHERE match_id=p_match_id AND status='active';
 IF v_best_count=1 THEN SELECT user_id INTO v_winner FROM public.games_no_count_it_match_players WHERE match_id=p_match_id AND status='active' AND total_error=v_best; END IF;
 UPDATE public.games_no_count_it_matches SET status='completed',completed_at=v_now,final_results=v_results,winner_user_id=v_winner WHERE id=p_match_id;
 INSERT INTO public.common_multiplayer_room_stats(room_id,user_id,wins,matches_played,updated_at)
 SELECT p_room_id,mp.user_id,CASE WHEN mp.user_id=v_winner THEN 1 ELSE 0 END,1,v_now FROM public.games_no_count_it_match_players mp WHERE mp.match_id=p_match_id AND mp.status='active'
 ON CONFLICT(room_id,user_id) DO UPDATE SET wins=public.common_multiplayer_room_stats.wins+EXCLUDED.wins,matches_played=public.common_multiplayer_room_stats.matches_played+1,updated_at=EXCLUDED.updated_at;
 RETURN jsonb_build_object('status','completed','startedAt',v_match.started_at,'winnerUserId',v_winner,'finalResults',v_results);
END IF;
v_next:=v_match.current_round+1;
IF jsonb_typeof(p_scene) IS DISTINCT FROM 'object' OR p_scene->>'generator' IS DISTINCT FROM 'candy-jar'
 OR jsonb_typeof(p_scene->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(p_scene->'objects') NOT BETWEEN 40 AND 120
 OR p_image_path IS NULL OR p_image_path !~ '^[0-9a-f-]+/round-[1-3]/[a-zA-Z0-9_-]+\.svg$' THEN RAISE EXCEPTION 'Invalid next-round scene' USING ERRCODE='22023'; END IF;
INSERT INTO public.games_no_count_it_rounds(match_id,room_id,round_number,status,scene,correct_count,target_color,image_path,preparation_deadline)
VALUES(p_match_id,p_room_id,v_next,'preparing',p_scene,(p_scene->>'correctCount')::integer,p_scene->>'targetColor',p_image_path,v_now+interval '30 seconds') ON CONFLICT(match_id,round_number) DO NOTHING;
INSERT INTO public.games_no_count_it_round_players(match_id,round_number,user_id,status)
SELECT p_match_id,v_next,mp.user_id,'preparing' FROM public.games_no_count_it_match_players mp WHERE mp.match_id=p_match_id AND mp.status='active'
ON CONFLICT(match_id,round_number,user_id) DO NOTHING;
UPDATE public.games_no_count_it_matches SET current_round=v_next WHERE id=p_match_id;
RETURN jsonb_build_object('status','prepared','roundNumber',v_next);
END;$function$;
REVOKE ALL ON FUNCTION public.no_count_it_prepare_next_round(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.no_count_it_prepare_next_round(uuid,uuid,jsonb,text) TO service_role;
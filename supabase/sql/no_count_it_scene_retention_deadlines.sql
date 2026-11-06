-- Store the 24-hour expiry timestamp on every terminal match path.
-- Actual object deletion still requires the Storage API cleanup scheduler.
DO $patch$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.no_count_it_prepare_next_round(uuid,uuid,jsonb,text)'::regprocedure);
 d:=replace(d,
  'UPDATE public.games_no_count_it_matches SET status=''completed'',completed_at=v_now,final_results=v_results,winner_user_id=v_winner WHERE id=p_match_id;',
  'UPDATE public.games_no_count_it_matches SET status=''completed'',completed_at=v_now,final_results=v_results,winner_user_id=v_winner WHERE id=p_match_id; UPDATE public.games_no_count_it_rounds SET delete_after=v_now+interval ''24 hours'' WHERE match_id=p_match_id;');
 EXECUTE d;
 d:=pg_get_functiondef('public.no_count_it_handle_player_leave()'::regprocedure);
 d:=replace(d,'WHERE id=v_match.id;','WHERE id=v_match.id; UPDATE public.games_no_count_it_rounds SET delete_after=v_now+interval ''24 hours'' WHERE match_id=v_match.id;');
 EXECUTE d;
 d:=pg_get_functiondef('public.no_count_it_cancel_match_on_room_cancel()'::regprocedure);
 d:=replace(d,'WHERE room_id=NEW.id AND status IN (''preparing'',''playing'');','WHERE room_id=NEW.id AND status IN (''preparing'',''playing''); UPDATE public.games_no_count_it_rounds SET delete_after=pg_catalog.clock_timestamp()+interval ''24 hours'' WHERE room_id=NEW.id;');
 EXECUTE d;
 d:=pg_get_functiondef('public.no_count_it_finalize_preparation(uuid,uuid)'::regprocedure);
 d:=replace(d,'UPDATE public.games_no_count_it_matches SET status=''technical_aborted'',completed_at=v_now WHERE id=p_match_id;','UPDATE public.games_no_count_it_matches SET status=''technical_aborted'',completed_at=v_now WHERE id=p_match_id; UPDATE public.games_no_count_it_rounds SET delete_after=v_now+interval ''24 hours'' WHERE match_id=p_match_id;');
 EXECUTE d;
 d:=pg_get_functiondef('public.no_count_it_round_ready(uuid,uuid,text)'::regprocedure);
 d:=replace(d,'UPDATE public.games_no_count_it_matches SET status=''technical_aborted'',completed_at=v_now WHERE id=p_match_id;','UPDATE public.games_no_count_it_matches SET status=''technical_aborted'',completed_at=v_now WHERE id=p_match_id; UPDATE public.games_no_count_it_rounds SET delete_after=v_now+interval ''24 hours'' WHERE match_id=p_match_id;');
 EXECUTE d;
END;$patch$;

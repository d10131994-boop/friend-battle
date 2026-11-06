-- Finalize a round when its 30-second preparation window expires.
-- Ready players start together; players who did not load the image are excluded
-- only for this round. A round with zero ready players aborts the match safely.
CREATE OR REPLACE FUNCTION public.no_count_it_finalize_preparation(p_room_id uuid,p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
 v_room public.common_multiplayer_rooms%ROWTYPE;
 v_match public.games_no_count_it_matches%ROWTYPE;
 v_round public.games_no_count_it_rounds%ROWTYPE;
 v_ready integer;
 v_now timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id=p_room_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_match FROM public.games_no_count_it_matches WHERE id=p_match_id AND room_id=p_room_id FOR UPDATE;
 IF NOT FOUND OR v_match.status NOT IN ('preparing','playing') OR v_room.status<>'playing' OR v_room.started_at IS DISTINCT FROM v_match.started_at THEN
  RAISE EXCEPTION 'Match is no longer active' USING ERRCODE='55000';
 END IF;
 SELECT * INTO v_round FROM public.games_no_count_it_rounds WHERE match_id=p_match_id AND round_number=v_match.current_round FOR UPDATE;
 IF NOT FOUND OR v_round.status<>'preparing' OR v_now<v_round.preparation_deadline THEN
  RETURN jsonb_build_object('status','waiting');
 END IF;
 SELECT count(*) INTO v_ready FROM public.games_no_count_it_round_players
 WHERE match_id=p_match_id AND round_number=v_match.current_round AND status='ready';
 UPDATE public.games_no_count_it_round_players
 SET status=CASE WHEN status='ready' THEN 'active' ELSE 'excluded_not_ready' END
 WHERE match_id=p_match_id AND round_number=v_match.current_round AND status IN ('ready','preparing');
 IF v_ready=0 THEN
  UPDATE public.games_no_count_it_rounds SET status='technical_aborted',completed_at=v_now WHERE id=v_round.id;
  UPDATE public.games_no_count_it_matches SET status='technical_aborted',completed_at=v_now WHERE id=p_match_id;
  RETURN jsonb_build_object('status','technical_aborted','startedAt',v_match.started_at);
 END IF;
 UPDATE public.games_no_count_it_rounds SET status='showing',show_started_at=v_now,answer_deadline=v_now+interval '15 seconds' WHERE id=v_round.id;
 UPDATE public.games_no_count_it_matches SET status='playing' WHERE id=p_match_id;
 RETURN jsonb_build_object('status','started');
END;$function$;
REVOKE ALL ON FUNCTION public.no_count_it_finalize_preparation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.no_count_it_finalize_preparation(uuid,uuid) TO service_role;

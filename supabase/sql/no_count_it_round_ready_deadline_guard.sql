-- Prevent a late image load from joining a round after its preparation deadline.
CREATE OR REPLACE FUNCTION public.no_count_it_round_ready(p_room_id uuid,p_match_id uuid,p_user_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
 v_room public.common_multiplayer_rooms%ROWTYPE; v_match public.games_no_count_it_matches%ROWTYPE;
 v_round public.games_no_count_it_rounds%ROWTYPE; v_unready integer; v_ready integer;
 v_now timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 SELECT * INTO v_room FROM public.common_multiplayer_rooms WHERE id=p_room_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_match FROM public.games_no_count_it_matches WHERE id=p_match_id AND room_id=p_room_id FOR UPDATE;
 IF NOT FOUND OR v_match.status NOT IN ('preparing','playing') OR v_room.status<>'playing' OR v_room.started_at IS DISTINCT FROM v_match.started_at THEN
  RAISE EXCEPTION 'Match is no longer active' USING ERRCODE='55000';
 END IF;
 SELECT * INTO v_round FROM public.games_no_count_it_rounds WHERE match_id=p_match_id AND round_number=v_match.current_round FOR UPDATE;
 IF NOT FOUND OR v_round.status<>'preparing' THEN RAISE EXCEPTION 'Round is not preparing' USING ERRCODE='55000'; END IF;
 IF v_now<v_round.preparation_deadline THEN
  UPDATE public.games_no_count_it_round_players SET status='ready' WHERE match_id=p_match_id AND round_number=v_match.current_round AND user_id=p_user_id AND status='preparing';
  IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM public.games_no_count_it_round_players WHERE match_id=p_match_id AND round_number=v_match.current_round AND user_id=p_user_id AND status='ready') THEN
   RAISE EXCEPTION 'Player is not eligible for this round' USING ERRCODE='42501';
  END IF;
  SELECT count(*) FILTER(WHERE status='preparing'),count(*) FILTER(WHERE status='ready') INTO v_unready,v_ready
  FROM public.games_no_count_it_round_players WHERE match_id=p_match_id AND round_number=v_match.current_round;
  IF v_unready>0 THEN RETURN jsonb_build_object('status','waiting','readyCount',v_ready); END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.games_no_count_it_round_players WHERE match_id=p_match_id AND round_number=v_match.current_round AND user_id=p_user_id) THEN
   RAISE EXCEPTION 'Player is not in this match' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_ready FROM public.games_no_count_it_round_players WHERE match_id=p_match_id AND round_number=v_match.current_round AND status='ready';
 END IF;
 UPDATE public.games_no_count_it_round_players SET status=CASE WHEN status='ready' THEN 'active' ELSE 'excluded_not_ready' END
 WHERE match_id=p_match_id AND round_number=v_match.current_round AND status IN ('preparing','ready');
 IF v_ready=0 THEN
  UPDATE public.games_no_count_it_rounds SET status='technical_aborted',completed_at=v_now WHERE id=v_round.id;
  UPDATE public.games_no_count_it_matches SET status='technical_aborted',completed_at=v_now WHERE id=p_match_id;
  RETURN jsonb_build_object('status','technical_aborted','startedAt',v_match.started_at);
 END IF;
 UPDATE public.games_no_count_it_rounds SET status='showing',show_started_at=v_now,answer_deadline=v_now+interval '15 seconds' WHERE id=v_round.id;
 UPDATE public.games_no_count_it_matches SET status='playing' WHERE id=p_match_id;
 RETURN jsonb_build_object('status','started','readyCount',v_ready);
END;$function$;
REVOKE ALL ON FUNCTION public.no_count_it_round_ready(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.no_count_it_round_ready(uuid,uuid,text) TO service_role;

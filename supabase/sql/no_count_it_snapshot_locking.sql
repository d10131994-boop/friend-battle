-- Locking for snapshot-driven phase transitions. Room -> match -> round lock order
-- prevents concurrent polling clients from scoring a round more than once.
CREATE OR REPLACE FUNCTION public.no_count_it_match_snapshot(p_room_id uuid,p_user_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
 v_room jsonb; v_match public.games_no_count_it_matches%ROWTYPE; v_round public.games_no_count_it_rounds%ROWTYPE;
 v_players jsonb; v_round_players jsonb; v_all_answered boolean; v_active_count integer; v_answered_count integer;
 v_average bigint; v_now timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.common_multiplayer_players WHERE room_id=p_room_id AND user_id=p_user_id) THEN
  RAISE EXCEPTION 'Player is not a member of this room' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.common_multiplayer_rooms WHERE id=p_room_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE='P0002'; END IF;
 SELECT public.multiplayer_room_snapshot(p_room_id) INTO v_room;
 SELECT * INTO v_match FROM public.games_no_count_it_matches
 WHERE room_id=p_room_id AND status IN ('preparing','playing','completed','technical_aborted','cancelled')
 ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('room',v_room,'match',NULL); END IF;
 SELECT * INTO v_round FROM public.games_no_count_it_rounds
 WHERE match_id=v_match.id AND round_number=v_match.current_round FOR UPDATE;
 IF FOUND AND v_match.status='playing' AND v_round.status='showing' AND v_now>=v_round.show_started_at+interval '5 seconds' THEN
  UPDATE public.games_no_count_it_rounds SET status='answering' WHERE id=v_round.id;
  v_round.status:='answering';
 END IF;
 IF FOUND AND v_match.status='playing' AND v_round.status IN ('showing','answering') THEN
  SELECT count(*) FILTER(WHERE status IN ('active','completed')),count(*) FILTER(WHERE status='completed')
  INTO v_active_count,v_answered_count FROM public.games_no_count_it_round_players
  WHERE match_id=v_match.id AND round_number=v_match.current_round;
  v_all_answered:=v_active_count>0 AND v_answered_count=v_active_count;
  IF v_all_answered OR v_now>=v_round.answer_deadline THEN
   UPDATE public.games_no_count_it_round_players SET error=v_round.correct_count,status='completed'
   WHERE match_id=v_match.id AND round_number=v_match.current_round AND status='active';
   SELECT COALESCE(ceil(avg(error) FILTER(WHERE status='completed')),0)::bigint INTO v_average
   FROM public.games_no_count_it_round_players WHERE match_id=v_match.id AND round_number=v_match.current_round AND status='completed';
   UPDATE public.games_no_count_it_round_players SET error=v_average,status='completed'
   WHERE match_id=v_match.id AND round_number=v_match.current_round AND status='excluded_not_ready';
   UPDATE public.games_no_count_it_match_players mp SET total_error=mp.total_error+rp.error
   FROM public.games_no_count_it_round_players rp
   WHERE rp.match_id=v_match.id AND rp.round_number=v_match.current_round AND rp.user_id=mp.user_id AND mp.match_id=v_match.id;
   UPDATE public.games_no_count_it_rounds SET status='revealing',reveal_started_at=v_now
   WHERE id=v_round.id AND status IN ('showing','answering');
   v_round.status:='revealing';
  END IF;
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',mp.user_id,'displayName',mp.display_name,'totalError',mp.total_error,
  'roundErrors',(SELECT jsonb_agg(rp.error ORDER BY rp.round_number) FROM public.games_no_count_it_round_players rp WHERE rp.match_id=mp.match_id AND rp.user_id=mp.user_id)
 ) ORDER BY mp.joined_at,mp.user_id),'[]'::jsonb)
 INTO v_players FROM public.games_no_count_it_match_players mp WHERE mp.match_id=v_match.id;
 IF v_round.id IS NOT NULL THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',mp.user_id,'displayName',mp.display_name,'status',rp.status,
   'answer',CASE WHEN v_round.status IN ('revealing','completed') THEN rp.answer ELSE NULL END,
   'error',CASE WHEN v_round.status IN ('revealing','completed') THEN rp.error ELSE NULL END,
   'answeredAt',CASE WHEN v_round.status IN ('revealing','completed') THEN rp.answered_at ELSE NULL END
  ) ORDER BY mp.joined_at,mp.user_id),'[]'::jsonb)
  INTO v_round_players FROM public.games_no_count_it_round_players rp
  JOIN public.games_no_count_it_match_players mp ON mp.match_id=rp.match_id AND mp.user_id=rp.user_id
  WHERE rp.match_id=v_match.id AND rp.round_number=v_match.current_round;
 END IF;
 RETURN jsonb_build_object('room',v_room,'match',jsonb_build_object(
  'matchId',v_match.id,'startedAt',v_match.started_at,'status',v_match.status,'currentRound',v_match.current_round,
  'players',v_players,'winnerUserId',v_match.winner_user_id,'finalResults',v_match.final_results,
  'round',CASE WHEN v_round.id IS NULL THEN NULL ELSE jsonb_build_object(
   'roundNumber',v_round.round_number,'status',v_round.status,'targetColor',v_round.target_color,
   'preparationDeadline',v_round.preparation_deadline,'showStartedAt',v_round.show_started_at,'answerDeadline',v_round.answer_deadline,
   'correctCount',CASE WHEN v_round.status IN ('revealing','completed') THEN v_round.correct_count ELSE NULL END,
   'imagePath',v_round.image_path,'players',COALESCE(v_round_players,'[]'::jsonb)
  ) END
 ));
END;$function$;
REVOKE ALL ON FUNCTION public.no_count_it_match_snapshot(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.no_count_it_match_snapshot(uuid,text) TO service_role;

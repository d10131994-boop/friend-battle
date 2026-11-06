-- Handle real player departure separately from round-local not-ready exclusion.
ALTER TABLE public.games_no_count_it_round_players
 DROP CONSTRAINT games_no_count_it_round_players_status_check;
ALTER TABLE public.games_no_count_it_round_players
 ADD CONSTRAINT games_no_count_it_round_players_status_check
 CHECK (status IN ('preparing','ready','active','excluded_not_ready','completed','left'));

CREATE OR REPLACE FUNCTION public.no_count_it_handle_player_leave()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
 v_match public.games_no_count_it_matches%ROWTYPE;
 v_active_count integer;
 v_winner text;
 v_results jsonb;
 v_now timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 SELECT m.* INTO v_match FROM public.games_no_count_it_matches m
 JOIN public.common_multiplayer_rooms r ON r.id=m.room_id
 WHERE m.room_id=OLD.room_id AND m.status IN ('preparing','playing')
  AND r.status='playing' AND r.game_id='no-count-it'
 ORDER BY m.created_at DESC LIMIT 1 FOR UPDATE OF m;
 IF NOT FOUND THEN RETURN OLD; END IF;
 UPDATE public.games_no_count_it_match_players SET status='left'
 WHERE match_id=v_match.id AND user_id=OLD.user_id;
 UPDATE public.games_no_count_it_round_players SET status='left'
 WHERE match_id=v_match.id AND user_id=OLD.user_id AND status IN ('preparing','ready','active');
 SELECT count(*) INTO v_active_count FROM public.games_no_count_it_match_players WHERE match_id=v_match.id AND status='active';
 IF v_active_count=1 THEN
  SELECT user_id INTO v_winner FROM public.games_no_count_it_match_players
  WHERE match_id=v_match.id AND status='active' ORDER BY joined_at,user_id LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',user_id,'displayName',display_name,'totalError',total_error)
    ORDER BY total_error,joined_at,user_id),'[]'::jsonb)
  INTO v_results FROM public.games_no_count_it_match_players WHERE match_id=v_match.id;
  UPDATE public.games_no_count_it_matches SET status='completed',completed_at=v_now,final_results=v_results,winner_user_id=v_winner
  WHERE id=v_match.id;
  INSERT INTO public.common_multiplayer_room_stats(room_id,user_id,wins,matches_played,updated_at)
  SELECT v_match.room_id,mp.user_id,CASE WHEN mp.user_id=v_winner THEN 1 ELSE 0 END,1,v_now
  FROM public.games_no_count_it_match_players mp WHERE mp.match_id=v_match.id
  ON CONFLICT(room_id,user_id) DO UPDATE SET
   wins=public.common_multiplayer_room_stats.wins+EXCLUDED.wins,
   matches_played=public.common_multiplayer_room_stats.matches_played+EXCLUDED.matches_played,
   updated_at=EXCLUDED.updated_at;
 ELSE
  UPDATE public.games_no_count_it_matches SET status='cancelled',completed_at=v_now WHERE id=v_match.id;
 END IF;
 RETURN OLD;
END;$function$;
DROP TRIGGER IF EXISTS no_count_it_player_leave ON public.common_multiplayer_players;
CREATE TRIGGER no_count_it_player_leave AFTER DELETE ON public.common_multiplayer_players
FOR EACH ROW EXECUTE FUNCTION public.no_count_it_handle_player_leave();
REVOKE ALL ON FUNCTION public.no_count_it_handle_player_leave() FROM PUBLIC,anon,authenticated;

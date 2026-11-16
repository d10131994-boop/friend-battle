-- Allow two seconds for in-flight automatic answers after the visible countdown.
DO $do$
DECLARE v_name text; v_def text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['no_count_it_match_snapshot','no_count_it_submit_answer'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=v_name;
    IF v_name='no_count_it_match_snapshot' THEN
      v_def:=replace(v_def,'v_now >= v_round.answer_deadline THEN',
        'v_now >= v_round.answer_deadline + interval ''2 seconds'' THEN');
    ELSE
      v_def:=replace(v_def,'v_now > v_round.answer_deadline THEN',
        'v_now > v_round.answer_deadline + interval ''2 seconds'' THEN');
    END IF;
    EXECUTE v_def;
  END LOOP;
END $do$;

-- Private, server-only staging for images prepared during the previous round reveal.
CREATE TABLE IF NOT EXISTS public.games_no_count_it_prefetched_scenes (
  match_id uuid NOT NULL REFERENCES public.games_no_count_it_matches(id) ON DELETE CASCADE,
  round_number smallint NOT NULL CHECK (round_number BETWEEN 2 AND 3),
  state text NOT NULL CHECK (state IN ('generating','ready')),
  scene jsonb,
  image_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,round_number)
);
ALTER TABLE public.games_no_count_it_prefetched_scenes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.games_no_count_it_prefetched_scenes FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.games_no_count_it_prefetched_scenes TO service_role;

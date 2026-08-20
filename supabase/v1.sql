-- v1 — two fixes found while pulling schema.sql for the first time.
-- Run whole file in Supabase > SQL Editor.
--
-- 1. round_votes_insert policy: the "must have 2 submissions before voting"
--    check compared submissions.game_prompt_id to itself instead of to
--    round_votes.game_prompt_id, so it always evaluated true. cast_vote()
--    enforces the real check, so this wasn't exploitable through that RPC,
--    but the RLS-layer guard was dead weight. Fixed to actually correlate.
--
-- 2. Drops two functions confirmed unused by the client: draw_next_prompt(uuid)
--    (the 1-arg overload — the app only ever calls the (uuid, boolean) form)
--    and use_bonus_prompt(uuid) (superseded by draw_next_prompt's p_double).
--
-- A third suspected issue — "pg_cron has zero scheduled jobs" — turned out
-- to be a false positive: `supabase db dump --schema cron` silently came
-- back empty even though two jobs (youtwo-ai-generation, youtwo-hourly-sweep)
-- were already active. `supabase db query`, which goes through the
-- Management API instead of a direct pg_dump connection, found them. This
-- file briefly (a few minutes) added two duplicate jobs on top of the
-- working ones before that was caught; they were unscheduled by hand right
-- after. Nothing to run here for that part — schema.sql's scheduled-jobs
-- section now documents the two jobs that were there all along.

-- 1. fix round_votes_insert -------------------------------------------

drop policy if exists "round_votes_insert" on round_votes;
create policy "round_votes_insert"
  on round_votes for insert
  to authenticated
  with check (
    voter_id = auth.uid()
    and is_game_member((select game_id from game_prompts where id = round_votes.game_prompt_id))
    and (select count(*) from submissions s where s.game_prompt_id = round_votes.game_prompt_id) = 2
    and exists (
      select 1 from game_members gm
      join game_prompts gp on gp.game_id = gm.game_id
      where gp.id = round_votes.game_prompt_id and gm.user_id = round_votes.voted_for
    )
  );

-- 2. drop dead functions -------------------------------------------------

drop function if exists draw_next_prompt(uuid);
drop function if exists use_bonus_prompt(uuid);

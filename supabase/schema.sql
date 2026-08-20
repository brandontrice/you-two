-- YouTwo — run this whole file in Supabase > SQL Editor.
-- (Brandon's SQL style: lowercase keywords.)
--
-- This is the full, current schema as pulled from the live project (ref
-- imbsuawcafkdvmccitie) on 2026-08-20, folded together with v1.sql's two
-- fixes: every table, column, function, trigger, policy, storage rule, and
-- scheduled job the app uses today, in one file. Safe to run on a
-- brand-new project, and safe to re-run on a project that already has
-- some or all of this: every statement below is written to skip anything
-- that already exists. v1.sql is kept alongside this file as the
-- historical record of how those two fixes originally shipped against
-- the live database — a fresh install only needs this file.

-- 1. extensions -----------------------------------------------------------

create extension if not exists "pg_cron" with schema pg_catalog;
create extension if not exists "pg_net" with schema extensions;
create extension if not exists "pg_stat_statements" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "supabase_vault" with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- 2. tables -----------------------------------------------------------

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  queue_type text not null check (queue_type = any (array['partner','sibling','parent','general'])),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists game_members (
  game_id uuid not null references games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists onboarding_questions (
  idx int primary key,
  body text not null
);

create table if not exists onboarding_answers (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_idx int not null references onboarding_questions(idx),
  answer text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_idx)
);

create table if not exists prompts (
  id serial primary key,
  body text not null,
  queue_type text not null check (queue_type = any (array['partner','sibling','parent','general'])),
  source text not null default 'seed' check (source = any (array['seed','ai'])),
  game_id uuid references games(id) on delete cascade
);

create table if not exists game_prompts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  prompt_id int not null references prompts(id),
  is_bonus boolean not null default false,
  dropped_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stakes int not null default 1 check (stakes = any (array[1, 2])),
  declared_by uuid references auth.users(id),
  unique (game_id, prompt_id)
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  game_prompt_id uuid not null references game_prompts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  photo_path text not null,
  caption text,
  reaction text,
  submitted_at timestamptz not null default now(),
  unique (game_prompt_id, user_id)
);

create table if not exists round_votes (
  game_prompt_id uuid not null references game_prompts(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  voted_for uuid references auth.users(id),
  voted_at timestamptz not null default now(),
  primary key (game_prompt_id, voter_id)
);

-- Locked down from clients (RLS enabled, no policies) — only touched via
-- the SECURITY DEFINER functions below (buy_skip, my_games_overview).
create table if not exists point_spends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  cost int not null check (cost > 0),
  reason text not null,
  spent_at timestamptz not null default now()
);

create table if not exists user_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  completions int not null default 0,
  bonus_balance int not null default 0 check (bonus_balance >= 0 and bonus_balance <= 3),
  last_milestone int not null default 0,
  shuffles_used_today date,
  skip_balance int not null default 1,
  primary key (user_id, game_id)
);

-- Locked down from clients (RLS enabled, no policies) — only touched via
-- the SECURITY DEFINER use_skip() function below.
create table if not exists shuffle_log (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  prompt_id int not null references prompts(id),
  user_id uuid not null references auth.users(id),
  shuffled_at timestamptz not null default now()
);

create index if not exists idx_game_prompts_game on game_prompts using btree (game_id, dropped_at desc);
create index if not exists idx_prompts_ai on prompts using btree (game_id) where (source = 'ai');
create index if not exists idx_submissions_gp on submissions using btree (game_prompt_id);

-- 3. functions -----------------------------------------------------------

-- Old overloads superseded below (draw_next_prompt(uuid, boolean) and
-- pick_prompt/AI generation replace what these did) — dropped explicitly
-- since `create or replace` doesn't touch a different-signature overload.
drop function if exists draw_next_prompt(uuid);
drop function if exists use_bonus_prompt(uuid);

create or replace function both_onboarded(p_game_id uuid) returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
    select count(*) = 2
    from game_members gm
    where gm.game_id = p_game_id
      and (select count(*) from onboarding_answers oa where oa.user_id = gm.user_id)
          = (select count(*) from onboarding_questions);
$$;

create or replace function buy_skip(p_game_id uuid) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    earned int;
    spent int;
begin
    if not is_game_member(p_game_id) then
        raise exception 'not a member of this game';
    end if;

    select coalesce(sum(gpx.stakes), 0) into earned
    from round_votes rv
    join game_prompts gpx on gpx.id = rv.game_prompt_id
    where gpx.game_id = p_game_id and rv.voted_for = auth.uid();

    select coalesce(sum(cost), 0) into spent
    from point_spends
    where user_id = auth.uid() and game_id = p_game_id;

    if earned - spent < 2 then
        raise exception 'not enough points — a skip costs 2';
    end if;

    insert into point_spends (user_id, game_id, cost, reason)
    values (auth.uid(), p_game_id, 2, 'skip');

    insert into user_stats (user_id, game_id, skip_balance)
    values (auth.uid(), p_game_id, 2)
    on conflict (user_id, game_id)
    do update set skip_balance = user_stats.skip_balance + 1;
end;
$$;

create or replace function cast_vote(p_game_prompt_id uuid, p_voted_for uuid) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    gid uuid;
begin
    select game_id into gid from game_prompts where id = p_game_prompt_id;
    if gid is null then
        raise exception 'round not found';
    end if;
    if not is_game_member(gid) then
        raise exception 'not a member of this game';
    end if;
    if (select count(*) from submissions s where s.game_prompt_id = p_game_prompt_id) < 2 then
        raise exception 'the reveal comes before the vote';
    end if;
    if not exists (
        select 1 from game_members where game_id = gid and user_id = p_voted_for
    ) then
        raise exception 'invalid vote target';
    end if;
    if has_voted(p_game_prompt_id) then
        raise exception 'your ballot is already sealed';
    end if;

    insert into round_votes (game_prompt_id, voter_id, voted_for)
    values (p_game_prompt_id, auth.uid(), p_voted_for);
end;
$$;

create or replace function create_game(p_queue_type text) returns json
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    code text;
    gid uuid;
begin
    if p_queue_type not in ('partner','sibling','parent','general') then
        raise exception 'invalid queue type';
    end if;

    loop
        code := upper(substr(md5(random()::text), 1, 6));
        exit when not exists (select 1 from games where invite_code = code);
    end loop;

    insert into games (invite_code, queue_type, created_by)
    values (code, p_queue_type, auth.uid())
    returning id into gid;

    insert into game_members (game_id, user_id) values (gid, auth.uid());

    return json_build_object('game_id', gid, 'invite_code', code);
end;
$$;

create or replace function draw_next_prompt(p_game_id uuid, p_double boolean default false) returns uuid
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    latest record;
    chosen int;
    new_id uuid;
    bal int;
begin
    if not is_game_member(p_game_id) then
        raise exception 'not a member of this game';
    end if;
    if not both_onboarded(p_game_id) then
        raise exception 'both players must finish their questions first';
    end if;

    select gp.id, gp.expires_at,
        (select count(*) from submissions s where s.game_prompt_id = gp.id) as subs
    into latest
    from game_prompts gp
    where gp.game_id = p_game_id
    order by gp.dropped_at desc
    limit 1;

    -- Active prompt already exists: return it, and never charge.
    if latest.id is not null
       and latest.subs < 2
       and latest.expires_at > now() then
        return latest.id;
    end if;

    if latest.id is not null
       and latest.subs = 2
       and not has_voted(latest.id) then
        raise exception 'award the round before moving on';
    end if;

    if p_double then
        select bonus_balance into bal
        from user_stats
        where user_id = auth.uid() and game_id = p_game_id;
        if coalesce(bal, 0) < 1 then
            raise exception 'no encores to spend';
        end if;
    end if;

    chosen := pick_prompt(p_game_id);
    if chosen is null then
        raise exception 'no prompts left for this game';
    end if;

    if p_double then
        update user_stats
        set bonus_balance = bonus_balance - 1
        where user_id = auth.uid() and game_id = p_game_id;
    end if;

    insert into game_prompts (game_id, prompt_id, is_bonus, dropped_at, expires_at, stakes, declared_by)
    values (
        p_game_id, chosen, false, now(), now() + interval '24 hours',
        case when p_double then 2 else 1 end,
        case when p_double then auth.uid() else null end
    )
    returning id into new_id;

    return new_id;
end;
$$;

-- Called by pg_cron (nightly) — see the pg_cron job that invokes this.
create or replace function drop_daily_prompts() returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    g record;
    latest record;
    chosen int;
begin
    for g in
        select gm.game_id
        from game_members gm
        group by gm.game_id
        having count(*) = 2
    loop
        if not both_onboarded(g.game_id) then
            continue;
        end if;

        select gp.id, gp.expires_at
        into latest
        from game_prompts gp
        where gp.game_id = g.game_id
        order by gp.dropped_at desc
        limit 1;

        -- Any unexpired latest prompt — answered or mid-vote — is left alone.
        if latest.id is not null and latest.expires_at > now() then
            continue;
        end if;

        chosen := pick_prompt(g.game_id);
        if chosen is not null then
            insert into game_prompts (game_id, prompt_id, is_bonus, dropped_at, expires_at)
            values (g.game_id, chosen, false, now(), now() + interval '24 hours');
        end if;
    end loop;
end;
$$;

create or replace function drop_first_prompt(p_game_id uuid) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    chosen int;
begin
    if (select count(*) from game_members where game_id = p_game_id) <> 2 then
        return;
    end if;
    if not both_onboarded(p_game_id) then
        return;
    end if;
    if exists (select 1 from game_prompts where game_id = p_game_id) then
        return;
    end if;

    chosen := pick_prompt(p_game_id);
    if chosen is not null then
        insert into game_prompts (game_id, prompt_id, is_bonus, dropped_at, expires_at)
        values (p_game_id, chosen, false, now(), now() + interval '24 hours');
    end if;
end;
$$;

create or replace function game_timeline(p_game_id uuid) returns table (
    gp_id uuid, prompt_body text, is_bonus boolean, dropped_at timestamptz,
    stakes int, sub_id uuid, sub_user uuid, display_name text,
    photo_path text, caption text, reaction text, votes_for int
)
    language sql security definer
    set search_path to 'public'
    as $$
    select
        gp.id,
        pr.body,
        gp.is_bonus,
        gp.dropped_at,
        gp.stakes,
        s.id,
        s.user_id,
        p.display_name,
        s.photo_path,
        s.caption,
        s.reaction,
        (select count(*)::int from round_votes rv
            where rv.game_prompt_id = gp.id and rv.voted_for = s.user_id)
    from game_prompts gp
    join prompts pr on pr.id = gp.prompt_id
    join submissions s on s.game_prompt_id = gp.id
    join profiles p on p.id = s.user_id
    where gp.game_id = p_game_id
      and is_game_member(p_game_id)
      and (
          (select count(*) from submissions s2 where s2.game_prompt_id = gp.id) = 2
          or gp.expires_at < now()
      )
    order by gp.dropped_at desc, s.user_id;
$$;

-- Fires on onboarding_answers insert (trg_onboarding_complete below): once
-- this user has answered every question, kicks off AI prompt generation
-- for every fully-paired game they're in.
create or replace function handle_onboarding_complete() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    total int;
    mine int;
    g record;
begin
    select count(*) into total from onboarding_questions;
    select count(*) into mine
    from onboarding_answers
    where user_id = new.user_id;

    if mine = total then
        for g in
            select gm.game_id
            from game_members gm
            where gm.user_id = new.user_id
              and (select count(*) from game_members x where x.game_id = gm.game_id) = 2
        loop
            perform invoke_generation(g.game_id);
        end loop;
    end if;

    return new;
end;
$$;

-- Fires on submissions insert (trg_submission_stats below): bumps
-- completions and awards a bonus (encore) prompt at milestone counts.
create or replace function handle_submission() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    gid uuid;
    new_completions int;
    milestone int;
begin
    select game_id into gid from game_prompts where id = new.game_prompt_id;

    insert into user_stats (user_id, game_id, completions)
    values (new.user_id, gid, 1)
    on conflict (user_id, game_id)
    do update set completions = user_stats.completions + 1
    returning completions into new_completions;

    select max(m) into milestone
    from unnest(array[5,15,30,50,75,100]) as m
    where m <= new_completions;

    if milestone is not null then
        update user_stats
        set bonus_balance = least(bonus_balance + 1, 3),
            last_milestone = milestone
        where user_id = new.user_id
          and game_id = gid
          and last_milestone < milestone;
    end if;

    return new;
end;
$$;

create or replace function has_submitted(p_game_prompt_id uuid) returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
    select exists (
        select 1 from submissions
        where game_prompt_id = p_game_prompt_id and user_id = auth.uid()
    );
$$;

create or replace function has_voted(p_game_prompt_id uuid) returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
    select exists (
        select 1 from round_votes
        where game_prompt_id = p_game_prompt_id and voter_id = auth.uid()
    );
$$;

-- Calls the generate-prompts Edge Function over HTTP (pg_net), using the
-- shared secret stored in Vault as 'youtwo_cron_secret'. Never raises —
-- a missing secret or failed request only logs a warning.
create or replace function invoke_generation(p_game_id uuid default null::uuid) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    secret text;
    payload jsonb;
begin
    select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'youtwo_cron_secret';

    if secret is null then
        raise warning 'youtwo_cron_secret not found in vault';
        return;
    end if;

    payload := case
        when p_game_id is null then '{}'::jsonb
        else jsonb_build_object('game_id', p_game_id)
    end;

    perform net.http_post(
        url := 'https://imbsuawcafkdvmccitie.supabase.co/functions/v1/generate-prompts',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', secret
        ),
        body := payload
    );
exception when others then
    raise warning 'invoke_generation failed: %', sqlerrm;
end;
$$;

create or replace function is_game_member(p_game_id uuid) returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
    select exists (
        select 1 from game_members
        where game_id = p_game_id and user_id = auth.uid()
    );
$$;

create or replace function join_game(p_invite_code text) returns uuid
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    gid uuid;
    member_count int;
begin
    select id into gid from games where invite_code = upper(trim(p_invite_code));
    if gid is null then
        raise exception 'invalid invite code';
    end if;

    select count(*) into member_count from game_members where game_id = gid;
    if member_count >= 2
       and not exists (select 1 from game_members where game_id = gid and user_id = auth.uid()) then
        raise exception 'game is full';
    end if;

    insert into game_members (game_id, user_id)
    values (gid, auth.uid())
    on conflict do nothing;

    if (select count(*) from game_members where game_id = gid) = 2 then
        perform invoke_generation(gid);
        perform drop_first_prompt(gid);
    end if;

    return gid;
end;
$$;

create or replace function my_games_overview() returns table (
    game_id uuid, invite_code text, queue_type text, partner_id uuid,
    partner_name text, member_count int, gp_id uuid, prompt_body text,
    is_bonus boolean, dropped_at timestamptz, expires_at timestamptz,
    stakes int, declared_by uuid, i_submitted boolean, partner_submitted boolean,
    my_completions int, my_bonus_balance int, i_onboarded boolean,
    partner_onboarded boolean, my_score int, partner_score int,
    i_voted boolean, partner_voted boolean, my_vote_for uuid,
    their_vote_for uuid, my_skip_balance int
)
    language sql security definer
    set search_path to 'public'
    as $$
    select
        g.id,
        g.invite_code,
        g.queue_type,
        other.user_id,
        p.display_name,
        (select count(*)::int from game_members gm2 where gm2.game_id = g.id),
        gp.id,
        pr.body,
        gp.is_bonus,
        gp.dropped_at,
        gp.expires_at,
        gp.stakes,
        gp.declared_by,
        exists (
            select 1 from submissions s
            where s.game_prompt_id = gp.id and s.user_id = auth.uid()
        ),
        exists (
            select 1 from submissions s
            where s.game_prompt_id = gp.id and s.user_id <> auth.uid()
        ),
        coalesce(us.completions, 0),
        coalesce(us.bonus_balance, 0),
        (select count(*) from onboarding_answers oa where oa.user_id = auth.uid())
            = (select count(*) from onboarding_questions),
        other.user_id is not null
            and (select count(*) from onboarding_answers oa where oa.user_id = other.user_id)
                = (select count(*) from onboarding_questions),
        coalesce((select sum(gpx.stakes)::int from round_votes rv
            join game_prompts gpx on gpx.id = rv.game_prompt_id
            where gpx.game_id = g.id and rv.voted_for = auth.uid()), 0)
        - coalesce((select sum(ps.cost)::int from point_spends ps
            where ps.game_id = g.id and ps.user_id = auth.uid()), 0),
        coalesce((select sum(gpx.stakes)::int from round_votes rv
            join game_prompts gpx on gpx.id = rv.game_prompt_id
            where gpx.game_id = g.id and rv.voted_for = other.user_id), 0)
        - coalesce((select sum(ps.cost)::int from point_spends ps
            where ps.game_id = g.id and ps.user_id = other.user_id), 0),
        exists (
            select 1 from round_votes rv
            where rv.game_prompt_id = gp.id and rv.voter_id = auth.uid()
        ),
        exists (
            select 1 from round_votes rv
            where rv.game_prompt_id = gp.id and rv.voter_id <> auth.uid()
        ),
        (select rv.voted_for from round_votes rv
            where rv.game_prompt_id = gp.id and rv.voter_id = auth.uid()),
        case
            when exists (
                select 1 from round_votes rv
                where rv.game_prompt_id = gp.id and rv.voter_id = auth.uid()
            ) or gp.expires_at < now()
            then (select rv.voted_for from round_votes rv
                  where rv.game_prompt_id = gp.id and rv.voter_id <> auth.uid())
            else null
        end,
        coalesce(us.skip_balance, 1)
    from games g
    join game_members me
        on me.game_id = g.id and me.user_id = auth.uid()
    left join game_members other
        on other.game_id = g.id and other.user_id <> auth.uid()
    left join profiles p
        on p.id = other.user_id
    left join lateral (
        select x.id, x.prompt_id, x.is_bonus, x.dropped_at, x.expires_at,
               x.stakes, x.declared_by
        from game_prompts x
        where x.game_id = g.id
        order by x.dropped_at desc
        limit 1
    ) gp on true
    left join prompts pr
        on pr.id = gp.prompt_id
    left join user_stats us
        on us.game_id = g.id and us.user_id = auth.uid()
    order by g.created_at desc;
$$;

create or replace function on_this_day() returns table (
    game_id uuid, gp_id uuid, prompt_body text, dropped_at timestamptz, partner_name text
)
    language sql security definer
    set search_path to 'public'
    as $$
    select
        gp.game_id,
        gp.id,
        pr.body,
        gp.dropped_at,
        p.display_name
    from game_prompts gp
    join prompts pr on pr.id = gp.prompt_id
    join game_members me on me.game_id = gp.game_id and me.user_id = auth.uid()
    left join game_members o on o.game_id = gp.game_id and o.user_id <> auth.uid()
    left join profiles p on p.id = o.user_id
    where gp.dropped_at < now() - interval '7 days'
      and (select count(*) from submissions s where s.game_prompt_id = gp.id) = 2
    order by random()
    limit 1;
$$;

-- Half the time (once both players are onboarded) draws from this game's
-- unused AI pool; otherwise falls back to the seed deck for the game's
-- queue_type (70%) or the general deck (30%), always excluding prompts
-- already played in this game.
create or replace function pick_prompt(p_game_id uuid) returns integer
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    qt text;
    cat text;
    chosen int;
begin
    select queue_type into qt from games where id = p_game_id;

    -- AI branch: only when BOTH players have finished onboarding.
    if both_onboarded(p_game_id) and random() < 0.5 then
        select p.id into chosen
        from prompts p
        where p.source = 'ai'
          and p.game_id = p_game_id
          and not exists (
              select 1 from game_prompts gp
              where gp.game_id = p_game_id and gp.prompt_id = p.id
          )
        order by random()
        limit 1;
    end if;

    if chosen is not null then
        return chosen;
    end if;

    cat := case
        when qt = 'general' then 'general'
        when random() < 0.7 then qt
        else 'general'
    end;

    select p.id into chosen
    from prompts p
    where p.source = 'seed'
      and p.game_id is null
      and p.queue_type = cat
      and not exists (
          select 1 from game_prompts gp
          where gp.game_id = p_game_id and gp.prompt_id = p.id
      )
    order by random()
    limit 1;

    if chosen is null then
        select p.id into chosen
        from prompts p
        where p.source = 'seed'
          and p.game_id is null
          and not exists (
              select 1 from game_prompts gp
              where gp.game_id = p_game_id and gp.prompt_id = p.id
          )
        order by random()
        limit 1;
    end if;

    return chosen;
end;
$$;

create or replace function react_to(p_submission_id uuid, p_emoji text) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    s record;
begin
    select sub.*, gp.game_id, gp.expires_at
    into s
    from submissions sub
    join game_prompts gp on gp.id = sub.game_prompt_id
    where sub.id = p_submission_id;

    if s.id is null then
        raise exception 'submission not found';
    end if;

    if s.user_id = auth.uid() then
        raise exception 'cannot react to your own photo';
    end if;

    if not is_game_member(s.game_id) then
        raise exception 'not a member of this game';
    end if;

    if not has_submitted(s.game_prompt_id) and s.expires_at > now() then
        raise exception 'submit yours first';
    end if;

    if char_length(coalesce(p_emoji, '')) > 8 then
        raise exception 'reaction too long';
    end if;

    update submissions set reaction = p_emoji where id = p_submission_id;
end;
$$;

create or replace function use_skip(p_game_id uuid) returns uuid
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    bal int;
    gp record;
    chosen int;
begin
    if not is_game_member(p_game_id) then
        raise exception 'not a member of this game';
    end if;

    select skip_balance into bal
    from user_stats
    where user_id = auth.uid() and game_id = p_game_id;

    if coalesce(bal, 1) < 1 then
        raise exception 'no skips left';
    end if;

    select x.id, x.prompt_id into gp
    from game_prompts x
    where x.game_id = p_game_id
    order by x.dropped_at desc
    limit 1;

    if gp.id is null then
        raise exception 'no prompt to skip';
    end if;
    if exists (select 1 from submissions s where s.game_prompt_id = gp.id) then
        raise exception 'someone already answered, the prompt is locked in';
    end if;
    if (select expires_at from game_prompts where id = gp.id) <= now() then
        raise exception 'this prompt has already expired';
    end if;

    chosen := pick_prompt(p_game_id);
    if chosen is null then
        raise exception 'no prompts left to skip to';
    end if;

    insert into shuffle_log (game_id, prompt_id, user_id)
    values (p_game_id, gp.prompt_id, auth.uid());

    update game_prompts
    set prompt_id = chosen,
        dropped_at = now(),
        expires_at = now() + interval '24 hours'
    where id = gp.id;

    insert into user_stats (user_id, game_id, skip_balance)
    values (auth.uid(), p_game_id, 0)
    on conflict (user_id, game_id)
    do update set skip_balance = user_stats.skip_balance - 1;

    return gp.id;
end;
$$;

-- 4. triggers -----------------------------------------------------------

drop trigger if exists trg_onboarding_complete on onboarding_answers;
create trigger trg_onboarding_complete
  after insert on onboarding_answers
  for each row execute function handle_onboarding_complete();

drop trigger if exists trg_submission_stats on submissions;
create trigger trg_submission_stats
  after insert on submissions
  for each row execute function handle_submission();

-- 5. row level security ------------------------------------------------

alter table games enable row level security;
alter table game_members enable row level security;
alter table profiles enable row level security;
alter table onboarding_questions enable row level security;
alter table onboarding_answers enable row level security;
alter table prompts enable row level security;
alter table game_prompts enable row level security;
alter table submissions enable row level security;
alter table round_votes enable row level security;
alter table point_spends enable row level security;
alter table user_stats enable row level security;
alter table shuffle_log enable row level security;

drop policy if exists "games_select" on games;
create policy "games_select"
  on games for select
  to authenticated
  using (is_game_member(id));

drop policy if exists "game_members_select" on game_members;
create policy "game_members_select"
  on game_members for select
  to authenticated
  using (is_game_member(game_id));

drop policy if exists "profiles_select" on profiles;
create policy "profiles_select"
  on profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_insert" on profiles;
create policy "profiles_insert"
  on profiles for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update" on profiles;
create policy "profiles_update"
  on profiles for update
  to authenticated
  using (id = auth.uid());

drop policy if exists "oq_select" on onboarding_questions;
create policy "oq_select"
  on onboarding_questions for select
  to authenticated
  using (true);

drop policy if exists "oa_select" on onboarding_answers;
create policy "oa_select"
  on onboarding_answers for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "oa_insert" on onboarding_answers;
create policy "oa_insert"
  on onboarding_answers for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "oa_update" on onboarding_answers;
create policy "oa_update"
  on onboarding_answers for update
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "prompts_select" on prompts;
create policy "prompts_select"
  on prompts for select
  to authenticated
  using (true);

drop policy if exists "game_prompts_select" on game_prompts;
create policy "game_prompts_select"
  on game_prompts for select
  to authenticated
  using (is_game_member(game_id));

-- A player can see their own submission any time, and their partner's once
-- they've submitted too (has_submitted) or the round has expired.
drop policy if exists "submissions_select" on submissions;
create policy "submissions_select"
  on submissions for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      is_game_member((select game_id from game_prompts where id = submissions.game_prompt_id))
      and (
        has_submitted(game_prompt_id)
        or exists (select 1 from game_prompts gp where gp.id = submissions.game_prompt_id and gp.expires_at < now())
      )
    )
  );

drop policy if exists "submissions_insert" on submissions;
create policy "submissions_insert"
  on submissions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and is_game_member((select game_id from game_prompts where id = submissions.game_prompt_id))
    and now() < (select expires_at from game_prompts where id = submissions.game_prompt_id)
  );

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

drop policy if exists "round_votes_select" on round_votes;
create policy "round_votes_select"
  on round_votes for select
  to authenticated
  using (
    voter_id = auth.uid()
    or (
      is_game_member((select game_id from game_prompts where id = round_votes.game_prompt_id))
      and (
        has_voted(game_prompt_id)
        or exists (select 1 from game_prompts gp where gp.id = round_votes.game_prompt_id and gp.expires_at < now())
      )
    )
  );

drop policy if exists "user_stats_select" on user_stats;
create policy "user_stats_select"
  on user_stats for select
  to authenticated
  using (is_game_member(game_id));

-- point_spends and shuffle_log: RLS enabled, no policies — fully locked
-- down from clients, reachable only through the SECURITY DEFINER functions
-- above (buy_skip, use_skip). This is deliberate, not an oversight.

-- 6. realtime -----------------------------------------------------------

-- alter publication ... add table has no "if not exists" — guard each one
-- by hand so this stays safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_prompts'
  ) then
    alter publication supabase_realtime add table game_prompts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'round_votes'
  ) then
    alter publication supabase_realtime add table round_votes;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'submissions'
  ) then
    alter publication supabase_realtime add table submissions;
  end if;
end $$;

-- 7. storage -----------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

-- Path convention: {game_id}/{game_prompt_id}/{user_id}.jpg — the first
-- path segment is the game_id, so membership gates access directly.
drop policy if exists "photos_select" on storage.objects;
create policy "photos_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'photos' and is_game_member((storage.foldername(name))[1]::uuid));

drop policy if exists "photos_insert" on storage.objects;
create policy "photos_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'photos' and is_game_member((storage.foldername(name))[1]::uuid));

-- 8. scheduled jobs -------------------------------------------------------

-- youtwo-ai-generation tops up each game's AI prompt pool once daily.
-- youtwo-hourly-sweep is the actual mechanism that keeps a game from
-- getting stuck on an expired, under-answered prompt — running hourly
-- rather than nightly, which is more robust than generate-prompts's own
-- "called nightly by cron" comment suggests. cron.schedule upserts by
-- job_name, so this is safe to re-run.

select cron.schedule(
  'youtwo-ai-generation',
  '0 7 * * *',
  $$select invoke_generation()$$
);

select cron.schedule(
  'youtwo-hourly-sweep',
  '0 * * * *',
  $$select drop_daily_prompts()$$
);

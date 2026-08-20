-- v2 — two additions from the scope review.
-- Run whole file in Supabase > SQL Editor.
--
-- 1. handle_new_user trigger: profiles.id = auth.uid() has always relied on
--    sign-in.tsx inserting the profile row client-side right after
--    auth.signUp() succeeds. If that insert fails, or the app is killed
--    mid-signup, the account ends up authenticated with no profile row,
--    and every downstream `.single()` profile query silently breaks.
--    Moves profile creation into an atomic trigger on auth.users, reading
--    display_name out of signUp's options.data (sign-in.tsx now passes
--    it there instead of inserting separately).
--
-- 2. home_overview(): app/index.tsx made 4 separate round trips on every
--    screen focus (my_games_overview, a profiles select, an
--    onboarding_answers count, on_this_day). Folds all four into one RPC
--    call returning json — same data, one round trip.

-- 1. atomic profile creation ---------------------------------------------

create or replace function handle_new_user() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
begin
    insert into profiles (id, display_name)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 2. consolidated home screen data ----------------------------------------

create or replace function home_overview() returns json
    language sql security definer
    set search_path to 'public'
    as $$
    select json_build_object(
        'display_name', (select display_name from profiles where id = auth.uid()),
        'answered_count', (select count(*) from onboarding_answers where user_id = auth.uid()),
        'on_this_day', (select row_to_json(t) from (select * from on_this_day() limit 1) t),
        'games', (select coalesce(json_agg(g), '[]'::json) from my_games_overview() g)
    );
$$;

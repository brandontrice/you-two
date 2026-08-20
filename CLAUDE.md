@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YouTwo — a two-player daily-prompt photo game (the Expo Router / Supabase rewrite of the earlier "Duet" project, same author, separate Supabase project). Each day a pair gets one shared prompt; each player answers with one photo (taken or found) and an optional caption. Once both have answered, photos reveal simultaneously, players react and vote for their favorite, and points build a running score. Prompts come from a seed deck or are generated per-game by Claude Haiku from both players' onboarding answers and play history. Beyond romantic partners, games also support sibling / parent / general relationship types (`queue_type`).

Design language: French-postcard, two swappable themes — "Café Crème" (day: aged paper, bordeaux, brass) and "Minuit" (night: ink-blue, moonlit gold) — Playfair Display + Cormorant Garamond, theme-linked background music.

## Commands

```bash
npm install
npx expo start      # dev server; press i/a/w for iOS/Android/web, or scan the QR in Expo Go
npm run android      # expo start --android
npm run ios          # expo start --ios
npm run web          # expo start --web
npm run lint         # expo lint (eslint-config-expo flat config)
```

There is no test runner configured (no `npm test`). `npm run reset-project` is a leftover from the `create-expo-app` scaffold — `scripts/reset-project.js` doesn't exist in this repo (only under the unused `app-example/`), so that script fails if run; see the scope list for cleanup.

## Architecture

**Stack:** Expo SDK 54 (Expo Router ~6, React Native 0.81, React 19, New Architecture + React Compiler both enabled), Supabase (Postgres + Auth + Storage + Realtime) as the only backend, one Supabase Edge Function calling Claude Haiku for prompt generation. File-based routing lives in `app/`.

Always check the exact versioned Expo docs at https://docs.expo.dev/versions/v54.0.0/ before writing Expo-specific code (see AGENTS.md, imported above) — SDK 54 has moved past what most training data assumes.

**Screens** (`app/`): `sign-in.tsx` (email/password), `index.tsx` (home — game list via the `my_games_overview()` RPC, lifetime stats, "on this day" callback), `new-game.tsx` (create or join-by-code), `onboarding.tsx` (10 personal questions, resumable, skippable — feeds prompt personalization), `game/[id].tsx` (the core loop: prompt, photo submit, reveal, react, vote, draw next, skip), `timeline/[id].tsx` (per-game scrapbook of every revealed round, grouped by `game_prompt_id`).

**lib/**: `supabase.ts` (single shared client, AsyncStorage-backed session, foreground-only auto-refresh via `AppState`), `auth.tsx` (`AuthProvider`/`useAuth` context wrapping `onAuthStateChange`), `theme.ts` + `theme-context.tsx` (the two palettes, persisted mode), `audio.tsx` (theme-linked background music, persisted on/off), `anim.tsx` (hand-rolled `Animated` API kit — `Reveal`, `Pop`, `LetterCascade`, `Twinkle`, `CountUp` — despite `react-native-reanimated` being a dependency, nothing in `app/` currently uses it), `notify.ts` (local-only notifications; the comment notes real remote push needs an EAS dev build, not Expo Go).

**Every screen owns a `makeStyles(c: Palette)` factory**, memoized with `useMemo(() => makeStyles(c), [c])` so styles recompute only when the theme flips. This is the established convention — follow it for new screens rather than inlining styles or calling `StyleSheet.create` outside a factory.

**Data shape**: `GameOverview` (defined in `app/index.tsx`, imported by `game/[id].tsx`) is one big denormalized row from the `my_games_overview()` RPC — game + membership + current prompt + both players' submission/vote/score state in a single call. `game_timeline()` RPC does the equivalent flattening for the timeline screen (one row per submission, grouped client-side by `gp_id`).

**Realtime**: `game/[id].tsx` opens three separate `postgres_changes` channels per mount (`submissions`, `round_votes`, `game_prompts`, each filtered to the current game/round) and calls `load()` — a full RPC re-fetch — on any change, rather than merging the changed row into state.

**Photos**: stored in the private `photos` Storage bucket at `${game_id}/${game_prompt_id}/${user_id}.jpg`; every read goes through a fresh 1-hour `createSignedUrl` call, fetched one photo at a time in a loop (not batched) in both `game/[id].tsx` and `timeline/[id].tsx`. Rendered with plain React Native `Image`, even though `expo-image` is already a dependency and currently unused anywhere in `app/`.

**Edge Function** (`supabase/functions/generate-prompts/index.ts`, Deno): shared-secret-gated (`x-cron-secret` header), scans all games (or one, if given a `game_id` in the request body), tops up each game's unused AI-prompt pool via Claude Haiku (`claude-haiku-4-5-20251001`) once both players have fully completed onboarding — reading both players' answers, the last 15 rounds' captions/reactions, and recently shuffled-away prompts as context. Drops the first personalized prompt immediately on generation for a brand-new game so finishing onboarding pays off right away.

## Database / migrations

**`supabase/schema.sql` is the full current schema** — every table, column, function, trigger, policy, storage rule, and scheduled job the app uses today, pulled from the live project (`youtwo`, ref `imbsuawcafkdvmccitie`) via `npx supabase db dump --linked` and hand-formatted into Brandon's SQL style. Safe to run on a fresh project or re-run on this one (everything is `if not exists` / `drop policy if exists` / `cron.schedule`-upserts guarded). `supabase/v1.sql` and `v2.sql` are migrations already run against the live project (`v1` via `npx supabase db query --linked -f supabase/v1.sql`, `v2` by hand through the SQL Editor) — kept as the historical record of what shipped and why; already folded into `schema.sql`, so a fresh install only needs that file.

**v1.sql's two fixes:**
1. `round_votes_insert`'s submission-count check was a self-comparison (`s.game_prompt_id = s.game_prompt_id`, always true), so the RLS-layer "must have 2 submissions before voting" guard was vacuous — `cast_vote()` enforced the real check, so it wasn't exploitable through that path, but the defense-in-depth was dead. Fixed to correlate to `round_votes.game_prompt_id`.
2. Dropped two functions confirmed dead from the client — `draw_next_prompt(uuid)` (1-arg overload; the app only ever calls the `(uuid, boolean)` form) and `use_bonus_prompt(uuid)` (superseded by `draw_next_prompt(..., p_double)`).

A third suspected issue — "`pg_cron` has zero scheduled jobs" — was a false positive from `supabase db dump --schema cron` coming back empty; `supabase db query` (Management API instead of a direct pg_dump connection) found two jobs that were there all along: `youtwo-ai-generation` (`0 7 * * *` → `invoke_generation()`) and `youtwo-hourly-sweep` (`0 * * * *` → `drop_daily_prompts()`, hourly rather than nightly — more robust than `generate-prompts`'s own "called nightly by cron" comment suggests). Two duplicate jobs were briefly created against the live DB before this was caught, then unscheduled by hand within minutes. `schema.sql`'s scheduled-jobs section documents the real two jobs. **Lesson for next time**: prefer `supabase db query --linked` over `db dump --schema <x>` when checking whether something exists in a schema `pg_dump` might not fully cover (like `cron`) — verify via query before concluding something is missing.

**v2.sql's two additions:**
1. `handle_new_user()` trigger (`on_auth_user_created` on `auth.users`) creates the `profiles` row atomically with signup, reading `display_name` out of `signUp`'s `options.data` (falls back to the email's local part if missing). `sign-in.tsx` used to insert the profile row client-side right after `auth.signUp()` succeeded — a killed signup or a failed insert left an authenticated user with no profile row, silently breaking every downstream `.single()` profile query. `sign-in.tsx` now passes `display_name` through signup metadata instead.
2. `home_overview()` folds `app/index.tsx`'s home-screen data — display name, onboarding progress, "on this day," and the game list — into one RPC call returning `json`, replacing 4 separate round trips (`my_games_overview`, a `profiles` select, an `onboarding_answers` count, `on_this_day`) fired on every screen focus.

Core tables: `games`, `game_members`, `profiles`, `onboarding_questions`, `onboarding_answers`, `prompts` (+ `id` sequence), `game_prompts`, `submissions`, `round_votes`, `point_spends`, `user_stats`, `shuffle_log`. `point_spends` and `shuffle_log` have RLS enabled with zero policies — intentionally reachable only through `SECURITY DEFINER` functions, not directly from clients.

RPCs called from the client: `home_overview` (home screen), `my_games_overview` (still called directly from `game/[id].tsx`), `game_timeline(p_game_id)`, `create_game(p_queue_type)`, `join_game(p_invite_code)`, `react_to(p_submission_id, p_emoji)`, `draw_next_prompt(p_game_id, p_double)`, `cast_vote(p_game_prompt_id, p_voted_for)`, `use_skip(p_game_id)`, `buy_skip(p_game_id)`.

## SQL style for this project

(From `schema.sql`'s own header comment.) Keywords lowercase (`select`, `from`, `where`, `create table`, etc.), never capitalized; table and column identifiers keep whatever case they were created with. New migrations follow the `vN.sql` pattern used across Brandon's Supabase projects: a header comment stating what the file does and "Run whole file in Supabase > SQL Editor," full standalone runnable SQL (not a diff) — never a partial `ALTER`-only fragment that depends on a prior file's state. When a change ships, fold it into `schema.sql` too, same as `cate-photo`, so it stays the single source of truth for a fresh install.

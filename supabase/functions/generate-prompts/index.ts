// generate-prompts — Supabase Edge Function (Deno)
// Called nightly by cron and on-demand when a game gets its second player.
// Reads both players' onboarding answers + play history, asks Claude Haiku
// for 10 personalized photo prompts, inserts them scoped to the game.
// Auth: shared secret header. The Anthropic key never leaves this function.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-haiku-4-5-20251001";
const TARGET_POOL = 10; // generate up to this many per batch
const MIN_POOL = 5; // regenerate when unused AI prompts drop below this

const SYSTEM_PROMPT = `You write prompts for a two-player photo game called YouTwo. Each day, BOTH players get the same short prompt and EACH must respond with one photo and an optional caption. A photo can be TAKEN (camera) or FOUND (camera roll, a saved image, a screenshot-worthy find) — so prompts about celebrities, memes, or "the best X" are fair game.

Work in two steps:

STEP 1 — Read like a detective. Go through both players' answers and the play history and extract the SPECIFIC, NAMED details: artists, bands, shows, pets and their names, dishes, hobbies, places, running jokes. List the shared themes AND the exact details. These verbatim specifics are your raw material — a prompt that names the actual thing beats a generic one every time.

STEP 2 — Write prompts anchored in what they actually said. The golden rule: BOTH players must be able to answer every prompt with a photo (taken or found). Test each prompt against each player separately.

Voice: write like the funny friend in the group chat. Modern, playful, a little competitive. Superlatives, challenges, and cheeky negations are your best tools:
- "the hottest picture of Zayn Malik you can find" (if someone mentioned One Direction)
- "the cutest dog breed not named beagle" (if they have beagles — the joke only works because you paid attention)
- "a dinner that would make Gordon Ramsay put the insults away"
- "the most unhinged photo in your camera roll from this month"

Rules:
- ground EVERY prompt in something actually present in the answers or history — never invent an interest nobody mentioned; if you feel the urge to invent, generalize instead
- best prompts FUSE one detail from each player into a single prompt; write several of these
- use their exact words for names and things — specificity is the product
- when a detail belongs to only ONE player, frame it so the other can still answer ("the pet — or honorary pet — in your life"), or turn it into a findable-photo challenge both can play
- 5 to 14 words, one photo only, suit the relationship type
- never repeat or closely paraphrase prompts listed as already used
- avoid the style of anything the players shuffled away

Respond with ONLY valid JSON, no markdown fences, no commentary:
{"shared_themes": ["...", "..."], "prompts": ["...", "..."]}`;

type Ctx = {
  gameId: string;
  queueType: string;
  players: { name: string; answers: string[] }[];
  history: string[];
  shuffledAway: string[];
  existingAi: string[];
  seedSamples: string[];
  needed: number;
  totalQuestions: number;
};

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let targetGameId: string | null = null;
  try {
    const body = await req.json();
    targetGameId = body?.game_id ?? null;
  } catch {
    // empty body = scan all games
  }

  // ---- find eligible games ----
  const { data: games, error: gamesErr } = await db
    .from("games")
    .select("id, queue_type, game_members(user_id)");
  if (gamesErr) return json({ error: gamesErr.message }, 500);

  const results: Record<string, string> = {};

  for (const g of games ?? []) {
    if (targetGameId && g.id !== targetGameId) continue;
    const memberIds = (g.game_members ?? []).map((m: any) => m.user_id);
    if (memberIds.length !== 2) continue;

    // unused AI prompt count for this game
    const { data: aiPrompts } = await db
      .from("prompts")
      .select("id, body")
      .eq("source", "ai")
      .eq("game_id", g.id);
    const { data: usedRows } = await db
      .from("game_prompts")
      .select("prompt_id")
      .eq("game_id", g.id);
    const usedIds = new Set((usedRows ?? []).map((r) => r.prompt_id));
    const unusedAi = (aiPrompts ?? []).filter((p) => !usedIds.has(p.id));

    if (!targetGameId && unusedAi.length >= MIN_POOL) {
      results[g.id] = `skipped (pool: ${unusedAi.length})`;
      continue;
    }

    const ctx = await buildContext(db, g.id, g.queue_type, memberIds, {
      existingAi: (aiPrompts ?? []).map((p) => p.body),
      needed: TARGET_POOL - unusedAi.length,
    });

    // GATE: personalized generation requires BOTH players fully onboarded,
    // so prompts are always built on common ground, never one biography.
    const totalQuestions = ctx.totalQuestions;
    const notReady = ctx.players.filter((p) => p.answers.length < totalQuestions);
    if (notReady.length > 0) {
      results[g.id] =
        `skipped (waiting on onboarding: ${notReady.map((p) => p.name).join(", ")})`;
      continue;
    }

    try {
      const prompts = await generate(ctx);
      if (prompts.length > 0) {
        const rows = prompts.map((body) => ({
          body,
          queue_type: g.queue_type,
          source: "ai",
          game_id: g.id,
        }));
        const { data: inserted, error: insErr } = await db
          .from("prompts")
          .insert(rows)
          .select("id");
        results[g.id] = insErr ? `insert failed: ${insErr.message}` : `generated ${prompts.length}`;

        // First round of a brand-new game: drop a personalized prompt
        // immediately, so finishing onboarding pays off with the real thing.
        if (!insErr && inserted && inserted.length > 0) {
          const { count } = await db
            .from("game_prompts")
            .select("id", { count: "exact", head: true })
            .eq("game_id", g.id);
          if ((count ?? 0) === 0) {
            const firstId = inserted[Math.floor(Math.random() * inserted.length)].id;
            const { error: dropErr } = await db.from("game_prompts").insert({
              game_id: g.id,
              prompt_id: firstId,
              is_bonus: false,
              dropped_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            });
            if (!dropErr) results[g.id] += " + first prompt dropped";
          }
        }
      } else {
        results[g.id] = "model returned nothing usable";
      }
    } catch (e) {
      results[g.id] = `generation failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return json({ results });
});

async function buildContext(
  db: ReturnType<typeof createClient>,
  gameId: string,
  queueType: string,
  memberIds: string[],
  extra: { existingAi: string[]; needed: number },
): Promise<Ctx> {
  const { data: profiles } = await db
    .from("profiles")
    .select("id, display_name")
    .in("id", memberIds);

  const { data: questions } = await db
    .from("onboarding_questions")
    .select("idx, body")
    .order("idx");

  const { data: answers } = await db
    .from("onboarding_answers")
    .select("user_id, question_idx, answer")
    .in("user_id", memberIds);

  const players = memberIds.map((uid) => {
    const name = profiles?.find((p) => p.id === uid)?.display_name ?? "Player";
    const theirAnswers = (answers ?? [])
      .filter((a) => a.user_id === uid)
      .sort((a, b) => a.question_idx - b.question_idx)
      .map((a) => {
        const q = questions?.find((qq) => qq.idx === a.question_idx)?.body ?? "";
        return `Q: ${q}\nA: ${a.answer}`;
      });
    return { name, answers: theirAnswers };
  });

  // last 15 played prompts, with captions and reactions as taste signal
  const { data: recent } = await db
    .from("game_prompts")
    .select("id, dropped_at, prompts(body)")
    .eq("game_id", gameId)
    .order("dropped_at", { ascending: false })
    .limit(15);

  const gpIds = (recent ?? []).map((r) => r.id);
  const { data: subs } = gpIds.length
    ? await db
        .from("submissions")
        .select("game_prompt_id, user_id, caption, reaction")
        .in("game_prompt_id", gpIds)
    : { data: [] };

  const history = (recent ?? []).map((r: any) => {
    const body = r.prompts?.body ?? "";
    const notes = (subs ?? [])
      .filter((s) => s.game_prompt_id === r.id)
      .map((s) => {
        const who = profiles?.find((p) => p.id === s.user_id)?.display_name ?? "?";
        const bits = [
          s.caption ? `caption: "${s.caption}"` : null,
          s.reaction ? `got reaction ${s.reaction}` : null,
        ].filter(Boolean);
        return bits.length ? `${who} ${bits.join(", ")}` : null;
      })
      .filter(Boolean);
    return notes.length ? `"${body}" — ${notes.join("; ")}` : `"${body}"`;
  });

  const { data: shuffles } = await db
    .from("shuffle_log")
    .select("prompts(body)")
    .eq("game_id", gameId)
    .order("shuffled_at", { ascending: false })
    .limit(10);
  const shuffledAway = (shuffles ?? []).map((s: any) => s.prompts?.body).filter(Boolean);

  const { data: seeds } = await db
    .from("prompts")
    .select("body")
    .eq("source", "seed")
    .eq("queue_type", queueType)
    .limit(8);
  const seedSamples = (seeds ?? []).map((s) => s.body);

  return {
    gameId,
    queueType,
    players,
    history,
    shuffledAway,
    existingAi: extra.existingAi,
    seedSamples,
    needed: Math.max(extra.needed, 1),
    totalQuestions: (questions ?? []).length,
  };
}

async function generate(ctx: Ctx): Promise<string[]> {
  const userPrompt = [
    `Relationship type: ${ctx.queueType}`,
    ``,
    ...ctx.players.map((p) =>
      p.answers.length
        ? `About ${p.name}:\n${p.answers.join("\n")}`
        : `About ${p.name}: (no answers provided)`,
    ),
    ``,
    ctx.history.length
      ? `Recently played prompts (with captions/reactions as taste signal):\n${ctx.history.map((h) => `- ${h}`).join("\n")}`
      : `No prompts played yet.`,
    ctx.shuffledAway.length
      ? `\nPrompts the players shuffled away (avoid this style):\n${ctx.shuffledAway.map((s) => `- "${s}"`).join("\n")}`
      : ``,
    ctx.existingAi.length
      ? `\nAlready generated (do not repeat or closely paraphrase):\n${ctx.existingAi.map((s) => `- "${s}"`).join("\n")}`
      : ``,
    `\nHouse style examples:\n${ctx.seedSamples.map((s) => `- "${s}"`).join("\n")}`,
    `\nFirst extract the shared themes AND the specific named details from these two people's answers, then write ${ctx.needed} new prompts. Quote their actual details, fuse both players' worlds where you can, keep the group-chat voice, and make every prompt answerable with a photo — taken or found — by BOTH of them.`,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text =
    (data.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  const clean = text.replace(/```json|```/g, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("model response was not valid JSON");
  }

  const raw = (parsed as { prompts?: unknown }).prompts;
  if (!Array.isArray(raw)) throw new Error("missing prompts array");
  // shared_themes is the model's scratchpad — it improves the prompts by
  // forcing the overlap-finding step, but we do not store it.

  const known = new Set(
    [...ctx.existingAi, ...ctx.seedSamples].map((s) => s.toLowerCase().trim()),
  );

  return raw
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter((p) => p.length >= 10 && p.length <= 120)
    .filter((p) => !known.has(p.toLowerCase()))
    .slice(0, ctx.needed);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
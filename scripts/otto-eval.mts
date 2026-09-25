/**
 * Otto's grounded fallback, checked against real listings: `npm run otto:eval`.
 *
 * A random sample of shipped listings, the long-tail questions the rule engine has no line for ("can we bring
 * a cake", "is it wheelchair accessible", "do you do gift cards"), and the real model behind the real key. For
 * each question the rules answer first; only a gap goes to the model, exactly as the page does it. What comes
 * back is printed next to what the model wrote before the checks, so a dropped sentence is visible: a total it
 * added up, a fact it remembered from somewhere else, a claim that cited nothing.
 *
 * Never tuned to one listing. The sample is seeded so a run repeats, and `--seed=` picks another. It spends
 * real calls: `--calls=` caps them (default 24, under the trial key's 20 a minute at the pace kept here), and
 * `--model=` tries another Cohere model on the same sample.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../backend/.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { companyAnswer, companyFacts } = await import("../src/lib/companyAgent.ts");
const { groundedAnswer, model: defaultModel } = await import("../backend/src/lib/cohere.ts");
type Unclaimed = import("../src/data/types.ts").Unclaimed;

const arg = (k: string, d: string) => (process.argv.find((a) => a.startsWith("--" + k + "="))?.split("=")[1] ?? d);
const SEED = Number(arg("seed", "7"));
const MAX_CALLS = Number(arg("calls", "24"));
const MODEL = arg("model", defaultModel());
const LISTINGS = Number(arg("listings", "8"));
const PACE_MS = 3300;

const QUESTIONS = [
  "can we bring a birthday cake?",
  "is it wheelchair accessible?",
  "do you do gift cards?",
  "is there parking?",
  "do we need to book ahead or can we just show up?",
  "do you allow dogs?",
  "is there somewhere to leave our bags?",
  "can my 8 year old do this?",
  "how much is it for 3 people?",
  "what happens if it rains?",
];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const catalog = JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8")) as { operators: Unclaimed[] };
const pool = catalog.operators.filter((o) => !o.affiliate && o.assistant !== false && !o.thin && !o.unlisted);
const rand = rng(SEED);
const picked: Unclaimed[] = [];
const seen = new Set<string>();
while (picked.length < LISTINGS && seen.size < pool.length) {
  const o = pool[Math.floor(rand() * pool.length)];
  if (seen.has(o.id)) continue;
  seen.add(o.id);
  const file = new URL("../public/o/" + (o.detail || o.id) + ".json", import.meta.url);
  if (!existsSync(file)) continue;
  const d = JSON.parse(readFileSync(file, "utf8")) as Unclaimed;
  const rich = (d.hoursText?.length || 0) + (d.policies?.length || 0) + (d.faq?.length || 0) + (d.requirements?.length || 0) + (d.includes?.length || 0);
  if (rich < 3) continue;
  picked.push(d);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
const tally = { gaps: 0, answered: 0, gapOnly: 0, empty: 0, dropped: 0, ms: 0, failed: 0 };

console.log("model " + MODEL + ", seed " + SEED + ", " + picked.length + " listings, up to " + MAX_CALLS + " calls\n");
outer: for (const item of picked) {
  const ctx = { item, contact: item.contact ?? null, live: null };
  const facts = companyFacts(ctx);
  console.log("== " + item.title + " (" + item.id + ") · " + facts.length + " facts, " + facts.reduce((n, f) => n + f.text.length, 0) + " chars");
  for (const q of QUESTIONS) {
    const rules = companyAnswer(ctx, q);
    if (!rules.gap) continue;
    tally.gaps++;
    if (calls >= MAX_CALLS) break outer;
    calls++;
    try {
      const g = await groundedAnswer({ shop: item.title, question: q, facts, model: MODEL });
      tally.ms += g.ms;
      tally.dropped += g.dropped;
      if (g.text && g.cited.length) tally.answered++;
      else if (g.text) tally.gapOnly++;
      else tally.empty++;
      console.log("  Q: " + q);
      console.log("     rules: " + rules.text);
      console.log("     model: " + (g.text ?? "(nothing survived)") + (g.cited.length ? "  [" + g.cited.join(", ") + "]" : "") + (g.dropped ? "  dropped " + g.dropped : "") + "  " + g.ms + "ms");
      if (g.dropped || g.raw !== g.text) console.log("     wrote: " + g.raw.replace(/\s+/g, " ").slice(0, 240));
    } catch (e) {
      tally.failed++;
      console.log("  Q: " + q + "\n     failed: " + (e as Error).message);
    }
    await sleep(PACE_MS);
  }
}

console.log("\n" + calls + " calls on " + tally.gaps + " gap questions: " + tally.answered + " answered with a citation, " + tally.gapOnly + " said they haven't published it, " + tally.empty + " came back empty, " + tally.failed + " failed. " + tally.dropped + " sentences dropped by the checks. Mean " + (calls ? Math.round(tally.ms / calls) : 0) + "ms.");

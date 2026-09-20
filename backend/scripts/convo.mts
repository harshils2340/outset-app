import { plan, type Answer, type Intent } from "../src/concierge/plan.ts";

/**
 * Whole conversations, not single questions.
 *
 * Every other check here asks one thing and looks at the answer. The failures a guest actually meets are in
 * the second and third sentence: a follow-up that forgets the town, a "show me something else" that banishes
 * the only shop with live times for the rest of the session, a stated time that changes nothing, the same
 * apology printed above three answers in a row. None of those are visible one question at a time.
 *
 * So this runs scripted conversations through the same planner the site uses, and asserts the things a person
 * would notice:
 *
 *   carries    the town, activity and party survive every later sentence
 *   answers    no turn comes back empty
 *   else       "something else" returns businesses that are actually else
 *   time       a named time re-ranks the live slots around it
 *   once       a caveat is said once, not on every turn
 *   priced     a turn that shows businesses shows what they cost
 *
 *   npx tsx scripts/convo.mts           every conversation
 *   npx tsx scripts/convo.mts waterloo  only the ones whose name matches
 *
 * Exits non-zero on a failure, so it can gate a deploy.
 */

const ESC = String.fromCharCode(27);
const RESET = ESC + "[0m", DIM = ESC + "[2m", RED = ESC + "[31m", GREEN = ESC + "[32m", AMBER = ESC + "[33m", BOLD = ESC + "[1m";
const TICK = "✓", CROSS = "✗";

type Check = "carries" | "answers" | "else" | "time" | "once" | "priced";
type Turn = { say: string; expect: Check[] };
type Convo = { name: string; turns: Turn[] };

const CONVOS: Convo[] = [
  {
    name: "waterloo escape rooms, the one Harshil ran",
    turns: [
      { say: "escape room in Waterloo tonight, 4 of us", expect: ["answers", "priced"] },
      { say: "any other places", expect: ["answers", "else", "carries"] },
      { say: "I need times between 3-5pm", expect: ["answers", "time", "carries", "once"] },
    ],
  },
  {
    name: "toronto, vague then narrowed",
    turns: [
      { say: "something fun in toronto tomorrow evening", expect: ["answers"] },
      { say: "make it puzzles", expect: ["answers", "carries"] },
      { say: "for 6 people", expect: ["answers", "carries"] },
      { say: "anything cheaper", expect: ["answers", "carries", "priced"] },
    ],
  },
  {
    name: "kitchener, time then party then swap",
    turns: [
      { say: "axe throwing near kitchener at 7pm", expect: ["answers", "priced"] },
      { say: "actually 8 of us", expect: ["answers", "carries"] },
      { say: "something else", expect: ["answers", "else", "carries"] },
    ],
  },
  {
    name: "tampa, a different country's worth of catalog",
    turns: [
      { say: "jet ski rental in tampa florida saturday for 2", expect: ["answers"] },
      { say: "anything earlier", expect: ["answers", "carries"] },
      { say: "what else is around", expect: ["answers", "else", "carries"] },
    ],
  },
  {
    name: "vancouver, budget led",
    turns: [
      { say: "escape room in vancouver british columbia under $35 a head", expect: ["answers", "priced"] },
      { say: "tomorrow night instead", expect: ["answers", "carries"] },
      { say: "any other places", expect: ["answers", "else", "carries"] },
    ],
  },
];

const filter = (process.argv[2] || "").toLowerCase();
const run = CONVOS.filter((c) => !filter || c.name.toLowerCase().includes(filter));

const hhmm = (m: number | null | undefined) =>
  m == null ? "-" : String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

let failures = 0;
let checks = 0;

for (const convo of run) {
  console.log("\n" + BOLD + convo.name + RESET);
  let prior: Intent | null = null;
  let firstIntent: Intent | null = null;
  const shownBefore = new Set<string>();
  const caveats = new Map<string, number>();

  for (const turn of convo.turns) {
    const t0 = Date.now();
    const a: Answer = await plan(turn.say, { ask: 3, prior, deadlineMs: 9000 });
    const ms = Date.now() - t0;
    prior = a.intent;
    firstIntent ??= a.intent;

    const domains = a.options.map((o) => o.domain);
    const live = a.options.filter((o) => o.departures.length);
    const priced = a.options.filter((o) => o.services.some((s) => s.price != null) || o.departures.some((d) => d.fromPrice != null));
    if (a.loosened) caveats.set(a.loosened, (caveats.get(a.loosened) ?? 0) + 1);

    const fails: string[] = [];
    for (const want of turn.expect) {
      checks += 1;
      if (want === "answers" && !a.options.length && !a.followUp) fails.push("came back with nothing at all");
      if (want === "carries") {
        // The town and the activity must survive; a later sentence may legitimately change either.
        if (firstIntent.city && !a.intent.city && !a.intent.region) fails.push("forgot where they were");
        if (firstIntent.party > 2 && a.intent.party === 2 && !/\d/.test(turn.say)) fails.push("forgot the party size");
      }
      if (want === "else") {
        const repeats = domains.filter((d) => shownBefore.has(d)).length;
        if (!domains.length) fails.push("asked for something else and got nothing");
        else if (repeats === domains.length) fails.push("every 'other' place had already been shown");
      }
      if (want === "time") {
        if (a.intent.atMinute == null) fails.push("a stated time was not read");
        else if (live.length) {
          const off = live[0].offsets?.[0];
          if (off == null) fails.push("times were not ranked against the time asked for");
          else if (Math.abs(off) > 180) fails.push(`nearest slot is ${Math.round(Math.abs(off) / 60)}h from ${hhmm(a.intent.atMinute)}`);
        }
      }
      if (want === "once") {
        for (const [line, n] of caveats) if (n > 1) fails.push(`said "${line.slice(0, 44)}..." ${n} times`);
      }
      if (want === "priced" && a.options.length && !priced.length) fails.push("showed businesses and not one price");
      if (fails.length) { failures += 1; break; }
    }

    const mark = fails.length ? RED + CROSS : GREEN + TICK;
    const summary = a.followUp
      ? "asked: " + a.followUp.question.slice(0, 40)
      : `${a.options.length} found, ${live.length} live, ${priced.length} priced` +
        (a.intent.atMinute != null && live[0]?.offsets?.[0] != null ? `, nearest ${live[0].departures[0].time} (${live[0].offsets[0] > 0 ? "+" : ""}${live[0].offsets[0]}m)` : "");
    console.log(`  ${mark}${RESET} ${String(ms).padStart(5)}ms  ${turn.say}`);
    console.log(`       ${DIM}${summary}${RESET}`);
    for (const f of fails) console.log(`       ${RED}${f}${RESET}`);
    for (const d of domains) shownBefore.add(d);
  }
}

console.log(
  "\n" + BOLD + checks + " checks across " + run.length + " conversations" + RESET + ": " +
    (failures ? RED + failures + " failed" + RESET : GREEN + "all passed" + RESET),
);
process.exit(failures ? 1 : 0);

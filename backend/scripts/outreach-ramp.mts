import "../src/env.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sendOutreach } from "../src/outreach/send.ts";

/**
 * One call a day from the pipeline scheduler, weekdays only: the warm-up ramp docs/outreach-email.md lays out
 * for a new sending domain (50, 100, 200, 400, then 500 a day), so day one is never a full batch.
 *
 * sendOutreach's own guards (backend/src/outreach/guards.ts) refuse to send at all until CLAIM_SECRET,
 * MAIL_FROM, MAIL_POSTAL and the suppression list are real, so scheduling this before those are set on
 * outset-pipeline is safe: it prints why and sends nothing, the same way every other job here fails safe.
 */

const TZ = process.env.PIPELINE_TZ || "America/Toronto";
const DATA_DIR = dirname(process.env.OUTSET_DB_PATH || "/var/data/outset.db");
const STATE_PATH = join(DATA_DIR, "outreach-ramp.json");
const RAMP = [50, 100, 200, 400, 500];

type State = { firstDay: string; ranDays: string[] };

function todayIn(tz: string): { key: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { key: `${get("year")}-${get("month")}-${get("day")}`, weekday };
}

function loadState(): State {
  try {
    return existsSync(STATE_PATH) ? (JSON.parse(readFileSync(STATE_PATH, "utf8")) as State) : { firstDay: "", ranDays: [] };
  } catch {
    return { firstDay: "", ranDays: [] };
  }
}

function saveState(s: State): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

const { key: today, weekday } = todayIn(TZ);
if (weekday === 0 || weekday === 6) {
  console.log(`outreach-ramp: weekend in ${TZ}, nothing sent`);
  process.exit(0);
}

const state = loadState();
if (state.ranDays.includes(today)) {
  console.log(`outreach-ramp: already ran today (${today})`);
  process.exit(0);
}
if (!state.firstDay) state.firstDay = today;

// The rung on the ramp is how many weekdays this job has actually run on, not the calendar date, so a weekend
// or a worker outage never skips a rung: day 1 the first time this ever runs, day 2 the next weekday it runs.
const day = state.ranDays.length + 1;
const limit = RAMP[Math.min(day, RAMP.length) - 1];

console.log(`outreach-ramp: day ${day} of the ramp (first run ${state.firstDay}), limit ${limit}`);
const result = await sendOutreach({ limit, dry: false });
console.log(`outreach-ramp: ${JSON.stringify(result)}`);

state.ranDays.push(today);
saveState(state);

import "../src/env.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sendOttoOutreach, sentToday } from "../src/outreach/sendOtto.ts";
import { generateOttoDrafts } from "../src/outreach/ottoDrafts.ts";

/**
 * The Otto (AI phone line) campaign's own daily ramp, run alongside outreach-ramp.mts, not instead of it.
 *
 * Otto is a bigger ask than the listing pitch (a trial of something that answers real customer calls, not
 * just a free page), it has no track record yet, and both campaigns send through the same Gmail identity
 * (see mail.ts, outreach-ramp.mts for why a personal account tops out well under Google's raw daily figure).
 * So this ramp is smaller on its own AND checks `sentToday()`, which counts sends from EITHER campaign, so
 * the combined volume from that one mailbox stays under COMBINED_CEILING regardless of which ramp happens to
 * run first on a given day.
 */

const TZ = process.env.PIPELINE_TZ || "America/Toronto";
const DATA_DIR = dirname(process.env.OUTSET_DB_PATH || "/var/data/outset.db");
const STATE_PATH = join(DATA_DIR, "outreach-otto-ramp.json");
const RAMP = [10, 15, 25, 35];
const COMBINED_CEILING = 100;

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
  console.log(`otto-ramp: weekend in ${TZ}, nothing sent`);
  process.exit(0);
}

const state = loadState();
if (state.ranDays.includes(today)) {
  console.log(`otto-ramp: already ran today (${today})`);
  process.exit(0);
}
if (!state.firstDay) state.firstDay = today;

const day = state.ranDays.length + 1;
const rampLimit = RAMP[Math.min(day, RAMP.length) - 1];
const already = sentToday();
const limit = Math.max(0, Math.min(rampLimit, COMBINED_CEILING - already));

console.log(`otto-ramp: day ${day} of the ramp (first run ${state.firstDay}), ramp says ${rampLimit}, ${already} already sent today across both campaigns, sending up to ${limit}`);

if (limit > 0) {
  const n = generateOttoDrafts();
  console.log(`otto-ramp: ${n} draft(s) refreshed`);
  const result = await sendOttoOutreach({ limit, dry: false });
  console.log(`otto-ramp: ${JSON.stringify(result)}`);
} else {
  console.log("otto-ramp: no headroom left today under the combined ceiling, sending nothing");
}

state.ranDays.push(today);
saveState(state);

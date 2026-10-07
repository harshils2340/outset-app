import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { atNoon } from "../agent.ts";
import { addDays, zonedNow, zonedYmd } from "../shopday.ts";

/**
 * Whose clock decides whether a slot has already started.
 *
 * `shopday.ts` says it in its own first paragraph: `render.yaml` sets no TZ for `outset-api`, so "local" on
 * the host is UTC to the letter. Every one of the twelve vendor readers goes through it, or through its own
 * `Intl` twin against the zone its vendor publishes. The two modules with no test of their own, `agent.ts`
 * and `replay.ts`, went through neither, and asked the host: at ten in the morning Pacific every slot before
 * five o'clock read as gone, which is most of a west coast shop's trading day.
 *
 * This is the sweep that found both, kept so a thirteenth reader cannot be written the same way.
 */

const DIR = join(import.meta.dirname, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("nothing in the concierge reads this machine's clock without first asking for the shop's", () => {
  const offenders: string[] = [];
  for (const file of sources(DIR)) {
    const src = readFileSync(file, "utf8");
    if (!/\.getHours\(\)/.test(src)) continue;
    // Either it goes through `shopday.ts`, or it is `shopday.ts` and its twins, which read the zone with `Intl`.
    const viaShopday = /from "\.{1,2}\/(?:\.\.\/)?concierge\/shopday\.ts"|from "\.{1,2}\/shopday\.ts"/.test(src);
    const ownTwin = /Intl\.DateTimeFormat\([^)]*\)|timeZone:/.test(src);
    if (!viaShopday && !ownTwin) offenders.push(file.slice(DIR.length + 1));
  }
  assert.deepEqual(offenders, [], "these read the host's wall clock with no zone in sight");
});

test("a calendar date read back as a date names the same day", () => {
  for (const iso of ["2026-01-01", "2026-03-08", "2026-03-09", "2026-11-01", "2026-12-31", "2026-02-28"]) {
    const d = atNoon(iso);
    assert.equal(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      iso,
    );
    assert.equal(d.getHours(), 12, "noon, so no zone reads it back as the day either side");
  }
});

test("a fortnight on from a calendar date is a fortnight on whatever the clock did in between", () => {
  // The two US daylight saving boundaries of 2026 are 8 March and 1 November.
  for (const iso of ["2026-02-28", "2026-10-25", "2026-03-08", "2026-11-01"]) {
    const control = atNoon(addDays(iso, 14));
    assert.equal(zonedYmd(control, null), addDays(iso, 14));
  }
  assert.equal(addDays("2026-02-28", 14), "2026-03-14");
});

test("the shop's day and the shop's minute come from the same read", () => {
  // Half past nine in the evening in Los Angeles, which by UTC is already tomorrow.
  const evening = new Date("2026-06-15T04:30:00Z");
  assert.equal(zonedYmd(evening, "America/Los_Angeles"), "2026-06-14");
  assert.equal(zonedYmd(evening, null), zonedYmd(evening, "UTC"));
  const here = zonedNow("America/Los_Angeles");
  assert.match(here.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(here.minutes >= 0 && here.minutes < 1440);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Which day `GET /availability/:operatorId` opens its window on when the caller names none.
 *
 * The host this runs on is UTC (`render.yaml` sets no TZ for `outset-api`), so UTC's own date was the default:
 * from eight in the evening Eastern, five in the afternoon Pacific, a caller that named no date was answered
 * about tomorrow, and the rest of tonight, which is the part of the day a guest is most likely to be looking
 * at, was never asked of the vendor at all. Every surface in the app passes `from` off the guest's own clock,
 * so no guest met it; the route's documented default did.
 *
 * The zone comes from the shop's own published record on disk, so the test serves three through STORE_DIR.
 */

const store = mkdtempSync(join(tmpdir(), "outset-avail-"));
mkdirSync(join(store, "o"));
const shops = [
  { id: "o-dusk-fl-com", title: "Dusk Charters", area: "Clearwater, FL" },
  { id: "o-dusk-bc-com", title: "Dusk Kayaks", area: "Vancouver, BC" },
  /** 4,736 shipped rows carry an area with no town in it, and a handful none we can place at all. */
  { id: "o-dusk-nowhere-com", title: "Dusk Unknown", area: "" },
];
for (const s of shops) writeFileSync(join(store, "o", s.id + ".json"), JSON.stringify(s));

process.env.STORE_DIR = store;
const { windowStart } = await import("../availability.ts");

/** 9pm on 1 October in Clearwater, 6pm in Vancouver, which UTC already calls 2 October. */
const eveningEastern = new Date("2026-10-02T01:00:00Z");

test("with no date named, the window opens on the shop's own day, not the host's", async () => {
  assert.equal(eveningEastern.toISOString().slice(0, 10), "2026-10-02", "the instant this test turns on");
  assert.equal(await windowStart("o-dusk-fl-com", "", eveningEastern), "2026-10-01");
  assert.equal(await windowStart("o-dusk-bc-com", "", eveningEastern), "2026-10-01");
});

test("a date the caller names is the date it asks for", async () => {
  assert.equal(await windowStart("o-dusk-fl-com", "2026-11-20", eveningEastern), "2026-11-20");
  // No record to read is not a reason to fail a read.
  assert.equal(await windowStart("o-does-not-exist", "2026-11-20", eveningEastern), "2026-11-20");
});

test("a shop whose zone we cannot place falls back to the host's day", async () => {
  assert.equal(await windowStart("o-dusk-nowhere-com", "", eveningEastern), "2026-10-02");
  assert.equal(await windowStart("o-does-not-exist", "", eveningEastern), "2026-10-02");
});

test("the morning after is the same day everywhere, so nothing is lost the other way", async () => {
  // 10am Eastern on 2 October: UTC and Clearwater agree, and the window must not open on the 1st.
  const morning = new Date("2026-10-02T14:00:00Z");
  assert.equal(await windowStart("o-dusk-fl-com", "", morning), "2026-10-02");
});

import test from "node:test";
import assert from "node:assert/strict";
import { getAvailability } from "../../enrich/availability.ts";
import { cappedDates, crossRead, runChecks } from "../availChecks.ts";
import { loadCases, loadExchanges, loadTruth, withCase } from "../availCases.ts";

/**
 * The availability reader, run against every real booking system in the corpus.
 *
 * No network: each case is a recording of one shop's vendor answering, replayed through globalThis.fetch. The
 * whole suite is a few seconds and can run anywhere, including on a laptop where crawling is not allowed.
 *
 * Three assertions per case, in order of how much they are worth:
 *
 *  1. No rule in availChecks.ts is broken. Each of those is a defect a guest would see, and none of them
 *     needs an authority to judge: a departure at midnight that is not flagged as a placeholder, a sold out
 *     slot still on sale, a time that appears nowhere in what the vendor sent.
 *  2. The reader agrees with a second, separately written reading of the same bytes. Where they differ one of
 *     them is wrong. Days the reader filled to its own 40 slot cap are excluded, because what is missing from
 *     a truncated day says nothing about accuracy.
 *  3. The reader still says what it said when the case was recorded. Weakest of the three and still worth
 *     having: a vendor rewrite or a careless refactor shows up here first. After a deliberate fix, re-capture.
 *
 * Adding shops: `npm run avail:capture`. Scoring them as a table: `npm run avail:report`.
 */

const cases = loadCases();

test("the corpus exists", () => {
  // A fresh clone that has never captured has nothing to replay, and that is not a failure. A corpus that
  // used to have cases and now has none is, so this says which of the two is happening rather than passing
  // silently in both.
  if (!cases.length) {
    console.log("No availability cases recorded. `npm run avail:capture` records some. Skipping the rest.");
    return;
  }
  assert.ok(cases.length > 0);
});

for (const kase of cases) {
  test(`${kase.id}: the answer breaks none of the rules a guest would notice`, async () => {
    const exchanges = loadExchanges(kase.id);
    const { result } = await withCase(exchanges, () => getAvailability(kase.operatorId, kase.from, kase.days));
    const errors = runChecks({ kase, answer: result, exchanges }).filter((f) => f.level === "error");
    assert.deepEqual(
      errors.map((e) => `${e.check}: ${e.detail}`),
      [],
      `${kase.domain} (${kase.vendor})`,
    );
  });

  test(`${kase.id}: agrees with a second reading of the same feed`, async () => {
    const exchanges = loadExchanges(kase.id);
    const { result } = await withCase(exchanges, () => getAvailability(kase.operatorId, kase.from, kase.days));
    const capped = cappedDates(result);
    const uncapped = (xs: Iterable<string>) => new Set([...xs].filter((x) => !capped.has(x.slice(0, 10))));
    const reader = uncapped(result.days.flatMap((d) => d.slots.filter((s) => !s.timeUnknown).map((s) => s.startsAt)));
    const second = uncapped(crossRead(kase.vendor, exchanges, kase.from, kase.days));
    const missed = [...second].filter((x) => !reader.has(x));
    const invented = [...reader].filter((x) => !second.has(x));
    assert.deepEqual({ missed, invented }, { missed: [], invented: [] }, `${kase.domain} (${kase.vendor})`);
  });

  test(`${kase.id}: still answers as it did when this shop was recorded`, async () => {
    const exchanges = loadExchanges(kase.id);
    const { result } = await withCase(exchanges, () => getAvailability(kase.operatorId, kase.from, kase.days));
    // updatedAt is a wall clock reading and differs on every replay by design.
    const same = (a: unknown) => JSON.stringify({ ...(a as object), updatedAt: undefined });
    assert.equal(
      same(result),
      same(kase.observed),
      `${kase.id} replays differently than when it was captured. If the reader was changed on purpose, ` +
        `re-record it with "npm run avail:capture". If not, this is a regression.`,
    );
  });

  const truth = loadTruth(kase.id);
  if (truth) {
    test(`${kase.id}: matches what ${truth.source === "human" ? "a person" : truth.source === "ai" ? "an independent model read" : "the second reading"} says is really bookable`, async () => {
      const exchanges = loadExchanges(kase.id);
      const { result } = await withCase(exchanges, () => getAvailability(kase.operatorId, kase.from, kase.days));
      assert.equal(result.live, truth.live, `${kase.domain}: disagree on whether anything is bookable at all. ${truth.note || ""}`);
      const capped = cappedDates(result);
      const reader = new Set(result.days.flatMap((d) => d.slots.filter((s) => !s.timeUnknown).map((s) => s.startsAt)));
      const missed = truth.starts.filter((x) => !reader.has(x) && !capped.has(x.slice(0, 10)));
      assert.deepEqual(missed, [], `${kase.domain}: bookable starts the reader never offered. ${truth.note || ""}`);
    });
  }
}

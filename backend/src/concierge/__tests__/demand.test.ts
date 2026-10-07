import test from "node:test";
import assert from "node:assert/strict";
import { db, migrate, nowIso } from "../../db/client.ts";
import { demandSummary, demandedTargets, recordDemand } from "../demand.ts";
import type { Option } from "../plan.ts";

/**
 * What guests asked for, fed back to the crawler.
 *
 * `plan()` calls `recordDemand` on every answered question and `enrich/structure.ts` reads the queue back as
 * a prefix on what it crawls next, so this decides which 315,284 untouched sites get looked at first. It had
 * no test of any kind.
 */

migrate();
db.prepare(
  "INSERT OR IGNORE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES ('escape-room','play','Escape room','x','slot','escape room')",
).run();
db.prepare(
  "INSERT OR IGNORE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES ('golf','play','Golf','x','slot','golf')",
).run();

let n = 0;

/** One crawlable operator: a website, not a demo, and no site-structure read against it yet. */
function operator(over: { region?: string | null; category?: string; reviews?: number | null } = {}): string {
  const id = `demand-${++n}`;
  db.prepare(
    `INSERT INTO operators (id, domain, name, website, region, category_id, icon_key, origin, review_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'x', 'osm', ?, ?, ?)`,
  ).run(
    id, `${id}.com`, id, `https://${id}.com`,
    over.region === undefined ? "ON" : over.region,
    over.category ?? "escape-room",
    over.reviews ?? null, nowIso(), nowIso(),
  );
  return id;
}

const option = (domain: string, over: Record<string, unknown> = {}) =>
  ({ domain, departures: [], services: [], bookingUrl: null, ...over }) as unknown as Option;

test("a business somebody was shown and we could not quote is queued, with the reason", () => {
  const id = operator();
  recordDemand({ categoryId: "escape-room", city: "Waterloo", region: "ON" }, [option(`${id}.com`)]);
  const row = db.prepare("SELECT asks, last_reason FROM crawl_demand WHERE operator_id = ?").get(id) as
    | { asks: number; last_reason: string }
    | undefined;
  assert.deepEqual(row && { asks: row.asks, last_reason: row.last_reason }, { asks: 1, last_reason: "no price, no booking link" });
});

test("a business we could already quote is not a crawl target", () => {
  const id = operator();
  recordDemand({ categoryId: "escape-room", city: "Waterloo", region: "ON" }, [
    option(`${id}.com`, { departures: [{ fromPrice: 40 }] }),
  ]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM crawl_demand WHERE operator_id = ?").get(id)?.n, 0);
});

test("a shop with a price and no time says so, and so does one with a link and no price", () => {
  const timeless = operator();
  const priceless = operator();
  recordDemand({ categoryId: "escape-room", city: "Waterloo", region: "ON" }, [
    option(`${timeless}.com`, { services: [{ price: 30 }] }),
    option(`${priceless}.com`, { departures: [{ fromPrice: null }], bookingUrl: "https://x.test/book" }),
  ]);
  const reason = (id: string) =>
    (db.prepare("SELECT last_reason r FROM crawl_demand WHERE operator_id = ?").get(id) as { r: string }).r;
  assert.equal(reason(timeless), "no live times");
  assert.equal(reason(priceless), "no price");
});

test("one question that could be filtered on nothing does not take the whole queue", () => {
  /**
   * The pair's two filters are a category and a region, and a question carrying neither selected every
   * pending operator in the catalog, in the same order the ordinary queue already walks, each one labelled
   * as a business somebody asked for. The queue is a prefix, so that one row filled it to the limit and
   * pushed out every pair that did name a place.
   *
   * It wants a town whose catalog rows carry no region: `operators.region` is nullable and the town lookup
   * in `plan.ts` does not require it, so the sentence resolves to a city with nothing to filter on.
   */
  db.exec("DELETE FROM crawl_demand; DELETE FROM search_demand");
  for (let i = 0; i < 4; i += 1) operator({ category: "golf", region: "FL" });
  recordDemand({ categoryId: null, city: "Nowheresville", region: null }, []);
  assert.deepEqual(demandedTargets(4), []);

  // A pair that does name something still reaches past the businesses anybody has been shown.
  recordDemand({ categoryId: "golf", city: "Orlando", region: "FL" }, []);
  const out = demandedTargets(4);
  assert.equal(out.length, 4);
  assert.deepEqual([...new Set(out.map((t) => t.reason))], ["asked for golf near Orlando"]);
});

test("the businesses somebody was actually shown come before the places people keep asking about", () => {
  db.exec("DELETE FROM crawl_demand; DELETE FROM search_demand");
  const shown = operator({ category: "golf", region: "FL", reviews: 1 });
  for (let i = 0; i < 3; i += 1) operator({ category: "golf", region: "FL", reviews: 500 });
  recordDemand({ categoryId: "golf", city: "Orlando", region: "FL" }, [option(`${shown}.com`)]);
  const out = demandedTargets(3);
  assert.equal(out[0]?.id, shown, "a shop with one review that a real person was shown is the best target there is");
  assert.equal(out[0]?.reason, "no price, no booking link");
  assert.equal(new Set(out.map((t) => t.id)).size, 3, "the same business was queued twice");
});

test("the summary counts both tables and names the pairs people ask about", () => {
  db.exec("DELETE FROM crawl_demand; DELETE FROM search_demand");
  const id = operator({ category: "golf", region: "FL" });
  recordDemand({ categoryId: "golf", city: "Orlando", region: "FL" }, [option(`${id}.com`)]);
  recordDemand({ categoryId: "golf", city: "Orlando", region: "FL" }, []);
  assert.deepEqual(demandSummary(), { shown: 1, pairs: 1, topPairs: [{ label: "golf near Orlando", asks: 2 }] });
});

test("a counter that cannot be written never costs a guest their answer", () => {
  // The whole body is inside one try/catch on purpose: this table is for a crawler that runs hours from now.
  assert.doesNotThrow(() => recordDemand({ categoryId: null, city: null, region: null }, [option("nobody.test")]));
});

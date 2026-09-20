import { strict as assert } from "node:assert";
import test, { afterEach } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Finding a shop's booking system at the moment a guest asks, without losing the one we already had.
 *
 * `plan.ts` sends every shop whose route is `agent` back through here, and an `agent` shop is precisely one
 * with a booking link a full crawl found and no reader knows. So the interesting case is not the shop with
 * nothing on file, it is the shop with something on file and a site that will not answer today.
 */

process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-resolve-")), "catalog.db");
const { db, migrate } = await import("../../db/client.ts");
const { resolveBooking } = await import("../resolve.ts");

migrate();
db.prepare("INSERT OR IGNORE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES (?,?,?,?,?,?)")
  .run("escape", "land", "Escape rooms", "escape", "slots", "escape room");

let n = 0;
/** One operator, with whatever facts a crawl would already have written for it. */
function shop(facts: Record<string, string>, website: string | null = "https://shop.example.com"): string {
  const id = "op-" + ++n;
  db.prepare(
    `INSERT INTO operators (id, domain, name, website, lat, lon, city, region, country, category_id, icon_key, origin, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, id + ".example.com", "Test Shop", website, 43.4, -80.5, "Waterloo", "ON", "CA", "escape", "escape", "public_site", "now", "now");
  let f = 0;
  for (const [key, value] of Object.entries(facts)) {
    db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?,?,?,?,?)")
      .run(`${id}-f${++f}`, id, key, value, "site");
  }
  return id;
}

const fact = (id: string, key: string): string | null => {
  const row = db.prepare("SELECT fact_value AS v FROM facts WHERE operator_id = ? AND fact_key = ? LIMIT 1").get(id, key) as { v: string } | undefined;
  return row?.v ?? null;
};
const factCount = (id: string, key: string): number =>
  (db.prepare("SELECT COUNT(*) AS c FROM facts WHERE operator_id = ? AND fact_key = ?").get(id, key) as { c: number }).c;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A site that answers nothing at all, which is a timeout, a WAF page and a dead host alike. */
function stubDeadSite(): void {
  globalThis.fetch = (async () => {
    throw new Error("timeout");
  }) as typeof fetch;
}

/** A site whose homepage embeds a vendor we can read. */
function stubSite(html: string): void {
  globalThis.fetch = (async () =>
    new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
}

test("a resolve that finds nothing keeps the booking link the crawl already found", async () => {
  /**
   * The bug. `remember` deleted all four of its keys up front and wrote `booking_url` back only when a link
   * had been found, so one unreachable site erased a link that took a full crawl to find. It is read by
   * `plan.ts`'s own query, by `live.ts`, by the listing page's slot times and by the sync that writes
   * `live-index.json`, so the shop stopped being bookable anywhere at all and was cached that way.
   */
  const id = shop({ booking_url: "https://shop.example.com/booknow/", booking_vendor: "bookeo" });
  stubDeadSite();
  const out = await resolveBooking({ id, domain: id + ".example.com", website: "https://shop.example.com" });

  assert.equal(fact(id, "booking_url"), "https://shop.example.com/booknow/", "the crawled link survives");
  assert.equal(fact(id, "booking_vendor"), "bookeo", "and so does the crawled vendor");
  assert.equal(out.bookingUrl, "https://shop.example.com/booknow/", "and the answer still carries it");
  assert.equal(out.outcome, "unreachable");
  // The miss is still written down, so the next guest does not pay for the same twelve fetches.
  assert.equal(fact(id, "booking_resolved"), "none");
  assert.equal(factCount(id, "booking_url"), 1, "and never piles a second row beside the first");
});

test("a resolve that finds a link writes it once, replacing what was there", async () => {
  const id = shop({ booking_url: "https://shop.example.com/booknow/" });
  stubSite('<html><body><iframe src="https://outsetshop.checkfront.com/reserve/"></iframe></body></html>');
  const out = await resolveBooking({ id, domain: id + ".example.com", website: "https://shop.example.com" });

  assert.equal(out.vendor, "checkfront");
  assert.match(out.bookingUrl ?? "", /checkfront/);
  assert.equal(factCount(id, "booking_url"), 1, "one row, not two");
  assert.match(fact(id, "booking_url") ?? "", /checkfront/);
  assert.equal(out.readable, true);
});

test("a shop already resolved to a readable link is never fetched again", async () => {
  const id = shop({ booking_url: "https://fareharbor.com/embeds/book/someshop/", booking_resolved: "fareharbor", resolve_gen: "1" });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("should not be called");
  }) as typeof fetch;
  const out = await resolveBooking({ id, domain: id + ".example.com", website: "https://shop.example.com" });
  assert.equal(calls, 0);
  assert.equal(out.outcome, "cached");
  assert.equal(out.readable, true);
});

test("a past miss is looked at again once the readers have gotten wider", async () => {
  // Resolved at generation 1 to a link no reader knew. The rules have moved on since, so it earns one fetch.
  const id = shop({ booking_url: "https://shop.example.com/booknow/", booking_resolved: "none", resolve_gen: "1" });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('<html><iframe src="https://outsetshop.checkfront.com/reserve/"></iframe></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
  const out = await resolveBooking({ id, domain: id + ".example.com", website: "https://shop.example.com" });
  assert.ok(calls > 0, "it fetched");
  assert.equal(out.vendor, "checkfront");
  assert.match(fact(id, "booking_url") ?? "", /checkfront/);
});

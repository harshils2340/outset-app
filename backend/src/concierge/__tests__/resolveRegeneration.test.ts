import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A shop resolved once, and resolved again as the readers get smarter.
 *
 * adventurerooms.ca is the real case this guards: its `/booknow/` page was crawled before anything extracted
 * a Checkfront embed from it, so it sat forever as `agent` — a booking link we knew about but could not
 * read — even after `vendors.ts` learned to pull `adventureroomscanada.checkfront.com/reserve/` out of exactly
 * that page. `READER_GENERATION` is what lets a past miss get a second look; these tests are what stop a
 * second look from being allowed to make things worse than the first one did.
 */

process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-resolve-")), "catalog.db");
const { db, migrate } = await import("../../db/client.ts");
migrate();
db.prepare("INSERT OR IGNORE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES (?,?,?,?,?,?)")
  .run("escape", "land", "Escape room", "escape", "slots", "escape room");
const { resolveBooking } = await import("../resolve.ts");
const { READER_GENERATION } = await import("../readable.ts");

const originalFetch = globalThis.fetch;
let responses: Record<string, string | null> = {};
globalThis.fetch = (async (url: string) => {
  const body = responses[url];
  if (body == null) return { ok: false, status: 404, headers: new Headers(), text: async () => "" } as Response;
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => body,
  } as Response;
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
});

let n = 0;
function op(website: string): { id: string; domain: string; website: string } {
  const id = "op-" + ++n;
  const domain = "shop" + n + ".example.com";
  db.prepare(
    `INSERT INTO operators (id, domain, name, lat, lon, city, region, country, category_id, icon_key, origin, review_count, rating, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, domain, "Shop " + n, 43.4, -80.5, "Kitchener", "ON", "CA", "escape", "escape", "public_site", 10, 4.5, "now", "now");
  return { id, domain, website };
}

test("a page with no vendor embed is remembered as having none", async () => {
  const o = op("https://plain.example.com/");
  responses = { "https://plain.example.com/": "<html>just a marketing page</html>" };
  const r = await resolveBooking(o);
  assert.equal(r.outcome, "none");
  assert.equal(r.bookingUrl, null);

  // Asked again: cached, no second fetch needed (fetch would throw a 404 if it were tried).
  responses = {};
  const again = await resolveBooking(o);
  assert.equal(again.outcome, "cached");
  assert.equal(again.bookingUrl, null);
});

test("a readable result, once found, is never re-checked", async () => {
  const o = op("https://readable.example.com/");
  responses = {
    "https://readable.example.com/": '<iframe src="https://someshop.checkfront.com/reserve/"></iframe>',
  };
  const first = await resolveBooking(o);
  assert.equal(first.outcome, "found");
  assert.equal(first.readable, true);

  responses = {}; // a fetch here would 404; the cached path must not attempt one
  const again = await resolveBooking(o);
  assert.equal(again.outcome, "cached");
  assert.equal(again.readable, true);
  assert.equal(again.bookingUrl, first.bookingUrl);
});

test("a past miss gets one more look once the readers are smarter, and keeps its link if that look fails", async () => {
  const o = op("https://booknow.example.com/booknow/");
  // First crawl: the homepage carries a link, but its own page is fetched under the wrong assumption
  // (an older reader generation) and nothing on it is recognised yet.
  responses = { "https://booknow.example.com/booknow/": "<html>book your escape room</html>" };
  const first = await resolveBooking(o);
  assert.equal(first.outcome, "none");

  // Manually roll this shop's stamped generation back, the way a real one that predates a reader upgrade would read.
  db.prepare("UPDATE facts SET fact_value = ? WHERE operator_id = ? AND fact_key = 'resolve_gen'").run(
    String(READER_GENERATION - 1),
    o.id,
  );

  // The readers got smarter, but this fetch fails outright (the shop's site is down for a moment).
  responses = {};
  const retryFailed = await resolveBooking(o);
  assert.equal(retryFailed.outcome, "unreachable");
  assert.equal(retryFailed.bookingUrl, null, "there was nothing to lose here — the first crawl found no link at all");

  db.prepare("UPDATE facts SET fact_value = ? WHERE operator_id = ? AND fact_key = 'resolve_gen'").run(
    String(READER_GENERATION - 1),
    o.id,
  );
  // Now the retry actually reaches a page and this time recognises the embed.
  responses = {
    "https://booknow.example.com/booknow/": '<iframe src="https://someshop.checkfront.com/reserve/"></iframe>',
  };
  const found = await resolveBooking(o);
  assert.equal(found.outcome, "found");
  assert.equal(found.readable, true);
});

test("a re-check that fails outright does not erase a booking link a past crawl already found", async () => {
  const o = op("https://halfknown.example.com/");
  // First crawl: a link is found, but to a vendor with no reader — the exact `agent` shape.
  responses = { "https://halfknown.example.com/": '<a href="https://halfknown.example.com/checkout">Book</a>' };
  const first = await resolveBooking(o);
  assert.equal(first.outcome, "none", "a plain link with no recognised vendor is not a find");

  // Simulate the shape resolve.ts actually stores for a found-but-unreadable link: an older generation, and a
  // bookingUrl already on record, by writing the facts resolveBooking itself would have written for that case.
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key IN ('booking_resolved','booking_url','resolve_gen')").run(o.id);
  db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?,?,?,?,?)").run(
    "f-a", o.id, "booking_resolved", "handbuilt", "resolve",
  );
  db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?,?,?,?,?)").run(
    "f-b", o.id, "booking_url", "https://halfknown.example.com/their-own-booking-page", "resolve",
  );
  db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?,?,?,?,?)").run(
    "f-c", o.id, "resolve_gen", String(READER_GENERATION - 1), "resolve",
  );

  // The re-check this generation bump earns them times out / errors on every path tried.
  responses = {};
  const retried = await resolveBooking(o);
  assert.equal(retried.bookingUrl, "https://halfknown.example.com/their-own-booking-page", "a failed re-check must not downgrade a known link to none");
  assert.equal(retried.readable, false);
});

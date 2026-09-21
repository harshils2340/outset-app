import { strict as assert } from "node:assert";
import test, { afterEach } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Which link we read for a shop, and which of our readers we are willing to point at it.
 *
 * `GET /concierge/live/:domain` answers from `liveFor`, and `liveFor` knew two vendors where the concierge
 * knows ten. Both halves of that were the same mistake written twice: a vendor list copied out by hand
 * instead of taken from `readable.ts`, and the reader dispatch left inside a closure in `plan.ts` where no
 * other caller could reach it. So a Peek shop was told "no feed to read: this one needs the browser agent"
 * on one route while the agent quoted its real departures from the very same booking link.
 *
 * No network: everything is answered from the stub below, and the assertions are about which vendor we
 * decided to ask, which is where the bug lived.
 */

process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-livefor-")), "catalog.db");
const { db, migrate } = await import("../../db/client.ts");
const { bookingUrlFor, liveFor, clearFeedCache } = await import("../live.ts");

migrate();
db.prepare("INSERT OR IGNORE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES (?,?,?,?,?,?)")
  .run("escape", "land", "Escape rooms", "escape", "slots", "escape room");

let n = 0;
/** One operator with its booking links on file, in the order a crawl wrote them. */
function shop(domain: string, bookingUrls: string[]): string {
  const id = "op-" + ++n;
  db.prepare(
    `INSERT INTO operators (id, domain, name, website, lat, lon, city, region, country, category_id, icon_key, origin, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, domain, "Test Shop", "https://" + domain, 43.4, -80.5, "Waterloo", "ON", "CA", "escape", "escape", "public_site", "now", "now");
  let f = 0;
  for (const url of bookingUrls) {
    db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?,?,?,?,?)")
      .run(`${id}-f${++f}`, id, "booking_url", url, "site");
  }
  return domain;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Every vendor call refused, so what is asserted is which vendor we chose to ask. */
function stubNothingAnswers(): string[] {
  clearFeedCache();
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    asked.push(String(input));
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return asked;
}

test("a shop's readable link wins over its own hand-built page, whichever the crawl wrote first", () => {
  // The hand-built page is on file first, so rowid order would answer with it.
  const xola = shop("shop-a.example.com", ["https://shop-a.example.com/book-now/", "https://checkout.xola.app/#buttons/6a7b8c9d0e1f2a3b4c5d6e7f"]);
  assert.equal(bookingUrlFor(xola), "https://checkout.xola.app/#buttons/6a7b8c9d0e1f2a3b4c5d6e7f");

  // The old list named FareHarbor, Resova and Peek only, so each of these lost to the hand-built page.
  const each: [string, string][] = [
    ["shop-b.example.com", "https://mytour.rezdy.com/catalog/123"],
    ["shop-c.example.com", "https://app.acuityscheduling.com/schedule.php?owner=12345"],
    ["shop-d.example.com", "https://book.squareup.com/appointments/abc/location/L1/services"],
    ["shop-e.example.com", "https://tours.tripworks.com/experiences"],
    ["shop-f.example.com", "https://tours.checkfront.com/reserve/"],
    ["shop-g.example.com", "https://foreupsoftware.com/index.php/booking/1234/5678"],
  ];
  for (const [domain, url] of each) {
    assert.equal(bookingUrlFor(shop(domain, ["https://" + domain + "/booking/", url])), url, domain);
  }
});

test("a link that only looks like a vendor's does not beat one a reader can really read", () => {
  /**
   * The SQL patterns behind `unreadableSql` cannot run a regex, so they are loose on purpose: `%checkfront%`
   * matches a shop whose own domain carries the word and `%xola.%` matches any host under that name. Sorting
   * on them alone would promote a link `readerFor` then refuses, and the shop would read as having no feed
   * while a FareHarbor calendar sat in the next row.
   */
  const fh = "https://fareharbor.com/embeds/book/realshop/?full-items=yes";
  assert.equal(bookingUrlFor(shop("checkfront-rooms.example.com", ["https://checkfront-rooms.example.com/book/", fh])), fh);
  assert.equal(bookingUrlFor(shop("shop-h.example.com", ["https://xola.io/not-a-vendor-page", fh])), fh);
});

test("a Peek shop is read by the Peek reader, not sent to the browser agent", async () => {
  const domain = shop("peekshop.example.com", ["https://book.peek.com/s/2530f333-35eb-43fc-b661-6c7d3c95dfea/LR2Jm"]);
  const asked = stubNothingAnswers();

  const r = await liveFor(domain, { days: 3 });

  // The bug: "agent", with nothing asked of Peek at all.
  assert.equal(r.vendor, "peek");
  assert.equal(r.note, "Peek did not answer for this shop.");
  assert.ok(asked.some((u) => u.includes("peek")), "the Peek API was asked: " + asked.join(", "));
});

test("a link no reader knows is still the browser agent's", async () => {
  const domain = shop("handbuilt.example.com", ["https://handbuilt.example.com/book-a-room/"]);
  stubNothingAnswers();

  const r = await liveFor(domain, { days: 3 });

  assert.equal(r.vendor, "agent");
  assert.equal(r.note, "No feed to read: this one needs the browser agent.");
});

test("a shop with no booking link on file says so rather than guessing", async () => {
  shop("nolink.example.com", []);
  stubNothingAnswers();

  const r = await liveFor("nolink.example.com", { days: 3 });

  assert.equal(r.vendor, "none");
  assert.equal(r.departures.length, 0);
});

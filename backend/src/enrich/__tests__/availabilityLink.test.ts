import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Which of a shop's booking links the guest's listing page reads.
 *
 * A crawl writes a `booking_url` fact whenever it finds one, so a shop that published its own hand-built
 * "Book now" page before we found its FareHarbor calendar has two on file. Both queries behind
 * `GET /availability/:operatorId` took `LIMIT 1` with no ORDER BY, which SQLite answers in rowid order, so
 * the older, unreadable row won and the page fell back to our generic nine, eleven and one for a shop whose
 * real times were one call away. `live.ts` counted thirty-eight operators in that state and fixed its own
 * copy of the query; this is the copy the guest actually meets.
 */

process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-avail-link-")), "catalog.db");
const { db, migrate } = await import("../../db/client.ts");
const { bookingUrlFor } = await import("../availability.ts");

migrate();
db.prepare("INSERT OR IGNORE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES (?,?,?,?,?,?)")
  .run("boat", "water", "Boat tours", "boat", "slots", "boat tour");

let n = 0;
/** One operator, with its booking links on file in the order a crawl wrote them. */
function shop(domain: string, bookingUrls: string[]): string {
  const id = "op-" + ++n;
  db.prepare(
    `INSERT INTO operators (id, domain, name, website, lat, lon, city, region, country, category_id, icon_key, origin, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, domain, "Test Shop", "https://" + domain, 27.9, -82.4, "Tampa", "FL", "US", "boat", "boat", "public_site", "now", "now");
  let f = 0;
  for (const url of bookingUrls) {
    db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?,?,?,?,?)")
      .run(`${id}-f${++f}`, id, "booking_url", url, "site");
  }
  return id;
}

const FH = "https://fareharbor.com/embeds/book/tampabay/?full-items=yes";
const PEEK = "https://book.peek.com/s/2530f333-35eb-43fc-b661-6c7d3c95dfea/LR2Jm";
const XOLA = "https://checkout.xola.com/index.html#seller/6a7b8c9d0e1f2a3b4c5d6e7f";
const OWN = "https://shop.example.com/book-a-trip/";

test("the readable link wins over the shop's own page, whichever the crawl wrote first", () => {
  assert.equal(bookingUrlFor(shop("a.example.com", [OWN, FH])), FH);
  assert.equal(bookingUrlFor(shop("b.example.com", [OWN, PEEK])), PEEK);
  assert.equal(bookingUrlFor(shop("c.example.com", [OWN, XOLA])), XOLA);
  // And it is not merely "the last one": a readable link written first still wins.
  assert.equal(bookingUrlFor(shop("d.example.com", [FH, OWN])), FH);
});

test("the same holds when the page asks by its catalog id rather than the operator row's", () => {
  shop("kayaks.example.com", [OWN, FH]);
  assert.equal(bookingUrlFor("o-kayaks-example-com"), FH);
});

test("a shop with nothing readable still answers with what it has", () => {
  assert.equal(bookingUrlFor(shop("e.example.com", [OWN])), OWN);
  assert.equal(bookingUrlFor(shop("f.example.com", [])), null);
});

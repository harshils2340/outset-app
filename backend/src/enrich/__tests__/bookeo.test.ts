import { test } from "node:test";
import assert from "node:assert/strict";
import { bookeoRef, parseStartPage, readBookeo } from "../vendors/bookeo.ts";
import { loadExchanges, withReplay } from "./fixtures/replay.ts";

// fixtures/bookeo: Skeggy's axe throwing, Easton PA (bookeo.com/skeggys), 15 September 2026. The 302 to the shard, the
// start page, then per type the "i" popup (where the grid offers one), the b_saveType POST and, for types with add-ons,
// the b_saveRes POST that reaches the people page: 25 exchanges.

test("bookeoRef reads slugs and account GUIDs from links, widget embeds and shard URLs", () => {
  assert.deepEqual(bookeoRef("https://bookeo.com/skeggys"), { slug: "skeggys", guid: null });
  assert.deepEqual(bookeoRef("https://www.bookeo.com/skeggys?ref=site"), { slug: "skeggys", guid: null });
  assert.deepEqual(bookeoRef("https://bookeo.com/go/41572YU3FHP1696329801E"), { slug: null, guid: "41572YU3FHP1696329801E" });
  assert.deepEqual(bookeoRef('<script type="text/javascript" src="https://bookeo.com/widget.js?a=41572YU3FHP1696329801E"></script>'), { slug: null, guid: "41572YU3FHP1696329801E" });
  assert.deepEqual(bookeoRef("https://www-1572k.bookeo.com/bookeo/b_skeggys_start.html?ctlsrc2=x&src=02k"), { slug: "skeggys", guid: null });
  assert.deepEqual(bookeoRef('<a href="https://bookeo.com/skeggys">Book</a><img src="https://www-1572k.bookeo.com/bookeo/cfile/41572YU3FHP1696329801E/logo.png">'), { slug: "skeggys", guid: "41572YU3FHP1696329801E" });
  assert.equal(bookeoRef("https://bookeo.com/pricing"), null);
  assert.equal(bookeoRef("https://bookeo.com/"), null);
  assert.equal(bookeoRef("https://fareharbor.com/embeds/book/x/"), null);
});

test("parseStartPage reads the product grid of the recorded start page", () => {
  const start = loadExchanges("bookeo").find((e) => /b_skeggys_start\.html/.test(e.key))!;
  const items = parseStartPage(start.body, "https://www-1572k.bookeo.com");
  assert.equal(items.length, 10);
  assert.equal(items[0].name, "1 HOUR SESSION (2 GUESTS)");
  assert.equal(items[0].duration, "1 hour");
  assert.equal(items[0].rid, "33960849");
  assert.equal(items[4].name, "90 - MINUTE SESSION (4-6 GUESTS)");
  assert.equal(items[4].duration, "90 min");
  assert.equal(items[9].name, "BIRTHDAY PARTY (AGES 8 - 17)");
});

test("Bookeo: Skeggy's reads 10 session types, per-person tiers from the people page, a 2-guest session per booking", async () => {
  const { result: r } = await withReplay("bookeo", () => readBookeo({ slug: "skeggys", guid: null }));
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "bookeo");
  assert.equal(r.pages, 25);
  assert.equal(r.offerings.length, 10);
  assert.deepEqual(r.offerings.map((o) => [o.name, o.detail, o.duration, o.price, o.unit]), [
    ["1 HOUR SESSION (2 GUESTS)", "1 hour", "1 hour", 70, "/group"],
    ["1 HOUR SESSION (3-6 GUESTS)", "Adults", "1 hour", 30, "each"],
    ["1 HOUR SESSION (7-12 GUESTS)", "Adults", "1 hour", 30, "each"],
    ["1 HOUR SESSION (13+ GUESTS) - REQUEST ONLY", "Adults", "1 hour", 30, "each"],
    ["90 - MINUTE SESSION (4-6 GUESTS)", "Adults", "90 min", 40, "each"],
    ["90-MINUTE SESSION (7-12 GUESTS)", "Adults", "90 min", 40, "each"],
    ["90 MINUTE SESSION (13+ GUESTS) - REQUEST ONLY", "Adults", "90 min", 40, "each"],
    ["2 HOUR SESSION (7-12 GUESTS)", "Adults", "2 hours", 50, "each"],
    ["2 HOUR SESSION (13+ GUESTS) - REQUEST ONLY", "Adults", "2 hours", 50, "each"],
    ["BIRTHDAY PARTY (AGES 8 - 17)", null, null, null, "each"],
  ]);
  assert.ok(r.offerings.every((o) => o.url === "https://bookeo.com/skeggys"));
  assert.equal(r.offerings[0].photo, "https://www-1572k.bookeo.com/bookeo/cfile/41572YU3FHP1696329801E/1731609237012_663UUAN99CCKJJ6JLMJXL4HKKJXX3PCA_1000_1000.png");
  // The business header: the account's legal name is not read, its contact block is.
  assert.equal(r.company.phone, "4845443003");
  assert.equal(r.company.email, "sangokurasake@gmail.com");
  assert.equal(r.company.street, "42 Centre Square");
  assert.equal(r.company.city, "Easton");
  assert.equal(r.company.region, "Pennsylvania");
  assert.equal(r.company.postal, "18042");
  assert.ok(r.requirements.includes("1 HOUR SESSION (3-6 GUESTS): minimum 3 guests per booking."), JSON.stringify(r.requirements));
  assert.ok(r.requirements.includes("2 HOUR SESSION (13+ GUESTS) - REQUEST ONLY: minimum 13 guests per booking."));
  assert.ok(r.includes.includes("1 HOUR SESSION (7-12 GUESTS): up to 12 guests per booking."), JSON.stringify(r.includes));
  assert.ok(r.includes.includes("1 HOUR SESSION (13+ GUESTS) - REQUEST ONLY: up to 50 guests per booking."));
  assert.deepEqual(r.policies, []);
});

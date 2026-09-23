import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The Klook path against a throwaway database and a fake Klook: cities matched to metros by name and
 * country, a search per metro, rows stored with a tracked affiliate link, and the rows coming back out as
 * catalog listings labelled Klook. The fake answers the shape klook.ts assumes; when Klook's real document
 * arrives, change the fake and the client together.
 */

const tmp = mkdtempSync(join(tmpdir(), "outset-klook-"));
process.env.OUTSET_DB = join(tmp, "test.db");
process.env.KLOOK_API_KEY = "test-key";
process.env.KLOOK_API_BASE = "https://affiliate-api.example/v1/";
process.env.KLOOK_AID = "A123";
process.env.KLOOK_WID = "W456";

const { db, migrate } = await import("../../db/client.ts");
migrate();
// affiliate_products.metro_id references the metros table, which ingest fills from the taxonomy; the CLI does
// the same before a pull, so a fresh database behaves the same here as on a new worker disk.
const { ingestAll } = await import("../../ingest/load.ts");
ingestAll();
const { pullKlook, metroCities, bookingUrl, images, fromCents, klookConfigured } = await import("../klook.ts");
const { affiliateCatalogItems } = await import("../catalog.ts");

const calls: string[] = [];
const activity = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  description: "A fine time in the city.",
  images: ["https://res.klook.com/" + id + "-a.jpg", { large: "https://res.klook.com/" + id + "-b.jpg" }],
  selling_price: "59.00",
  market_price: "69.00",
  currency: "USD",
  rating: 4.7,
  review_count: 812,
  duration: "2 hours",
  url: "https://www.klook.com/en-US/activity/" + id + "-something",
  free_cancellation: true,
  ...extra,
});

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  calls.push(url);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  assert.equal((init?.headers as Record<string, string>)["Authorization"], "Bearer test-key", "every call carries the key");
  assert.ok(url.startsWith("https://affiliate-api.example/v1/"), "the base URL is the configured one, without a doubled slash");
  const u = new URL(url);
  if (u.pathname.endsWith("/cities")) {
    return json({
      cities: [
        { id: 1, name: "Tampa", country: "United States", country_code: "US" },
        { id: 2, name: "London", country: "United Kingdom", country_code: "GB" },
        { id: 3, name: "Miami", country: "United States", country_code: "US" },
      ],
      total: 3,
    });
  }
  if (u.pathname.endsWith("/activities")) {
    const city = u.searchParams.get("city_id");
    if (city === "1") return json({ activities: [activity(100, "Tampa Bay Dolphin Cruise"), activity(101, "Tampa Airport Shuttle"), activity(102, "Busch Gardens Tampa Bay Theme Park Ticket", { affiliate_url: "https://affiliate.klook.com/redirect?aid=W456&aff_adid=A123&k_site=x" })], total: 3 });
    if (city === "3") return json({ activities: [activity(200, "Miami Jet Ski Rental", { url: "https://elsewhere.example/not-klook" })], total: 1 });
    return json({ activities: [], total: 0 });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

test("each metro gets the Klook city of the same name in the same country, never a namesake abroad", () => {
  const map = metroCities([
    { id: 1, name: "Tampa", country: "United States" },
    { id: 2, name: "London", country_code: "GB" },
    { id: 3, name: "London", country_code: "CA" },
    { id: 4, name: "Toronto", country: "Canada" },
  ]);
  assert.equal(map.get("tampa")?.id, 1);
  assert.equal(map.get("london")?.id, 3, "London, Ontario, not London, England");
  assert.equal(map.get("toronto")?.id, 4);
  assert.equal(map.get("miami"), undefined);
});

test("the booking link carries our ids in the portal's redirect shape, and the API's own tracked link is kept as is", () => {
  assert.equal(
    bookingUrl({ id: 7, url: "https://www.klook.com/en-US/activity/7-x" }),
    "https://affiliate.klook.com/redirect?aid=W456&aff_adid=A123&k_site=" + encodeURIComponent("https://www.klook.com/en-US/activity/7-x"),
    "aid= is the website id and aff_adid= the affiliate id, which is how the portal names them",
  );
  assert.equal(bookingUrl({ id: 7, affiliate_url: "https://affiliate.klook.com/redirect?aid=W456&aff_adid=A123&k_site=y" }), "https://affiliate.klook.com/redirect?aid=W456&aff_adid=A123&k_site=y");
  assert.equal(bookingUrl({ id: 7, url: "http://www.klook.com/en-US/activity/7-x" }), null, "never a non-https page");
  assert.equal(bookingUrl({ id: 7, url: "https://elsewhere.example/x" }), null, "never a page off klook.com");
  assert.deepEqual(images({ id: 7, images: ["https://a/1.jpg", { large: "https://a/2.jpg" }, "http://a/3.jpg"], image_url: "https://a/1.jpg" }), ["https://a/1.jpg", "https://a/2.jpg"]);
  assert.equal(fromCents({ id: 7, selling_price: "59.00", price: 70 }), 5900);
  assert.equal(fromCents({ id: 7, price: "USD 12.5" }), 1250);
  assert.equal(fromCents({ id: 7 }), null);
  assert.ok(klookConfigured());
});

test("a pull matches cities to metros, drops what is not an experience, and stores the rest with a tracked link", async () => {
  const r = await pullKlook({ metros: ["tampa", "miami", "orlando"], perMetro: 10, write: true });
  assert.equal(r.metros, 3);
  assert.equal(r.matched, 2, "Tampa and Miami match a city; Orlando has none in this fake list");
  assert.deepEqual(r.skipped, ["orlando"]);
  assert.equal(r.products, 3, "the shuttle is not an experience; the off-site Miami link is counted but not stored");
  assert.equal(r.written, 2);
  const rows = db.prepare("SELECT id, source, title, metro_id, from_cents, currency, booking_url, images, flags, destination_name FROM affiliate_products WHERE source = 'klook' ORDER BY id").all() as Record<string, unknown>[];
  assert.deepEqual(rows.map((x) => x.id), ["a-klook-100", "a-klook-102"]);
  assert.equal(rows[0].metro_id, "tampa");
  assert.equal(rows[0].from_cents, 5900, "the selling price, not the struck-through market price");
  assert.equal(rows[0].destination_name, "Tampa");
  assert.equal(rows[0].booking_url, "https://affiliate.klook.com/redirect?aid=W456&aff_adid=A123&k_site=" + encodeURIComponent("https://www.klook.com/en-US/activity/100-something"));
  assert.equal(rows[1].booking_url, "https://affiliate.klook.com/redirect?aid=W456&aff_adid=A123&k_site=x", "the API's own tracked link is not wrapped twice");
  assert.deepEqual(JSON.parse(String(rows[0].images)), ["https://res.klook.com/100-a.jpg", "https://res.klook.com/100-b.jpg"]);
  assert.deepEqual(JSON.parse(String(rows[0].flags)), ["FREE_CANCELLATION"]);
  const sync = db.prepare("SELECT last_full_at FROM affiliate_sync WHERE source = 'klook'").get() as { last_full_at: string };
  assert.ok(sync.last_full_at);
  assert.ok(calls.some((c) => c.includes("/cities?")) && calls.some((c) => c.includes("/activities?city_id=1")));
});

test("the rows come out as listings labelled Klook that link out, filed by kind", () => {
  const items = affiliateCatalogItems().filter((i) => String(i.id).startsWith("a-klook-"));
  assert.equal(items.length, 2);
  const cruise = items.find((i) => i.id === "a-klook-100")!;
  assert.equal(cruise.cat, "water");
  assert.equal(cruise.art, "cruise");
  assert.equal(cruise.from, 59);
  assert.equal(cruise.fc, "Free cancellation");
  assert.equal(cruise.dur, "2 hours");
  assert.equal(cruise.area, "Tampa, FL");
  assert.equal(cruise.assistant, false);
  assert.equal(cruise.src, "klook.com");
  assert.deepEqual(cruise.affiliate, { source: "klook", label: "Klook", url: "https://affiliate.klook.com/redirect?aid=W456&aff_adid=A123&k_site=" + encodeURIComponent("https://www.klook.com/en-US/activity/100-something") });
  assert.ok(!("claimKey" in cruise), "no claim key on a partner product");
  const park = items.find((i) => i.id === "a-klook-102")!;
  assert.equal(park.art, "themepark");
});

test("a dry pull calls the API and stores nothing; an unconfigured pull calls nothing", async () => {
  db.exec("DELETE FROM affiliate_products WHERE source = 'klook'");
  const r = await pullKlook({ metros: ["tampa"], perMetro: 10, write: false });
  assert.equal(r.products, 2);
  assert.equal(r.written, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM affiliate_products WHERE source = 'klook'").get() as { n: number }).n, 0);
  const key = process.env.KLOOK_API_KEY;
  delete process.env.KLOOK_API_KEY;
  calls.length = 0;
  try {
    assert.equal(klookConfigured(), false);
    const none = await pullKlook({ metros: ["tampa"], perMetro: 10, write: true });
    assert.equal(none.metros, 0);
    assert.equal(calls.length, 0, "no key, no call");
  } finally {
    process.env.KLOOK_API_KEY = key;
  }
});

test.after(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

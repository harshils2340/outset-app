import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GygTour } from "../getyourguide.ts";

/**
 * The whole GetYourGuide path against a throwaway database and a fake Partner API: one coordinates search per
 * metro, rows stored with a partner-tagged link, and the rows coming back out as catalog listings labelled
 * GetYourGuide. This is what a real token will run through, so it is exercised here before one exists.
 */

const tmp = mkdtempSync(join(tmpdir(), "outset-gyg-"));
process.env.OUTSET_DB = join(tmp, "test.db");
process.env.GYG_API_KEY = "test-token";
process.env.GYG_PARTNER_ID = "OUTSET1";

const { db, migrate } = await import("../../db/client.ts");
migrate();
const { ingestAll } = await import("../../ingest/load.ts");
ingestAll();
const { pullGetYourGuide, bookingUrl, images, durationText, isExperience } = await import("../getyourguide.ts");
const { affiliateCatalogItems } = await import("../catalog.ts");

const calls: URL[] = [];
const tour = (id: number, title: string, extra: Partial<GygTour> = {}): GygTour => ({
  tour_id: id,
  title,
  abstract: "A fine time on the water.",
  pictures: [{ id: 1, ssl_url: "https://cdn.getyourguide.com/img/tour_img-" + id + "-[format_id].jpg" }, { id: 2, url: "http://cdn.getyourguide.com/img/insecure-[format_id].jpg" }],
  overall_rating: 4.7,
  number_of_ratings: 210,
  price: { values: { amount: 89 }, description: "per person" },
  durations: [{ duration: 2, unit: "hour" }],
  categories: [{ category_id: 3, name: "Boat Tours" }],
  locations: [{ location_id: 55, type: "city", name: "Tampa", city: "Tampa" }],
  cancellation_policy: { cancellable: true },
  // The spec's example url already carries partner_id; this one does not, so GYG_PARTNER_ID must be added.
  url: "https://www.getyourguide.com/tampa-l55/dolphin-cruise-t" + id + "/?psrc=partner_api",
  ...extra,
});

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input instanceof Request ? input.url : input));
  calls.push(u);
  const h = init?.headers as Record<string, string>;
  assert.equal(h["X-ACCESS-TOKEN"], "test-token", "every call carries the token in the documented header");
  assert.equal(h.Accept, "application/json");
  assert.equal(u.searchParams.get("cnt_language"), "en");
  assert.ok(u.searchParams.get("currency"));
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (u.pathname === "/1/tours") {
    const coords = u.searchParams.getAll("coordinates[]").map(Number);
    assert.equal(coords.length, 3, "lat, lon, radius as a URL array");
    assert.equal(u.searchParams.get("preformatted"), "teaser", "the format a BASIC key may ask for");
    const [lat] = coords;
    if (Math.abs(lat - 27.95) < 0.01) {
      // Tampa: a cruise, a shuttle (not an experience), a skydive pinned nearer Orlando, and a tour with no link.
      return json({
        _metadata: { totalCount: 4 },
        data: {
          tours: [
            tour(1, "Tampa Bay Dolphin Cruise", { coordinates: { lat: 27.95, long: -82.46 } }),
            tour(2, "Tampa Airport Shuttle", { activity_type: "transfer" }),
            tour(3, "Skydive Tandem Jump near Orlando", { coordinates: { lat: 28.5, long: -81.4 }, locations: [{ location_id: 60, type: "city", name: "Orlando", city: "Orlando" }] }),
            tour(4, "Mystery Tour", { url: undefined }),
          ],
        },
      });
    }
    return json({ _metadata: { totalCount: 0 }, data: { tours: [] } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

test("the booking link carries the partner id, pictures get a real format, durations read like a person wrote them", () => {
  const t = tour(9, "Kayak the Springs");
  assert.equal(bookingUrl(t), "https://www.getyourguide.com/tampa-l55/dolphin-cruise-t9/?psrc=partner_api&partner_id=OUTSET1");
  assert.equal(bookingUrl(tour(9, "X", { url: "https://www.getyourguide.com/x-t9/?partner_id=ABC" })), "https://www.getyourguide.com/x-t9/?partner_id=ABC", "a link that already carries one is left alone");
  assert.equal(bookingUrl(tour(9, "X", { url: "http://www.getyourguide.com/x-t9/" })), null, "never a non-https link");
  assert.deepEqual(images(t), ["https://cdn.getyourguide.com/img/tour_img-9-75.jpg"], "format 75 (1440x960), https only");
  assert.equal(durationText(t), "2 hours");
  assert.equal(durationText(tour(9, "X", { durations: [{ duration: 1, unit: "day" }] })), "1 day");
  assert.equal(durationText(tour(9, "X", { durations: [{ duration: 45, unit: "minute" }] })), "45 minutes");
  assert.equal(durationText(tour(9, "X", { durations: [] })), null);
  assert.equal(isExperience(tour(9, "Private Transfer", { activity_type: "transfer" })), false);
  assert.equal(isExperience(tour(9, "Go City Pass", { partner_business_category: "City Cards" })), false);
  assert.equal(isExperience(t), true);
});

test("a pull searches around each metro, keeps experiences, files each by its own pin and stores partner-tagged links", async () => {
  const r = await pullGetYourGuide({ metros: ["tampa", "miami"], perMetro: 10, write: true });
  assert.equal(r.metros, 2);
  assert.equal(r.matched, 1, "Miami answered nothing in this fake");
  assert.deepEqual(r.skipped, ["miami"]);
  assert.equal(r.products, 3, "the shuttle is not an experience; the tour with no link is counted but not stored");
  assert.equal(r.written, 2);
  const rows = db.prepare("SELECT id, title, metro_id, from_cents, currency, booking_url, images, flags, tags, duration, destination_name, lat FROM affiliate_products ORDER BY id").all() as Record<string, unknown>[];
  assert.deepEqual(rows.map((x) => x.id), ["a-getyourguide-1", "a-getyourguide-3"]);
  assert.equal(rows[0].metro_id, "tampa");
  assert.equal(rows[1].metro_id, "orlando", "a tour pinned nearer Orlando is filed there, not under the metro it was found from");
  assert.equal(rows[0].from_cents, 8900);
  assert.equal(rows[0].currency, "USD");
  assert.equal(rows[0].booking_url, "https://www.getyourguide.com/tampa-l55/dolphin-cruise-t1/?psrc=partner_api&partner_id=OUTSET1");
  assert.deepEqual(JSON.parse(String(rows[0].images)), ["https://cdn.getyourguide.com/img/tour_img-1-75.jpg"]);
  assert.deepEqual(JSON.parse(String(rows[0].flags)), ["FREE_CANCELLATION"]);
  assert.deepEqual(JSON.parse(String(rows[0].tags)), ["Boat Tours"]);
  assert.equal(rows[0].duration, "2 hours");
  assert.equal(rows[0].destination_name, "Tampa");
  assert.equal(rows[0].lat, 27.95);
  assert.ok(calls.every((c) => c.hostname === "api.getyourguide.com" && c.pathname.startsWith("/1/")), "only the API is ever called, never a getyourguide.com page");
  const sync = db.prepare("SELECT last_full_at FROM affiliate_sync WHERE source = 'getyourguide'").get() as { last_full_at: string };
  assert.ok(sync?.last_full_at);
});

test("the rows come out as listings labelled GetYourGuide that link out", () => {
  const items = affiliateCatalogItems();
  assert.equal(items.length, 2);
  const cruise = items.find((i) => i.id === "a-getyourguide-1")!;
  assert.equal(cruise.cat, "water");
  assert.equal(cruise.art, "cruise");
  assert.equal(cruise.from, 89);
  assert.equal(cruise.fc, "Free cancellation");
  assert.equal(cruise.area, "Tampa, FL");
  assert.equal(cruise.src, "getyourguide.com");
  assert.equal(cruise.assistant, false);
  assert.deepEqual(cruise.affiliate, { source: "getyourguide", label: "GetYourGuide", url: "https://www.getyourguide.com/tampa-l55/dolphin-cruise-t1/?psrc=partner_api&partner_id=OUTSET1" });
  const jump = items.find((i) => i.id === "a-getyourguide-3")!;
  assert.equal(jump.art, "skydive");
  assert.equal(jump.area, "Orlando, FL");
});

test("a dry pull calls the API and stores nothing; no token means no call at all", async () => {
  db.exec("DELETE FROM affiliate_products");
  const r = await pullGetYourGuide({ metros: ["tampa"], perMetro: 10, write: false });
  assert.equal(r.products, 3);
  assert.equal(r.written, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM affiliate_products").get() as { n: number }).n, 0);
  calls.length = 0;
  process.env.GYG_API_KEY = "";
  const none = await pullGetYourGuide({ metros: ["tampa"], perMetro: 10, write: true });
  assert.equal(none.metros, 0);
  assert.equal(calls.length, 0);
  process.env.GYG_API_KEY = "test-token";
});

test.after(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

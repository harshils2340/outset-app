import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The whole Viator path against a throwaway database and a fake Viator: destinations matched to metros, a
 * search per metro, rows stored with the API's own booking link, a refresh from modified-since, and the rows
 * coming back out as catalog listings. This is what a real key will run through, so it is exercised here
 * before one exists.
 */

const tmp = mkdtempSync(join(tmpdir(), "outset-viator-"));
process.env.OUTSET_DB = join(tmp, "test.db");
process.env.VIATOR_API_KEY = "test-key";
process.env.VIATOR_PID = "P00012345";

const { db, migrate } = await import("../../db/client.ts");
migrate();
// affiliate_products.metro_id references the metros table, which ingest fills from the taxonomy; the CLI does
// the same before a pull, so a fresh database behaves the same here as on a new worker disk.
const { ingestAll } = await import("../../ingest/load.ts");
ingestAll();
const { pullViator, refreshViator, detailViator, MAX_AGE_HOURS } = await import("../viator.ts");
const { affiliateCatalogItems } = await import("../catalog.ts");

const calls: string[] = [];
let basicAccess = false;
const product =(code: string, title: string, extra: Record<string, unknown> = {}) => ({
  productCode: code,
  title,
  description: "A fine time on the water.",
  images: [{ variants: [{ url: "https://media.tacdn.com/" + code + "-400.jpg", width: 400 }, { url: "https://media.tacdn.com/" + code + "-720.jpg", width: 720 }] }],
  reviews: { combinedAverageRating: 4.8, totalReviews: 321 },
  pricing: { summary: { fromPrice: 89 }, currency: "USD" },
  productUrl: "https://www.viator.com/tours/Tampa/x/d123-" + code,
  duration: { fixedDurationInMinutes: 120 },
  flags: ["FREE_CANCELLATION"],
  ...extra,
});

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  calls.push(url);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  assert.equal((init?.headers as Record<string, string>)["exp-api-key"], "test-key", "every call carries the key");
  if (url.endsWith("/destinations")) {
    return json({
      destinations: [
        { destinationId: 10, name: "Tampa", type: "CITY", center: { latitude: 27.95, longitude: -82.46 } },
        { destinationId: 11, name: "Florida", type: "STATE", center: { latitude: 27.95, longitude: -82.46 } },
        { destinationId: 12, name: "Miami", type: "CITY", center: { latitude: 25.76, longitude: -80.19 } },
      ],
    });
  }
  if (url.endsWith("/products/search")) {
    const body = JSON.parse(String(init?.body)) as { filtering: { destination: string } };
    if (body.filtering.destination === "10") return json({ products: [product("T1", "Tampa Bay Dolphin Cruise"), product("T2", "Airport Shuttle to Clearwater"), product("T3", "Skydive Tampa Tandem Jump")], totalCount: 3 });
    if (body.filtering.destination === "12") return json({ products: [product("M1", "Miami Beach Jet Ski Rental", { productUrl: "http://insecure.example/x" })], totalCount: 1 });
    return json({ products: [], totalCount: 0 });
  }
  const one = url.match(/\/products\/([A-Z0-9]+)$/);
  if (one) {
    return json({
      ...product(one[1], "Tampa Bay Dolphin Cruise"),
      description: "A fine time on the water, and a long one: two hours past the skyway with a naturalist aboard.",
      images: [
        { variants: [{ url: "https://media.tacdn.com/" + one[1] + "-720.jpg", width: 720 }] },
        { variants: [{ url: "https://media.tacdn.com/" + one[1] + "-b-720.jpg", width: 720 }] },
        { variants: [{ url: "https://media.tacdn.com/" + one[1] + "-c-720.jpg", width: 720 }] },
      ],
      pricing: undefined,
      inclusions: [{ typeDescription: "Other", otherDescription: "Bottled water" }, { typeDescription: "Professional guide" }],
      additionalInfo: [{ type: "X", description: "Confirmation will be received at time of booking" }, { type: "NO_BACK_PROBLEMS", description: "Not recommended for travelers with spinal injuries" }],
      cancellationPolicy: { type: "STANDARD", description: "For a full refund, cancel at least 24 hours before the scheduled departure time." },
      itinerary: { privateTour: false, maxTravelersInSharedTour: 12 },
    });
  }
  if (url.includes("/products/modified-since")) {
    if (basicAccess) return new Response('{"code":"FORBIDDEN","message":"This endpoint is not available at your access level"}', { status: 403 });
    return json({ products: [product("T1", "Tampa Bay Dolphin Cruise (New Boat)", { pricing: { summary: { fromPrice: 99 }, currency: "USD" } }), product("ZZ", "Somewhere Else Entirely")], nextCursor: null });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

test("a pull matches destinations to metros, drops what is not an experience, and stores the rest with the API's own link", async () => {
  const r = await pullViator({ metros: ["tampa", "miami", "orlando"], perMetro: 10, write: true });
  assert.equal(r.metros, 3);
  assert.equal(r.matched, 2, "Tampa and Miami match a city destination; Orlando has none in this fake list");
  assert.deepEqual(r.skipped, ["orlando"]);
  assert.equal(r.products, 3, "the shuttle is not an experience; the insecure Miami link is counted but not stored");
  assert.equal(r.written, 2);
  const rows = db.prepare("SELECT id, title, metro_id, from_cents, booking_url, images, flags FROM affiliate_products ORDER BY id").all() as Record<string, unknown>[];
  assert.deepEqual(rows.map((x) => x.id), ["a-viator-t1", "a-viator-t3"]);
  assert.equal(rows[0].metro_id, "tampa");
  assert.equal(rows[0].from_cents, 8900);
  assert.equal(rows[0].booking_url, "https://www.viator.com/tours/Tampa/x/d123-T1?pid=P00012345&mcid=42383&medium=api", "VIATOR_PID is appended when the link has no pid");
  assert.deepEqual(JSON.parse(String(rows[0].images)), ["https://media.tacdn.com/T1-720.jpg"], "the 720px variant, not the thumbnail");
  assert.deepEqual(JSON.parse(String(rows[0].flags)), ["FREE_CANCELLATION"]);
});

test("the rows come out as listings that link out, filed by kind, fresh only", () => {
  const items = affiliateCatalogItems();
  assert.equal(items.length, 2);
  const cruise = items.find((i) => i.id === "a-viator-t1")!;
  assert.equal(cruise.cat, "water");
  assert.equal(cruise.art, "cruise");
  assert.equal(cruise.from, 89);
  assert.equal(cruise.fc, "Free cancellation");
  assert.equal(cruise.dur, "2 hours");
  assert.equal(cruise.area, "Tampa, FL");
  assert.equal(cruise.assistant, false);
  assert.deepEqual(cruise.affiliate, { source: "viator", label: "Viator", url: "https://www.viator.com/tours/Tampa/x/d123-T1?pid=P00012345&mcid=42383&medium=api" });
  const jump = items.find((i) => i.id === "a-viator-t3")!;
  assert.equal(jump.art, "skydive");
  // A row older than the licence window is not published, whoever fetched it.
  const old = new Date(Date.now() - (MAX_AGE_HOURS + 1) * 3600 * 1000).toISOString();
  db.prepare("UPDATE affiliate_products SET fetched_at = ? WHERE id = 'a-viator-t3'").run(old);
  assert.deepEqual(affiliateCatalogItems().map((i) => i.id), ["a-viator-t1"]);
  db.prepare("UPDATE affiliate_products SET fetched_at = ? WHERE id = 'a-viator-t3'").run(new Date().toISOString());
});

test("a refresh updates only the products we hold and records where it stopped", async () => {
  const r = await refreshViator({ write: true });
  assert.equal(r.seen, 2);
  assert.equal(r.updated, 1, "ZZ is not ours and is ignored");
  const t1 = db.prepare("SELECT title, from_cents FROM affiliate_products WHERE id = 'a-viator-t1'").get() as { title: string; from_cents: number };
  assert.equal(t1.title, "Tampa Bay Dolphin Cruise (New Boat)");
  assert.equal(t1.from_cents, 9900);
  const sync = db.prepare("SELECT last_refresh_at, last_full_at FROM affiliate_sync WHERE source = 'viator'").get() as { last_refresh_at: string; last_full_at: string };
  assert.ok(sync.last_refresh_at && sync.last_full_at);
  assert.ok(calls.some((c) => c.includes("/products/modified-since")));
});

test("on a Basic Access key, where modified-since is 403, a refresh is the search again for what we hold", async () => {
  basicAccess = true;
  calls.length = 0;
  try {
    const r = await refreshViator({ write: true });
    assert.equal(r.seen, 3, "two Tampa experiences and one Miami, the shuttle dropped");
    assert.ok(calls.some((c) => c.includes("/products/modified-since")), "it tried the bulk endpoint first");
    assert.ok(calls.some((c) => c.endsWith("/products/search")), "and fell back to search");
    const t1 = db.prepare("SELECT title, fetched_at FROM affiliate_products WHERE id = 'a-viator-t1'").get() as { title: string; fetched_at: string };
    assert.equal(t1.title, "Tampa Bay Dolphin Cruise", "the search answer is the current one");
    assert.ok(Date.now() - Date.parse(t1.fetched_at) < 60_000, "the row is fresh again");
  } finally {
    basicAccess = false;
  }
});

test("the detail pass adds every photo, the full text, inclusions, requirements and the policy, and a refresh keeps them", async () => {
  calls.length = 0;
  const r = await detailViator({ write: true });
  assert.ok(r.fetched >= 1 && r.updated === r.fetched, JSON.stringify(r));
  const items = affiliateCatalogItems();
  const t1 = items.find((i) => i.id === "a-viator-t1") as Record<string, unknown>;
  assert.equal((t1.photos as string[]).length, 3, "the detail's photos replace the summary's one");
  assert.match(String(t1.blurb), /naturalist aboard/, "the longer description wins");
  assert.deepEqual(t1.includes, ["Bottled water", "Professional guide"]);
  assert.deepEqual(t1.requirements, ["Not recommended for travelers with spinal injuries"], "boilerplate lines are not requirements");
  assert.match(String(t1.cancellation), /cancel at least 24 hours/);
  assert.equal(t1.from, 89, "the price stays from the search, where Viator states it");
  // A second run fetches nothing: every row holds its detail.
  calls.length = 0;
  const again = await detailViator({ write: true });
  assert.equal(again.fetched, 0);
  // A refresh through the search summary (one photo, cut text) keeps the richer detail.
  basicAccess = true;
  try {
    await refreshViator({ write: true });
  } finally {
    basicAccess = false;
  }
  const after = affiliateCatalogItems().find((i) => i.id === "a-viator-t1") as Record<string, unknown>;
  assert.equal((after.photos as string[]).length, 3, "a refresh from the summary must not throw the photo set away");
  assert.deepEqual(after.includes, ["Bottled water", "Professional guide"], "nor the inclusions");
});

test("a dry pull calls the API and stores nothing", async () => {
  db.exec("DELETE FROM affiliate_products");
  const r = await pullViator({ metros: ["tampa"], perMetro: 10, write: false });
  assert.equal(r.products, 2);
  assert.equal(r.written, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM affiliate_products").get() as { n: number }).n, 0);
});

test.after(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

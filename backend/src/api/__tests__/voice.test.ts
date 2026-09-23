import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The phone-agent data endpoints read the site's published o/<id>.json (the same record a listing page reads),
 * not SQLite, because the API host has no operators table. So the test serves a listing over a stubbed fetch and
 * checks the agent gets only published facts, real prices and an honest gap where the calendar is not connected.
 */

process.env.SITE_URL = "https://onoutset.com/";
const { voice } = await import("../voice.ts");

const reel = {
  id: "o-reeltime-com",
  title: "Reel Time Charters",
  area: "Clearwater, FL",
  blurb: "Family-run inshore fishing out of Clearwater.",
  from: 600,
  dur: "4 hours",
  options: [{ name: "Half day inshore", detail: "up to 4 guests", price: 600 }],
  includes: ["Rods, reels and bait", "Fishing license"],
  requirements: ["Bring a hat and sunscreen."],
  policies: ["50% deposit."],
  cancellation: "Refundable up to 48 hours before.",
  hoursText: ["Mon-Sat 6am-6pm"],
  contact: { phone: "+17275551212", website: "https://reeltime.com" },
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === "https://onoutset.com/o/o-reeltime-com.json") return new Response(JSON.stringify(reel), { status: 200, headers: { "content-type": "application/json" } });
  // Everything else (the live-index availability reads for a non-vendor operator) is a miss, so availability is not live.
  return new Response("not found", { status: 404 });
}) as typeof fetch;

test("GET /voice/:id returns the listing's own facts, prices and rules, and nothing invented", async () => {
  const res = await voice.request("http://localhost/voice/o-reeltime-com");
  assert.equal(res.status, 200);
  const { business, speak } = (await res.json()) as { business: Record<string, unknown>; speak: Record<string, unknown> };
  assert.equal(business.name, "Reel Time Charters");
  assert.equal(business.where, "Clearwater, FL");
  assert.deepEqual(business.hours, ["Mon-Sat 6am-6pm"]);
  assert.deepEqual(business.offers, [{ name: "Half day inshore", detail: "up to 4 guests", price: "$600" }]);
  assert.equal(business.fromPrice, "$600");
  assert.deepEqual(business.policies, ["50% deposit."]);
  assert.deepEqual(business.requirements, ["Bring a hat and sunscreen."]);
  assert.equal(business.cancellation, "Refundable up to 48 hours before.");
  assert.equal(business.phone, "+17275551212");
  assert.equal(business.bookingUrl, "https://onoutset.com/#o=o-reeltime-com");
  assert.equal(speak.onlyPublishedFacts, true);
});

test("GET /voice/:id/availability answers a plain not-connected gap, never a guessed time", async () => {
  const res = await voice.request("http://localhost/voice/o-reeltime-com/availability?from=2026-10-01&days=7");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { live: boolean; days: unknown[]; note?: string };
  assert.equal(body.live, false, "no readable booking vendor, so no live calendar");
  assert.deepEqual(body.days, []);
  assert.match(body.note || "", /person confirms/i);
});

test("an unknown operator is a 404, and a bad id a 400", async () => {
  assert.equal((await voice.request("http://localhost/voice/o-does-not-exist")).status, 404);
  assert.equal((await voice.request("http://localhost/voice/BAD ID")).status, 400);
  assert.equal((await voice.request("http://localhost/voice/o-reeltime-com/availability?from=nope")).status, 400);
});

test.after(() => {
  globalThis.fetch = realFetch;
});

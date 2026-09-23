import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The phone-agent data endpoints: a voice platform calls these during a call, so they must return only the
 * operator's own published facts and its real availability, and an honest gap where a fact is missing.
 */

const tmp = mkdtempSync(join(tmpdir(), "outset-voice-"));
process.env.OUTSET_DB = join(tmp, "test.db");

const { db, migrate } = await import("../../db/client.ts");
migrate();
const { ingestAll } = await import("../../ingest/load.ts");
ingestAll();
const { voice } = await import("../voice.ts");

const now = new Date().toISOString();
db.prepare(
  "INSERT INTO operators (id, domain, name, website, phone, city, region, country, hours, booking_mode, origin, category_id, icon_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
).run("o-reeltime-com", "reeltime.com", "Reel Time Charters", "https://reeltime.com", "+17275551212", "Clearwater", "FL", "US", "Mon-Sat 6am-6pm", "request", "public_site", "fishing", "fishing", now, now);
db.prepare("INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("of1", "o-reeltime-com", "Half day inshore", "up to 4 guests", "4 hours", 60000, "per trip", "USD", "ai");
db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?, ?, ?, ?, ?)").run("f1", "o-reeltime-com", "policy", "50% deposit, refundable up to 48 hours before.", "ai");
db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?, ?, ?, ?, ?)").run("f2", "o-reeltime-com", "requirement", "Bring a hat and sunscreen.", "ai");
db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?, ?, ?, ?, ?)").run("f3", "o-reeltime-com", "description", "Family-run inshore fishing out of Clearwater.", "ai");

test("GET /voice/:id returns the operator's own facts, prices and rules, and nothing invented", async () => {
  const res = await voice.request("http://localhost/voice/o-reeltime-com");
  assert.equal(res.status, 200);
  const { business, speak } = (await res.json()) as { business: Record<string, unknown>; speak: Record<string, unknown> };
  assert.equal(business.name, "Reel Time Charters");
  assert.equal(business.where, "Clearwater, FL");
  assert.equal(business.hours, "Mon-Sat 6am-6pm");
  assert.deepEqual(business.offers, [{ name: "Half day inshore", detail: "up to 4 guests", duration: "4 hours", price: "$600 per trip" }]);
  assert.deepEqual(business.policies, ["50% deposit, refundable up to 48 hours before."]);
  assert.deepEqual(business.requirements, ["Bring a hat and sunscreen."]);
  assert.equal(business.about, "Family-run inshore fishing out of Clearwater.");
  assert.equal(business.bookingUrl, "https://reeltime.com");
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
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

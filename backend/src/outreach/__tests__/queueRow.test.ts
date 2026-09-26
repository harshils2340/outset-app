import { strict as assert } from "node:assert";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Which id a send queue row carries, and which one the copy is written from.
 *
 * A row of either queue joins two tables, so it holds two ids: the draft row's, which marks the row sent,
 * and the operator's, which is what `pageFacts` reads a page's photos, prices, hours and cancellation policy
 * by. The Otto queue named the second one `opid` and used it. The listing queue selected only `d.id`, and
 * `sendOutreach` passed the whole row to `composeOutreach`, so every listing email the daily ramp actually
 * sent looked up the facts of an operator that does not exist: the sentence naming what we would build the
 * page from ("using services, your photos and your cancellation policy") collapsed to the generic one, and
 * the line saying the prices came from the shop's own booking widget was dropped.
 *
 * Nothing in the workflow showed it. The draft stored in SQLite is written from the operator itself and
 * still carried the good copy, `--dry` prints only the subject, and the `--to=` sample branch fetches
 * `SELECT o.*`, so a sample to yourself read correctly while the batch did not.
 *
 * No network and no Postgres: one temporary SQLite file, seeded below.
 */

process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-queuerow-")), "outreach.db");
const { db, migrate, nowIso } = await import("../../db/client.ts");
const { composeOutreach, pageFacts, generateOutreachDrafts } = await import("../drafts.ts");
const { listingQueue, operatorOf } = await import("../send.ts");
const { ottoQueue } = await import("../sendOtto.ts");
const { generateOttoDrafts } = await import("../ottoDrafts.ts");

migrate();

/** One operator complete enough to clear every filter the listing queue applies. */
function seed(): string {
  const id = randomUUID();
  const at = nowIso();
  db.prepare(
    `INSERT INTO operators (id, domain, name, website, phone, email, city, region, country, family, icon_key,
       claim_status, booking_mode, origin, calendar_vendor, completeness, review_count, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, "gulfjetskis.com", "Gulf Jet Skis", "https://gulfjetskis.com/", "+18135550101", "info@gulfjetskis.com",
    "Tampa", "FL", "US", "water", "jetski", "unclaimed", "request", "public_site", "fareharbor", 90, 42, at, at,
  );
  const fact = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?,?,?,?,?,?)");
  fact.run(randomUUID(), id, "cover", "https://gulfjetskis.com/cover.jpg", null, "ai");
  for (let i = 0; i < 4; i++) fact.run(randomUUID(), id, "photo", "https://gulfjetskis.com/p" + i + ".jpg", null, "ai");
  fact.run(randomUUID(), id, "cancellation", "48 hours notice for a full refund.", null, "ai");
  const off = db.prepare("INSERT INTO offerings (id, operator_id, name, price_cents, currency, confidence) VALUES (?,?,?,?,?,?)");
  off.run(randomUUID(), id, "Half day jet ski", 13000, "USD", "widget");
  off.run(randomUUID(), id, "Sunset cruise", 9000, "USD", "widget");
  return id;
}

const operatorId = seed();
generateOutreachDrafts();
generateOttoDrafts();

test("a listing queue row carries the operator's id beside the draft's", () => {
  const [r] = listingQueue(5, {});
  assert.ok(r, "the seeded operator should clear the listing queue's filters");
  assert.equal(r.opid, operatorId);
  assert.notEqual(r.id, operatorId, "d.id is the draft row, not the operator");
  assert.equal(operatorOf(r).id, operatorId);
});

test("the listing copy is written from the operator, not from the draft row", () => {
  const [r] = listingQueue(5, {});
  const sent = composeOutreach(operatorOf(r), "info@gulfjetskis.com");
  assert.match(sent.body, /a complete page using services, your photos and your cancellation policy/);
  assert.match(sent.body, /prices on your page came straight from your FareHarbor listings/);
  // The stored draft is what anyone previewing the queue reads. The mail that goes out must say the same.
  const stored = db.prepare("SELECT body FROM outreach_drafts WHERE kind = 'listing'").get() as { body: string };
  assert.equal(sent.body, stored.body);
});

test("the draft id reads as an operator with nothing on its page, which is the mistake", () => {
  const [r] = listingQueue(5, {});
  assert.deepEqual(pageFacts(r.id), { priced: [], services: 0, photos: false, hours: false, rules: false, menuFromWidget: false });
  assert.equal(pageFacts(operatorId).photos, true);
});

test("the otto queue names the operator's id the same way", () => {
  const [r] = ottoQueue(5);
  assert.ok(r);
  assert.equal(r.opid, operatorId);
  assert.notEqual(r.id, operatorId);
});

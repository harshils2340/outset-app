import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A partner's product (Viator, Tiqets) is shown under licence and booked on the partner's site. Nothing on
 * Outset offers a time for one, but POST /bookings is the route that actually decides, and the partner's
 * detail file sits in public/o with every other listing: an id typed into a link, or a client that is not
 * our own page, used to store a booking row for it and alert the founder to ring a business that never sold
 * it, with no operator to email and no slot to hold.
 *
 * STORE_DIR points the catalog reader at a throwaway folder, and the refusal happens before the route reaches
 * Postgres, so this runs with no database.
 */

process.env.CLAIM_SECRET ||= "affiliate-booking-test-secret";
const dir = mkdtempSync(join(tmpdir(), "outset-affiliate-"));
mkdirSync(join(dir, "o"), { recursive: true });
writeFileSync(
  join(dir, "o", "a-viator-t1.json"),
  JSON.stringify({
    title: "Tampa Bay Dolphin Cruise",
    area: "Tampa, FL",
    options: [],
    affiliate: { source: "viator", label: "Viator", url: "https://www.viator.com/tours/Tampa/x/d123-T1?pid=P1" },
  }),
);
writeFileSync(
  join(dir, "o", "a-tiqets-t2.json"),
  JSON.stringify({ title: "Salvador Dali Museum entry", area: "St Petersburg, FL", options: [], affiliate: { source: "tiqets", label: "Tiqets", url: "https://www.tiqets.com/x" } }),
);
process.env.STORE_DIR = dir;
const { bookings } = await import("../bookings.ts");

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function post(listing: string, code: string) {
  return bookings.request("/bookings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      listing,
      code,
      date: tomorrow,
      slot: "10:00",
      qty: 2,
      service: "Dolphin cruise",
      guest: { name: "Sam Guest", phone: "813 555 0111", email: "sam@example.com" },
    }),
  });
}

test("a booking for a partner's product is refused, and says where it is booked", async () => {
  const res = await post("a-viator-t1", "AFF001");
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, "This experience is booked on Viator, not on Outset");
});

test("the partner named is the one on the listing, not a hardcoded one", async () => {
  const res = await post("a-tiqets-t2", "AFF002");
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, "This experience is booked on Tiqets, not on Outset");
});

test.after(() => rmSync(dir, { recursive: true, force: true }));

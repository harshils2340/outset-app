import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { defaultProfile, gapIsNote } from "../operator";
import type { Unclaimed } from "../../data/types";

/**
 * A claimed listing publishes the policy list the prefill hands it, so the crawl's own note about a fact the
 * shop never published must never get in. 1,048 shipped listings carried one past the old guard.
 */

const NOTES = [
  "No pricing information for food or drinks.",
  "No prices published",
  "No offerings described on the site",
  "No stated age or other guest requirements",
  "No contact phone or email provided on this page.",
  "No information about the scenic park offerings, prices, duration, age limits, or what is included",
  "Age minimum not explicitly stated",
  "Class durations not always stated",
  "Maximum group size per room not explicitly stated",
  "Duration details for courses are not fully specified",
  "Exact street address for meeting point is not given; only described as 'Bob Evan's Restaurant'.",
  "Prices for services",
  "Duration of charters",
  "Exact cancellation and refund policy",
  "Deposit amount range ($500-$1000) not precisely defined per rental",
  "Durée minimum de séjour non indiquée",
  "Ask the operator about cancellations.",
  "Prices, hours and eligibility are not copied here yet. We will ask when you request.",
];

const SHOP_WORDS = [
  "No refunds.",
  "No refunds on online ticket purchases.",
  "NO refunds for any deposits, late arrivals or NO-SHOW reservations.",
  "No refunds or exchanges, unless you cancel 48 hours prior to your scheduled tour time.",
  "Refund Policy: A minimum of 5 days' notice is required for a full refund. Cancellations made 3-4 days before check-in will incur a 40% fee.",
  "Cancel at least 48 hours before your scheduled tour in order to receive a full refund. Refunds are not given for illness.",
  "10 days before, full refund. Beyond that 50% refund. 1 day before 30% refund.",
  "24 Hours notice. If weather is bad we will reschedule the tour.",
  "Tickets are non refundable unless event is canceled by Barefoot Queen.",
  "BOOK & CANCELLATION POLICY: [https://keen-fly.com/book-cancellations-policy/]",
  "Free cancellation up to 24 hours before your start time.",
];

test("the crawl's note about a missing fact is not the shop's policy", () => {
  for (const g of NOTES) assert.equal(gapIsNote(g), true, g);
});

test("a policy the shop published is kept", () => {
  for (const g of SHOP_WORDS) assert.equal(gapIsNote(g), false, g);
});

test("an empty gap is nothing either way", () => {
  assert.equal(gapIsNote(""), false);
  assert.equal(gapIsNote(null), false);
  assert.equal(gapIsNote(undefined), false);
});

test("a claim never publishes the note as a policy", () => {
  const owner = { name: "Sam", email: "sam@shop.com", phone: "+15550000000" };
  const base = { id: "o-x", title: "Shop", cat: "water", art: "jetski", area: "Tampa, FL", metroId: "tampa", src: "shop.com", specs: [], options: [], includes: [], photos: [], tags: [] } as unknown as Unclaimed;
  const noted = defaultProfile({ ...base, gap: "No pricing information for food or drinks.", policies: [] } as unknown as Unclaimed, owner);
  assert.deepEqual(noted.policy, []);
  const real = defaultProfile({ ...base, gap: "No refunds on online ticket purchases.", policies: [] } as unknown as Unclaimed, owner);
  assert.deepEqual(real.policy, ["No refunds on online ticket purchases."]);
});

test("no shipped listing claims into a policy list holding one of our notes", () => {
  const dir = path.join(process.cwd(), "public", "o");
  if (!fs.existsSync(dir)) return;
  const bad: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("o-"))) {
    const u = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Unclaimed;
    if (!u.gap) continue;
    const g = u.gap.replace(/\s+/g, " ").trim();
    // The shapes a note is written in. Everything else is the shop's own words and stays.
    if (!/^\s*no(?:ne)?\b[^.!]{0,80}\b(?:pricing|prices?|offerings?|information|durations?|ages?|requirements?)\b/i.test(g) && !/\bnot\s+(?:[a-z]+ly\s+)?(?:stated|specified|listed|detailed|mentioned)\b/i.test(g)) continue;
    if (!gapIsNote(g)) bad.push(f + " | " + g.slice(0, 100));
  }
  assert.deepEqual(bad.slice(0, 10), [], bad.length + " notes would still be published as a shop's policy");
});

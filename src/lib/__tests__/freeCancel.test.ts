import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { freeCancel, freeCancelBadge, onlyOperatorCancels } from "../cancellation";
import { passesFilters } from "../../components/explore/prefs";
import type { Unclaimed } from "../../data/types";

/**
 * The "Free cancellation" badge on the card, the listing page, the booking box and the feed filter.
 *
 * It says the guest can change their mind and get their money back. What the reader could not tell apart was
 * the other promise operators publish, that they refund a trip they themselves call off for weather, so 72 of
 * the 1,314 shipped listings carrying the badge had nothing behind it. Every case below is a real listing in
 * `public/o` and names the one it came from.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;

/* ---------- the badge that was never earned ---------- */

test("a non-refundable booking does not advertise free cancellation", () => {
  // o-sailtheseawolf-com: "You have booked a NON-REFUNDABLE, non-cancellable purchase." The sync used to ship this
  // listing with the badge as well, and this proved the page stripped it; the sync stopped setting it, so both the
  // stored flag and the drawn badge are checked, and either one coming back fails here.
  const j = listing("o-sailtheseawolf-com");
  assert.match(j.cancellation || "", /NON-REFUNDABLE, non-cancellable/i, "the policy changed, so this case needs a new listing");
  assert.equal(freeCancelBadge(j), null);
  assert.equal(freeCancelBadge({ ...j, fc: "Free cancellation" }), null, "a badge in the file must still be stripped");
});

test("a refund the shop pays when it calls the day off is not the guest's", () => {
  for (const id of ["o-2muddy-com", "o-paradisesailinghawaii-com", "o-gcovecharters-com"]) {
    const j = listing(id);
    // These shops refund when they call the day off, which is not a guest's right to cancel. The sync no longer
    // badges them, so the badge is forced back on to prove the page still refuses to draw it.
    assert.equal(freeCancelBadge(j), null, id);
    assert.equal(freeCancelBadge({ ...j, fc: "Free cancellation" }), null, id + " with the badge forced on");
  }
});

test("all sales are final beats a weather refund", () => {
  // o-islandcurrent-com: "All sales are final. Full refund in case of operator cancellation due to weather."
  assert.equal(freeCancelBadge(listing("o-islandcurrent-com")), null);
  // o-lowcountrywatersports-com: the 12 hour window is sold separately as Trip Protection.
  assert.equal(freeCancelBadge(listing("o-lowcountrywatersports-com")), null);
  // o-boatgenevalake-com: only the deposit comes back, and only for weather.
  assert.equal(freeCancelBadge(listing("o-boatgenevalake-com")), null);
});

test("the filter cannot let in a listing whose badge the page does not draw", () => {
  const j = listing("o-islandcurrent-com");
  const filters = { fav: false, cancel: true, priced: false, deal: false };
  assert.equal(passesFilters(j, filters, { priced: () => true, deal: () => false }), false);
});

/* ---------- the badge that stands ---------- */

test("a shop that lets a guest cancel keeps its badge", () => {
  // Both promises in one policy, which is how most shops write it.
  assert.equal(
    freeCancel("Cancel up to 48 hours prior for full refund. Full refund if the cruise is cancelled due to weather."),
    "Free cancellation up to 48 hours before",
  );
  assert.equal(freeCancel("Cancellations greater than 14 days from the reservation date will receive a full refund."), "Free cancellation up to 14 days before");
  assert.equal(onlyOperatorCancels("Charter payments are fully refundable with 30 days written cancellation notice or if cancelled due to unsafe weather."), false);
});

test("a cancellation window without a fee is still the guest's", () => {
  // o-hornbyislandsailing-com: "Cancellations up to 48 hours before trip without fee", then a weather refund.
  assert.equal(freeCancelBadge(listing("o-hornbyislandsailing-com")), "Free cancellation up to 48 hours before");
  // o-hottubboatvictoria-ca: "More than 72 hours of notice ... receive a full refund".
  assert.ok(freeCancelBadge(listing("o-hottubboatvictoria-ca")));
});

test("the guest's promise counts from any line the shop publishes", () => {
  // o-seaspiritfishing-com states only the weather refund in its cancellation text and "a minimum of 24 hours
  // cancellation notice for a refund or rebook" in its policy lines.
  const j = listing("o-seaspiritfishing-com");
  assert.match((j.policies || []).join(" "), /24 hours cancellation notice/i, "the policy changed, so this case needs a new listing");
  assert.equal(onlyOperatorCancels(j.cancellation), true);
  assert.ok(freeCancelBadge(j));
});

test("a claimed shop is judged on the policy it typed", () => {
  // publishedPatch reads the operator's own cancellation line and nothing else.
  assert.equal(freeCancel("Full refund if we cancel for weather."), null);
  assert.equal(freeCancel("Cancel any time up to 24 hours before for a full refund."), "Free cancellation up to 24 hours before");
});

/* ---------- the whole shipped catalog ---------- */

test("no shipped listing keeps a badge its policy never promises", () => {
  // These four sentences are the ones that put the badge on a page that never offered it.
  const never = [/NON-REFUNDABLE, non-cancellable/i, /All sales are final\./i, /Tickets purchased are non-refundable/i, /Deposits fully refundable only if weather/i];
  const offenders: string[] = [];
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    if (!freeCancelBadge(j)) continue;
    const text = [j.cancellation || "", ...(j.policies || [])].join(" ");
    if (never.some((re) => re.test(text)) && onlyOperatorCancels(text)) offenders.push(j.id);
  }
  assert.deepEqual(offenders.slice(0, 10), []);
});

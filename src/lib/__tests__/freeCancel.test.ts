import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { cancelWindow, freeCancel, freeCancelBadge, onlyOperatorCancels } from "../cancellation";
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

/* ---------- which clause owns the number ---------- */

/**
 * The badge prints a window, and a window is a promise about money. It used to be the first number anywhere
 * in the policy text, whichever clause it sat in and whichever side of that clause's line it was on, so 141
 * of the 1,303 shipped badges advertised a number the shop never offered: often the one it charges in full
 * at. Every case below is a real listing in `public/o` and names the one it came from.
 */

test("the number comes from the clause that promises the refund, not from a no-refund line", () => {
  // o-baysidejetskirentals-com: the 48 hours is the window that is NOT refundable.
  assert.equal(
    freeCancel("Cancellations within 48 hours of the reservation are non-refundable. Customers will receive a full refund or credit with 24 hours notice of cancellation."),
    "Free cancellation up to 24 hours before",
  );
  // o-archangelcharters-com: promised at 30 hours a refund the shop only gives at 48.
  assert.equal(
    freeCancel("Charters cancelled within 24 hours will result in a forfeited deposit. Customers will receive a full refund or credit with 48 hours notice of cancellation."),
    "Free cancellation up to 48 hours before",
  );
  // o-blazenh-com: read its window off a $15 late-cancellation penalty. No clause promises one, so none is printed.
  assert.equal(
    freeCancel("Late class cancellations and no-shows within 3 hours incur $15 penalty No cancellations or refunds for workshops or trainings within 48 hours of event Monhegan retreat cancellations before April 21, 2027 get full refund minus deposit"),
    "Free cancellation",
  );
});

test("a rate card's promise owns the number to its left", () => {
  // o-baywatchtourscorpus-com, written as one line: the 6 hrs that follows "Full refund" is the half-refund window.
  assert.deepEqual(
    cancelWindow("Cancellations 24 hrs or more before departure time - Full refund Cancellations 6 hrs to 23 hrs before departure time - 50% refund"),
    { n: 24, unit: "hour" },
  );
  // o-boatpartyfortlauderdale-com: 13 days is the 50% line.
  assert.deepEqual(cancelWindow("14 days prior to charter 100 % full refund 13 days to 7 days prior to charter 50% refund."), { n: 14, unit: "day" });
});

test("the shop's own weather call never lends the badge its clock", () => {
  // o-boatnaples-com: the 2 hours is how long before departure the captain tells you, not a window to cancel in.
  assert.equal(
    freeCancel("Cancellation policy: Refunds 48 hours prior to departure. If the Captain cancels due to weather, you will be notified 2 hours prior to departure, with a full refund, or option to reschedule."),
    "Free cancellation up to 48 hours before",
  );
  // o-hhiboatcharters-com: the captain calls the weather "up to an hour prior"; the guest's window is 72 hours.
  assert.equal(
    freeCancel("WEATHER Your captain will make the call on weather and cancelling/rescheduling your tour up to an hour prior to your tour. If we cannot reschedule you, we will provide a full refund of any fare that you have paid. Guests that have not purchased trip insurance will have up to 72 hours to cancel their reservation for no fee."),
    "Free cancellation up to 72 hours before",
  );
});

test("a window the guest has to buy is not the free one", () => {
  // o-hudsonmarina-net asks everyone else for 72 hours and sells the 12 hour window with a protection plan.
  assert.equal(
    freeCancel("Customers must give 72 hour notice of cancellation to receive a refund. Customers will receive a full refund with purchase of cancelation protection plan with atleast 12 hours notice of cancellation."),
    "Free cancellation up to 72 hours before",
  );
});

test("the window is read however the shop writes the number", () => {
  // o-bigtexboatrentals-com ("15+ Days"), o-captainstewys-com ("3 or more days"), o-japowersportsfl-com, whose
  // promise word is what the clause splitter breaks on.
  assert.deepEqual(cancelWindow("Cancellations 15+ Days Before Trip - Cancel via email. You will receive a full refund."), { n: 15, unit: "day" });
  assert.deepEqual(cancelWindow("You will receive a full refund with 3 or more days notice from the Trip Depart Date."), { n: 3, unit: "day" });
  assert.deepEqual(cancelWindow("You may cancel a booking 3 days or more out for a FULL Refund."), { n: 3, unit: "day" });
  // Weeks and months used to be no window at all, so o-captainjoehughes-com printed a bare badge or the wrong day count.
  assert.equal(freeCancel("Charters cancelled two weeks prior to the date will be issued a full refund."), "Free cancellation up to 2 weeks before");
  assert.equal(freeCancel("Customers may cancel at least 1 month prior to their arrival date to receive a full refund."), "Free cancellation up to 1 month before");
});

test("a notice period written as 'within' is still the guest's side", () => {
  // o-boatrentalseekers-com and o-carolinaboatrentalswb-com both write their notice period this way.
  assert.equal(freeCancel("If you cancel your reservation within 12 hours in advance, you will receive a full refund."), "Free cancellation up to 12 hours before");
  assert.equal(freeCancel("Cancel within 48 hours for full refund; same day cancellation allowed for weather-related issues"), "Free cancellation up to 48 hours before");
  // But not when the same breath takes the money: o-inshorepursuitcharters-com and o-capehelitours-com.
  assert.equal(cancelWindow("Cancel within 14 days - $100 charge Cancel within 7 days - 50% refund"), null);
  assert.equal(cancelWindow("Cancel less than 24 hours before tour: reschedule once free, no refund"), null);
});

test("the badge a guest reads is re-read from the policy, not taken from the file", () => {
  // `fc` is written by the sync, which read this same text with the older rule. Until this was fixed the fresh
  // reading was only ever reached for the 22 shipped listings that carry no `fc` at all, so every later fix to
  // the rule stopped at the catalog and waited on a sync to reach a guest.
  const item = {
    fc: "Free cancellation up to 48 hours before",
    cancellation: "Cancellations within 48 hours of the reservation are non-refundable. Customers will receive a full refund or credit with 24 hours notice of cancellation.",
  };
  assert.equal(freeCancelBadge(item), "Free cancellation up to 24 hours before");
  // A listing whose own text does not carry the promise keeps what the sync published: o-hornbyislandsailing-com
  // says "without fee" rather than "full refund", and its badge is read off lines the file does not hold.
  assert.equal(freeCancelBadge({ fc: "Free cancellation up to 48 hours before", cancellation: "Cancellations up to 48 hours before trip without fee" }), "Free cancellation up to 48 hours before");
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

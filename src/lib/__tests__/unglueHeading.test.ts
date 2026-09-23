/**
 * A page heading the crawl swept up with the sentence under it, and the sentences that only looked like one.
 *
 * `tidyLine` strips the first word when the second repeats it, which is how "Cancellations Cancellation
 * requests received at least 48 hours before..." reaches a guest as its own sentence. It compared the two
 * words with a trailing s taken off both, and "As" with its s taken off is "a", so every line that opened
 * "As a" lost its first word: six of them ship, on the policy, cancellation and included columns, and each
 * one read as a different sentence from the one the shop wrote.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { unglueHeading } from "../listingDerive";

const dir = new URL("../../../public/o/", import.meta.url);

test("a heading that names the sentence under it is unglued", () => {
  // o-spraywatersports-com, the case the rule was written for.
  assert.equal(
    unglueHeading("Cancellations Cancellation requests received at least 48 hours before your scheduled check-in time"),
    "Cancellation requests received at least 48 hours before your scheduled check-in time",
  );
  assert.equal(unglueHeading("Gas Gas is not included in the rental rate."), "Gas is not included in the rental rate."); // o-marinasunnyside-com
  assert.equal(unglueHeading("CHECKS Checks are only accepted for the 50% deposit"), "Checks are only accepted for the 50% deposit"); // o-odysseysportfishingdanapoint-com
  assert.equal(unglueHeading("Weather Weather in Florida can be unpredictable."), "Weather in Florida can be unpredictable."); // o-jonesairandsea-com
  assert.equal(unglueHeading("Tickets Tickets are required for everyone ages 3 and up."), "Tickets are required for everyone ages 3 and up."); // o-brandywinezoo-org
});

test("a sentence that opens with a short word is not a heading over itself", () => {
  assert.equal(unglueHeading("As a reminder, it is customary to tip your crew."), "As a reminder, it is customary to tip your crew."); // o-keywestschooners-com
  assert.equal(
    unglueHeading("As a boat rental business, cancellations can be very costly."),
    "As a boat rental business, cancellations can be very costly.",
  ); // o-aebrentals-com
  assert.equal(
    unglueHeading("As a weather and tourism based company, cancellations can become very costly for us."),
    "As a weather and tourism based company, cancellations can become very costly for us.",
  ); // o-osm-way-1026591430
  assert.equal(
    unglueHeading("As a reminder, your booking includes one hour on the boat at dock in Port Dalhousie."),
    "As a reminder, your booking includes one hour on the boat at dock in Port Dalhousie.",
  ); // o-niagaranautico-com
  // No listing writes this today; a word of one or two letters is never a heading over itself.
  assert.equal(unglueHeading("A a la carte add-on"), "A a la carte add-on");
});

test("over the shipped catalog, only a real heading is taken off a line a guest reads", () => {
  const fired: string[] = [];
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Record<string, unknown>;
    const lines: string[] = [];
    for (const key of ["checkin", "meetingPoint", "cancellation", "highlights", "policies", "requirements", "bring", "groupInfo", "includes"]) {
      const v = j[key];
      if (typeof v === "string") lines.push(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") lines.push(x);
    }
    for (const l of lines) if (unglueHeading(l) !== l) fired.push(l.slice(0, 40));
  }
  // 22 shipped lines used to lose their first word. Six opened "As a" and were not headings at all.
  assert.ok(fired.length > 0, "the rule still has work to do");
  assert.deepEqual(fired.filter((l) => /^As\s/.test(l)), []);
});

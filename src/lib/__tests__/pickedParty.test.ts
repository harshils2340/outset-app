import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

import { setPrefs, startingParty } from "../../components/explore/prefs";

/** The rehearsal runs these from `backend/`, so a source path is read from this file rather than the shell. */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The party a guest picks in Who, against the party the booking box then opens on.
 *
 * The phone sheet has always carried the pick. The desktop home's Who stepper carried nothing: `guests` was
 * read once, to write the label on its own chip, and never again, so a guest who said "6 guests", opened a
 * listing and pressed Reserve was quoted for two. The date beside it carried all along, through app state,
 * which is what made the gap invisible: only the party was dropped.
 */

test("the booking box opens on the party the guest picked", () => {
  setPrefs({ who: 6 });
  assert.equal(startingParty(12), 6);
  setPrefs({ who: 1 });
  assert.equal(startingParty(12), 1);
});

test("the shop's own ceiling still wins", () => {
  // A jet ski holding two, with a party of six picked on the home page: the box opens on two, not six.
  setPrefs({ who: 6 });
  assert.equal(startingParty(2), 2);
  // And a picker that is somehow offered nothing still asks for one guest, never zero or minus one.
  assert.equal(startingParty(0), 1);
  assert.equal(startingParty(-3), 1);
});

test("no pick is two guests, the way it always was", () => {
  setPrefs({ who: null });
  assert.equal(startingParty(12), 2);
  // A stale or hand-edited zero is no pick either.
  setPrefs({ who: 0 });
  assert.equal(startingParty(12), 2);
  setPrefs({ who: null });
});

test("both booking boxes read the pick, and the desktop Who writes it", () => {
  const phone = read("../../components/booking/Sheets.tsx");
  const page = read("../../components/web/WebListing.tsx");
  const home = read("../../components/web/WebHome.tsx");
  // One rule, in one place, for the party a box opens on.
  assert.match(phone, /useState\(\(\) => startingParty\(QTY_MAX\)\)/);
  assert.match(page, /useState\(\(\) => startingParty\(maxGuestsFor\(item, defaultOption\(item\.options\)\)\)\)/);
  // The steppers hand their total to one place, rather than each setting its own state and stopping there.
  assert.match(home, /onChange=\{\(n\) => pickParty\(n, kids\)\}/);
  assert.match(home, /onChange=\{\(n\) => pickParty\(who, n\)\}/);
  assert.equal(/setPrefs\(\{ who: cleared \? null : adults \+ children \}\)/.test(home), true);
  // Clear all clears the pick too, or the next listing opens on a party the pill no longer shows.
  assert.match(home, /pickParty\(2, 0, true\)/);
});

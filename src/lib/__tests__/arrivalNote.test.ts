/**
 * What a shop says about arriving, swept over every note the catalog ships.
 *
 * 644 listings publish a check-in note and the two surfaces that print it, the desktop listing page and the
 * phone booking sheet, both read it through `arrivalNote`. That rule dropped a note whole when it opened with
 * a greeting, so 106 shops said where to meet and how early to be there and the guest was shown nothing:
 * "Meeting location: Pier 39, Gate I", "please arrive at the dock 45 minutes prior to sailing time", "We meet
 * under the white tent behind the GoldBelt Tram building". The other half of it printed a whole note that was
 * only courtesy, so "When you arrive" read "We're looking forward to seeing you!" and, once, "Tax ID".
 *
 * Every line below is a real one from public/o, named by the listing it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { arrivalWords } from "../listingDerive";

const dir = new URL("../../../public/o/", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("a greeting in front of the arrival facts loses the greeting, not the facts", () => {
  // o-bayvoyager-com, shown nothing at all before this.
  assert.equal(
    arrivalWords(
      "Thank you for booking with us and letting Bay Voyager share with you an adventure you’ll never forget! " +
        'Please arrive no later then 30 minutes prior to departure to be signed in and suited up in foul weather gear & life jackets. Meeting location: Pier 39, Gate "I".',
    ),
    'Please arrive no later then 30 minutes prior to departure to be signed in and suited up in foul weather gear & life jackets. Meeting location: Pier 39, Gate "I".',
  );
  // o-downeastrover-com: "Thanks" never matched the old rule's "thank\b" either way round.
  assert.equal(
    arrivalWords("Thanks for booking with us! The Day of Your Booking Please Arrive 30 Minutes Early"),
    "The Day of Your Booking Please Arrive 30 Minutes Early",
  );
  // o-alaskaanglersclub-com.
  assert.equal(
    arrivalWords("Thank you for trusting us with your Alaska fishing adventure! We meet under the white tent behind the GoldBelt Tram building."),
    "We meet under the white tent behind the GoldBelt Tram building.",
  );
});

test("a sign-off at the end goes too, wherever the courtesy sits", () => {
  // o-destinhelicopters-com and o-galvestonhelicopters-com both end this way.
  assert.equal(
    arrivalWords("Shoes are required. Sandals are fine. We look forward to having you as our guest!"),
    "Shoes are required. Sandals are fine.",
  );
  // o-adventurecat-com.
  assert.equal(arrivalWords("Please also do your best to show patience during the check in process. Thank you!"), "Please also do your best to show patience during the check in process.");
});

test("a note that is only courtesy is no arrival note", () => {
  for (const only of [
    "We are looking forward to seeing you!", // o-northaireresort-com
    "We're looking forward to seeing you!", // o-fishseaplay-com
    "We're looking forward to your reservation!", // o-mobsquadfishing-com
    "Thanks for Booking with us!", // o-fortlauderdaleboatrentalwithcaptain-com
    "YOU'RE ALL SET!", // o-wingsairways-com
    "Check out our website!", // o-sightseaflorida-com
    "Like us on Facebook! Like us on Instagram!", // o-princevilleranch-com
    "Connect with Holoholo Charters", // o-holoholocharters-com
    "We appreciate you for choosing Sail San Diego! We look forward to having you as our guest!", // o-sailsandiego-com
    "See you soon!", // o-spraywatersports-com
    "Thank you for choosing Go Fish Inshore Charters! We're looking forward to seeing you! Capt.", // o-fishnorthmyrtlebeach-com
  ]) {
    assert.equal(arrivalWords(only), "", only);
  }
});

test("a courtesy that carries a fact keeps the fact", () => {
  // o-islandwatershuttle-com: the whole note is one sentence and it names the time.
  assert.equal(
    arrivalWords("We're looking forward to your reservation! Please be sure to arrive 15 minutes early!"),
    "Please be sure to arrive 15 minutes early!",
  );
  // A greeting that states the place is the shop's own fact, so it stays.
  assert.equal(arrivalWords("Welcome to Dock 2 at Dana Point."), "Welcome to Dock 2 at Dana Point.");
  // o-myrtlebeachwatersports-com: "Enjoy" opens a fact, not a farewell.
  assert.equal(arrivalWords("Enjoy free parking available on location"), "Enjoy free parking available on location");
});

test("over the shipped catalog, no arrival note is only courtesy and none that carries a fact is dropped", () => {
  const notes: { id: string; checkin: string }[] = [];
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { id: string; checkin?: string };
    if (j.checkin) notes.push({ id: j.id, checkin: j.checkin });
  }
  assert.ok(notes.length > 600, "the catalog still ships arrival notes");

  const shown = notes.filter((n) => arrivalWords(n.checkin));
  // 459 were shown before this rule and 546 are now: 106 notes newly shown, 19 that were only courtesy
  // gone, and 108 shortened. Every one of the 19 is a farewell and nothing else.
  assert.ok(shown.length >= 540, "notes shown: " + shown.length);

  // Nothing a guest is shown opens with a farewell unless that sentence also states a fact, which is what
  // o-tctikiboattours-com does: "We look forward to seeing you Important Please arrive 15 minutes early".
  const FAREWELL = /^(?:we(?:'re|’re| are)? ?(?:looking forward|look forward)|thanks? for booking|see you|you(?:'re|’re) all set)[^.!?]*[.!?]?$/i;
  const empty = shown.filter((n) => {
    const words = arrivalWords(n.checkin).trim();
    return FAREWELL.test(words) && !/\d|\barriv|\bpark|\bdock\b|\bmeet\b/i.test(words);
  });
  assert.deepEqual(empty.map((n) => n.id), []);

  // Nothing that states a time, a dock or a waiver is dropped.
  const lost = notes.filter((n) => !arrivalWords(n.checkin) && /\barriv|\bdock\b|\bwaiver|\bmeet\b|\d{1,2}\s*min/i.test(n.checkin));
  assert.deepEqual(lost.map((n) => n.id), []);
});

test("both guest surfaces and Otto read the one rule", () => {
  const listing = read("../../components/web/WebListing.tsx");
  assert.match(listing, /arrivalWords[^\n]*from "\.\.\/\.\.\/lib\/listingDerive"/);
  assert.match(listing, /const words = arrivalWords\(item\.checkin \|\| ""\)/);
  // The phone booking sheet prints the same line through the same function.
  assert.match(read("../../components/booking/Sheets.tsx"), /arrivalNote[^\n]*from "\.\.\/web\/WebListing"/);
  assert.match(read("../companyAgent.ts"), /const arrival = arrivalWords\(ctx\.item\.checkin \|\| ""\)/);
});

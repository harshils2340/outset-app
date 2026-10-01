/**
 * One shop, one spelling of where it is.
 *
 * The 27 September fix spelled a coded state out on the desktop listing page's heading and Where subtitle, the
 * review-and-pay sheet and the confirm screen's "Getting there" row, because 2,943 listings publish a state or
 * province code with no town in front of it and those lines read "Kayak rental in MD". The raw field was still
 * read on four surfaces, and three of them sit on a screen that had already been fixed, so one screen named the
 * same shop two ways:
 *
 * - the desktop Where card's own "Address" line, directly under a subtitle that says "Maryland";
 * - the phone sheet's twin of that row, and its "Hosted by" line;
 * - the confirm screen's summary card, two sections below its own "Getting there" row;
 * - Otto, which answered "They're in MD, but no street address is published" and filed "Angler Watersports is
 *   in MD." as the fact its grounded answers are built from.
 *
 * A code still belongs in three places and keeps them: a feed or rail card, which has no room to spell a state
 * out, the operator's own dashboard lists, and structured data, where schema.org asks for `addressRegion` in
 * code form. A street address the shop published keeps the code its own page prints.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { companyAnswer, companyFacts } from "../companyAgent";
import { meetPlace, placeName } from "../listingDerive";
import { addressLine, contactFor } from "../catalog";
import type { Unclaimed } from "../../data/types";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SHEETS = read("../../components/booking/Sheets.tsx");
const WEB = read("../../components/web/WebListing.tsx");
const CONFIRM = read("../../components/web/WebConfirm.tsx");
const PHONE_CONFIRM = read("../../components/booking/ConfirmView.tsx");

test("the Where row a guest reads names the state, on both listing surfaces", () => {
  assert.match(
    WEB,
    /\{item\.meetingPoint \? tidyLine\(item\.meetingPoint\) : address \|\| placeName\(item\.area\)\}/,
    "the desktop Where card prints a raw area under a subtitle that spells it out",
  );
  assert.match(SHEETS, /const place = placeRaw === item\.area \? placeName\(item\.area\) : tidyAddress\(placeRaw\)/, "the phone sheet's Where row prints a raw area");
  // The address the shop published is its own line and keeps the code it prints.
  assert.match(SHEETS, /tidyAddress\(placeRaw\)/);
});

test("the phone sheet's host line and the confirm screen's summary name the state", () => {
  assert.match(SHEETS, /\{\[kind, placeName\(item\.area\)\]\.join\(" · "\)\}/, "the host line prints a raw area");
  assert.match(CONFIRM, /<small>\{placeName\(item\.area\)\}<\/small>/, "the confirm summary prints a raw area");
});

/**
 * The ticket on the phone, which is the one screen a guest keeps.
 *
 * `WebConfirm` is the desktop confirmation and was fixed on 27 September. Its twin on the phone was not: the
 * row labelled "Meet at" printed `u.area` raw, so the same booking read "Meet at OH" on a phone and "Ohio",
 * with directions beside it, on a laptop. The area line is not a meeting point even when it names a town, so
 * this reads the street the shop published first, the way the desktop confirmation and the pay sheet both do.
 */
test("the phone confirmation names the door, not the area line", () => {
  assert.match(
    PHONE_CONFIRM,
    /const where = l \? l\.launch : addressRaw \? tidyAddress\(addressRaw\) : meetPlace\(u!\.area\)/,
    "the phone confirmation prints a raw area under 'Meet at'",
  );
  // A state is not a meeting point, so the row goes rather than being filled with the widest place we hold.
  assert.match(PHONE_CONFIRM, /\{where \? \(/, "the phone confirmation draws a 'Meet at' row it has nothing for");
});

/**
 * The two shapes that row has to answer for, on real shipped listings.
 *
 * AerOhio publishes a state code and no street, so there is nothing honest to print. 105 Fever publishes a
 * street, which is what a guest can actually drive to; roughly nine operator listings in ten do.
 */
test("the phone confirmation's meeting place, on two shipped listings", () => {
  const load = (id: string) => JSON.parse(readFileSync(new URL(`../../../public/o/${id}.json`, import.meta.url), "utf8")) as Unclaimed;
  // The same chain the screen reads. `tidyAddress` only normalises spacing in the string it is handed, and it
  // lives in a component that pulls a stylesheet in, so the expression itself is pinned by the test above.
  const where = (u: Unclaimed) => {
    const contact = contactFor(u);
    return (contact && addressLine(contact)) || meetPlace(u.area);
  };

  const ohio = load("o-aerohio-com");
  assert.equal(ohio.area, "OH", "the sample listing no longer ships a bare code");
  assert.equal(ohio.contact?.street ?? null, null, "the sample listing now publishes a street");
  assert.equal(where(ohio), "", "a whole state was printed as a meeting point");

  const houston = load("o-105fever-com");
  assert.equal(houston.area, "Houston, TX");
  assert.equal(where(houston), "2493 South Braeswood Boulevard, Houston, TX, 77030", "the shop's own street was dropped for its area line");
});

/** Otto answers "where are you" and files the same place as the fact its grounded answers are built from. */
test("Otto names the state in its own words and in its facts", () => {
  // A real shipped listing whose town was never read, with no street address and no meeting point of its own.
  const item = JSON.parse(readFileSync(new URL("../../../public/o/o-aerohio-com.json", import.meta.url), "utf8")) as Unclaimed;
  assert.equal(item.area, "OH", "the sample listing no longer ships a bare code");
  const ctx = { item, contact: item.contact ?? null, live: null };
  const about = companyFacts(ctx).find((f) => f.id === "about");
  assert.ok(about, "no About fact");
  assert.match(about!.text, /AerOhio Skydiving is in Ohio\./);
  assert.doesNotMatch(about!.text, / is in OH\./);
  // The shop published no street and no meeting point, so this is the whole of what Otto can say about where.
  const where = companyAnswer(ctx, "where are you?").text;
  assert.match(where, /They're in Ohio, but no street address is published\./);
  assert.equal(placeName("OH"), "Ohio");
});

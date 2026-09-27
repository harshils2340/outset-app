import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { companyAnswer } from "../companyAgent";
import type { Unclaimed } from "../../data/types";

/**
 * How Otto words an answer around a shop's own words.
 *
 * Two faults, both from treating the shop's string as if Otto had written it. An article was put in front of
 * every offer name, and 2,179 rows on 798 shipped listings already open with one: "From $95 for the The Nature
 * Conservancy Community Golf Days", "The Our Classes (Standard) at $85". And the first letter of a meeting
 * point and of an hour line was lowercased so it would sit mid-sentence, which broke 2,557 place names and 241
 * hour lines: "Meet at owl's Creek Boat Launch", "Their hours say: mon-Sun 12:00 AM".
 *
 * Every listing below is a real shipped record.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const ask = (id: string, q: string) => {
  const item = listing(id);
  return companyAnswer({ item, contact: item.contact ?? null, live: null }, q).text;
};

test("an offer whose own name opens with a determiner does not get a second one", () => {
  assert.equal(ask("o-adrenalinestudionova-com", "how much is it"), "From $85 for Our Classes (Standard).");
  assert.equal(ask("o-adrenalinestudionova-com", "what is the cheapest option"), "Our Classes (Standard) at $85.");
  assert.equal(ask("o-agawamhunt-org", "how much is it"), "From $95 for The Nature Conservancy Community Golf Days (Tee times after 9:00 a.m.).");
});

test("an offer whose name needs an article still gets one, in both answers", () => {
  const price = ask("o-1620anglers-com", "how much is it");
  assert.match(price, /for the Inshore Fishing Charter/, price);
  const cheap = ask("o-1620anglers-com", "what is the cheapest option");
  assert.match(cheap, /^The Inshore Fishing Charter/, cheap);
});

test("a meeting point that is the name of a place keeps the shop's own capital", () => {
  assert.match(ask("o-cbpedalclub-com", "where do we meet"), /^Meet at Owl’s Creek Boat Launch,/);
  assert.equal(ask("o-aerigohelicoptertours-com", "where do we meet"), "Meet at Phoenix Deer Valley Airport.");
});

test("a meeting point that opens on a determiner still reads as one sentence", () => {
  assert.equal(ask("o-alapark-com", "where do we meet"), "Meet at the Marina on Terrace Drive.");
  assert.match(ask("o-actionsportrentals-com", "where do we meet"), /^Meet at the rental location/);
});

test("an hour line keeps the capital on its day name", () => {
  assert.equal(ask("o-aerigohelicoptertours-com", "what time do you open"), "Their hours say: Mon-Sun 12:00 AM - 11:59 PM.");
});

/**
 * The shop's town, taken out of a service's name so two towns' variants group as one thing, used to leave the
 * word that introduced it and the region that followed it behind: "Our Charter Boat in Portsmouth, NH" read
 * "Our Charter Boat in , NH", "RV Park Serving Ashland, Ohio" read "RV Park Serving , Ohio", and a name that
 * lost several parts read "Jet ski Rental - , , , and". 182 shipped listings answered with one of these.
 */
test("a service name that lost the town it named does not keep the word that introduced it", () => {
  assert.equal(ask("o-northerntideyc-com", "what services do you have"), "11 options: River Cruise, Whale-Watching Cruise, Our Charter Boat and 8 more.");
  assert.equal(ask("o-ashlandrvpark-com", "what services do you have"), "Just one: RV Park.");
  assert.equal(ask("o-aerishelicoptertours-com", "what services do you have"), "Four things: Helicopter Tours, Introductory Flight, City Tour and Extended Private Flight.");
  assert.match(ask("o-aaajetski-com", "what services do you have"), /^Two things: Jet ski Rental and Two Hour/);
});

test("a shop that put an exclamation mark in a service name is not read out with a full stop after it", () => {
  assert.equal(ask("o-cruzinmonkey-com", "what services do you have"), "Just one: Jet Skis!");
});

/**
 * A quoted line that Otto had to cut ends on an ellipsis, and a line the shop ended on its own mark ends on
 * that mark. Neither wants a full stop after it: 192 listings read "Included: lots of fun!!!." and "Meet at
 * ... studio entry on Levels….", and an hour line too long to quote read "... to 30 minutes after sunset….".
 * The first letter of a list item is lowered only when the phrase carries no other capital, because a phrase
 * that does is a name: "Included: Special Treat" read "Included: special Treat".
 */
test("a line that ends on its own mark is not given a full stop as well", () => {
  assert.equal(ask("a-viator-5594933p1", "whats included"), "Included: lots of fun!!!");
  assert.match(ask("o-423yoga-com", "where do we meet"), /Levels…$/);
  assert.match(ask("o-austinrifleclub-org", "what time do you open"), /after sunset…$/);
});

test("a list item that is a name keeps its capital", () => {
  assert.equal(ask("a-viator-353600p1", "whats included"), "Included: Special Treat!");
  assert.equal(ask("a-viator-5593453p2", "whats included"), "Included: Tour Guide!");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  compareLine,
  headline,
  headlineService,
  listingForOption,
  listingIdFor,
  menuPrice,
  noTimesLine,
  refinements,
  missedTheHour,
  offsetLine,
  offsetOf,
  priceLine,
  readFrames,
  serviceLine,
  slotOf,
  spreadDepartures,
  groupShops,
  splitOptions,
  stepLine,
  understood,
  whenLine,
  withPlace,
  type ConciergeAnswer,
  type ConciergeDeparture,
  type ConciergeOption,
} from "../concierge";
import { experienceById } from "../catalog";
import { dateFromKey } from "../dates";

/**
 * The concierge, as the guest app reads it.
 *
 * `backend/src/concierge/AGENTS.md` keeps a list of things that were bugs, so nobody reintroduces them. Three
 * of them are the browser's to get wrong again, because the browser is where the answer is finally turned into
 * words: a date parsed as UTC, a pre-tax price quoted as the price, and a whole-room price said "a head".
 * Each has a test here. The rest of this file covers the stream reader, which is the one piece whose failures
 * are invisible: a dropped frame looks exactly like a step that never happened.
 */

/* ---------- the stream ---------- */

test("frames are only returned once they are whole", () => {
  // Chunks off a socket end wherever the packet ended. Half a frame is not a frame.
  const first = readFrames('event: step\ndata: {"kind":"read"}\n\nevent: step\ndata: {"kind":"cat');
  assert.equal(first.frames.length, 1);
  assert.deepEqual(JSON.parse(first.frames[0].data), { kind: "read" });
  assert.equal(first.frames[0].event, "step");

  // The tail goes back in front of the next chunk and completes there.
  const second = readFrames(first.rest + 'alog"}\n\n');
  assert.equal(second.frames.length, 1);
  assert.deepEqual(JSON.parse(second.frames[0].data), { kind: "catalog" });
  assert.equal(second.rest, "");
});

test("a frame split exactly on its blank line is not lost", () => {
  const a = readFrames("event: answer\ndata: {}\n");
  assert.deepEqual(a.frames, []);
  const b = readFrames(a.rest + "\n");
  assert.equal(b.frames.length, 1);
  assert.equal(b.frames[0].event, "answer");
});

test("both line endings are read, because a proxy may rewrite them", () => {
  const { frames } = readFrames("event: step\r\ndata: {\"kind\":\"ask\"}\r\n\r\n");
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "step");
  assert.deepEqual(JSON.parse(frames[0].data), { kind: "ask" });
});

test("several data lines in one frame are joined with newlines, and one space of padding is dropped", () => {
  const { frames } = readFrames("data: one\ndata: two\n\n");
  assert.equal(frames[0].data, "one\ntwo");
  // Only the single separating space is padding; anything further in is the payload's own.
  assert.equal(readFrames("data:  indented\n\n").frames[0].data, " indented");
});

test("an event with no data is not a frame, and the default event name is message", () => {
  assert.deepEqual(readFrames(": a comment\n\n").frames, []);
  assert.equal(readFrames("data: {}\n\n").frames[0].event, "message");
});

test("several frames arriving in one chunk all come out, in order", () => {
  const { frames, rest } = readFrames('event: step\ndata: 1\n\nevent: step\ndata: 2\n\nevent: answer\ndata: 3\n\n');
  assert.deepEqual(frames.map((f) => f.data), ["1", "2", "3"]);
  assert.deepEqual(frames.map((f) => f.event), ["step", "step", "answer"]);
  assert.equal(rest, "");
});

/* ---------- the date ---------- */

test("a vendor's date is the day the vendor said, west of Greenwich as much as east", () => {
  // `new Date("2026-09-20")` is UTC midnight, which is the nineteenth in every American zone. That is the bug
  // that made "tomorrow" mean the day after tomorrow after eight in the evening.
  const d = dateFromKey("2026-09-20");
  assert.ok(d);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 20);
  assert.match(whenLine({ date: "2026-09-20", time: "19:30" }, new Date(2026, 8, 1)), /Sun, Sep 20 at 7:30 PM/);
});

test("a date a month does not have is not a date", () => {
  assert.equal(dateFromKey("2026-02-31"), null);
  assert.equal(dateFromKey("2026-13-01"), null);
  assert.equal(dateFromKey(""), null);
  assert.equal(dateFromKey("tomorrow"), null);
});

test("a departure whose date we cannot read still says what it says, rather than Invalid Date", () => {
  assert.equal(whenLine({ date: "whenever", time: "" }), "whenever");
});

/* ---------- the price ---------- */

const DEP = (over: Partial<ConciergeDeparture> = {}): ConciergeDeparture => ({
  item: "Heli Tour #1", date: "2026-09-20", time: "12:00", fromPrice: 99.51, priceLabel: "Adult",
  taxIncluded: false, rates: [], bookUrl: "https://example.com", seatsLeft: null, ...over,
});

test("a FareHarbor price is never quoted as the price, because their checkout adds tax to it", () => {
  // Their API says $99.51 where the real checkout shows $114.30, and says so: include_taxes is false.
  assert.equal(priceLine(DEP()), "$99.51 + tax");
  assert.equal(priceLine(DEP({ taxIncluded: true })), "$99.51");
  assert.equal(priceLine(DEP({ fromPrice: null })), "Price on request");
});

test("a whole-room price is never said a head", () => {
  // "$32 to $250 a head" reached the screen for Kitchener escape rooms this way: the room was $250.
  assert.equal(serviceLine({ name: "The Vault", price: 250, unit: null, per: "group" }), "$250 for the room");
  assert.equal(serviceLine({ name: "Escape room", price: 28, unit: null, per: "person" }), "$28 per person");
  assert.equal(serviceLine({ name: "Axe lane", price: 19.99, unit: "hr", per: "person" }), "$19.99 / hr");
  assert.equal(serviceLine({ name: "Unknown", price: null, unit: null, per: "person" }), null);
});

test("the comparison only speaks when there is something to compare", () => {
  assert.equal(compareLine(null), null);
  assert.equal(compareLine({ cheapest: 20, dearest: 25, count: 1 }), null);
  assert.equal(compareLine({ cheapest: 19.99, dearest: 25, count: 3 }), "Across 3 places nearby: $19.99 to $25 a head.");
  // One price across three shops is a finding too, and reads wrong as "$25 to $25".
  assert.equal(compareLine({ cheapest: 25, dearest: 25, count: 3 }), "All 3 places nearby charge about $25 a head.");
});

/* ---------- what the site already knows ---------- */

test("the guest is not asked where they are when the site already knows", () => {
  assert.equal(withPlace("escape room tonight, 4 of us", "Kitchener, ON"), "escape room tonight, 4 of us near Kitchener, ON");
});

test("a place the guest named beats the place they are sitting in", () => {
  // Asking about Waterloo from a sofa in Toronto means Waterloo.
  assert.equal(withPlace("escape room in waterloo tonight", "Toronto, ON"), "escape room in waterloo tonight");
  assert.equal(withPlace("jet ski near tampa", "Toronto, ON"), "jet ski near tampa");
  assert.equal(withPlace("skydiving around perris", "Toronto, ON"), "skydiving around perris");
});

test("nothing is appended when the site does not know either", () => {
  assert.equal(withPlace("axe throwing", null), "axe throwing");
  assert.equal(withPlace("axe throwing", ""), "axe throwing");
  assert.equal(withPlace("  ", "Kitchener, ON"), "");
});

/* ---------- the order things are shown in ---------- */

const OPT = (name: string, deps: number, price: number | null = null): ConciergeOption => ({
  name, domain: name.toLowerCase().replace(/ /g, "") + ".com", city: "Kitchener", region: "ON", rating: null,
  reviews: null, category: "escape", bookingUrl: "https://example.com", route: "feed", phone: null,
  departures: Array.from({ length: deps }, (_, i) => DEP({ item: `${name} #${i + 1}`, time: `${10 + i}:00` })),
  services: price == null ? [] : [{ name: "Room", price, unit: null, per: "person" }],
});

test("four slots show four businesses before they show one business twice", () => {
  const picked = spreadDepartures([OPT("A", 3), OPT("B", 3), OPT("C", 3)], 4);
  assert.deepEqual(picked.map((p) => p.option.name), ["A", "B", "C", "A"]);
});

test("a shop with one departure does not hold up the second round", () => {
  const picked = spreadDepartures([OPT("A", 1), OPT("B", 3)], 4);
  assert.deepEqual(picked.map((p) => p.option.name), ["A", "B", "B", "B"]);
});

test("spreading stops when the departures run out rather than looping", () => {
  assert.equal(spreadDepartures([OPT("A", 1)], 4).length, 1);
  assert.deepEqual(spreadDepartures([], 4), []);
});

test("three times at one dock are one shop, not three listings", () => {
  const shops = groupShops(spreadDepartures([OPT("Beach", 3)], 4));
  assert.equal(shops.length, 1);
  assert.equal(shops[0].option.name, "Beach");
  assert.equal(shops[0].slots.length, 3);
});

test("a second shop stays its own card after grouping", () => {
  const shops = groupShops(spreadDepartures([OPT("A", 3), OPT("B", 3), OPT("C", 3)], 4));
  assert.deepEqual(shops.map((s) => [s.option.name, s.slots.length]), [["A", 2], ["B", 1], ["C", 1]]);
});

test("live times come first, then places we can at least price, then the rest", () => {
  const { quoted, priced, rest } = splitOptions([OPT("Nothing", 0), OPT("Priced", 0, 28), OPT("Live", 2)]);
  assert.deepEqual(quoted.map((o) => o.name), ["Live"]);
  assert.deepEqual(priced.map((o) => o.name), ["Priced"]);
  assert.deepEqual(rest.map((o) => o.name), ["Nothing"]);
});


/* ---------- the hour they asked for ---------- */

test("how far a slot sits from the hour they asked for, said the way the agent says it", () => {
  // Word for word what describeOffset writes into the trace in backend/src/concierge/plan.ts, so the screen
  // and the trace behind it are not two accounts of one fact.
  assert.equal(offsetLine(0), "exactly when you asked");
  assert.equal(offsetLine(-45), "45 min earlier");
  assert.equal(offsetLine(30), "30 min later");
  assert.equal(offsetLine(-90), "1h 30m earlier");
  assert.equal(offsetLine(60), "1 hour later");
  assert.equal(offsetLine(-120), "2 hours earlier");
});

test("an offset belongs to its own departure, and is absent when no time was asked for", () => {
  const o = { ...OPT("A", 3), offsets: [-90, 0, 45] };
  assert.equal(offsetOf(o, 0), -90);
  assert.equal(offsetOf(o, 1), 0);
  assert.equal(offsetOf(o, 2), 45);
  assert.equal(offsetOf(o, 3), null);
  assert.equal(offsetOf(OPT("A", 3), 0), null);
});

test("spreading keeps each offset married to the departure it describes", () => {
  // `offsets` is parallel to `departures` and the index is the only thing joining them, so lifting a
  // departure out of the middle of one shop's list must carry the right one, not the first.
  const a = { ...OPT("A", 3), offsets: [0, 60, 120] };
  const b = { ...OPT("B", 3), offsets: [-30, -90, -150] };
  const picked = spreadDepartures([a, b], 4);
  assert.deepEqual(picked.map((p) => [p.option.name, p.offset]), [["A", 0], ["B", -30], ["A", 60], ["B", -90]]);
});

const ANSWER = (over: Partial<ConciergeAnswer> = {}): ConciergeAnswer => ({
  session: "s", ms: 10, intent: { categoryLabel: "Escape room", city: "Kitchener", region: "ON", party: 4, when: "tonight" },
  assumptions: [], followUp: null, options: [], counts: { quoted: 0, priced: 0, total: 0 }, ...over,
});

test("a list that all sits an hour off is not introduced as what they asked for", () => {
  const off = { ...OPT("A", 2), offsets: [-90, 120] };
  const answer = ANSWER({ intent: { categoryLabel: null, city: null, region: null, party: 2, when: "any", atMinute: 990 } });
  assert.equal(missedTheHour(answer, spreadDepartures([off], 4)), true);
});

test("one slot on the hour is enough for the plain opening line", () => {
  const on = { ...OPT("A", 2), offsets: [-90, 0] };
  const answer = ANSWER({ intent: { categoryLabel: null, city: null, region: null, party: 2, when: "any", atMinute: 990 } });
  assert.equal(missedTheHour(answer, spreadDepartures([on], 4)), false);
});

test("a guest who named no hour is never told they missed it", () => {
  const off = { ...OPT("A", 2), offsets: [-90, 120] };
  assert.equal(missedTheHour(ANSWER(), spreadDepartures([off], 4)), false);
  assert.equal(missedTheHour(ANSWER({ intent: null }), spreadDepartures([off], 4)), false);
  // Nothing on offer is not a missed hour either, it is a different answer entirely.
  assert.equal(missedTheHour(ANSWER({ intent: { categoryLabel: null, city: null, region: null, party: 2, when: "any", atMinute: 990 } }), []), false);
});


test("a departure the vendor would not price falls back to what the shop publishes, per head only", () => {
  // The screen said "Across 4 places nearby: $79 to $250 a head" over four cards reading "Price on request",
  // because `compare` falls back to these menu figures and the cards did not.
  const o = OPT("A", 1);
  assert.equal(menuPrice(o), null);
  assert.equal(menuPrice({ ...o, services: [{ name: "Tour", price: 79, unit: null, per: "person" }] }), 79);
  // The cheapest way in, the way every other "from" figure on the site is picked.
  assert.equal(menuPrice({ ...o, services: [
    { name: "Deluxe", price: 250, unit: null, per: "person" },
    { name: "Standard", price: 79, unit: null, per: "person" },
  ] }), 79);
  // A whole-room price is not a way in for one person, so it is never the fallback.
  assert.equal(menuPrice({ ...o, services: [{ name: "Private charter", price: 900, unit: null, per: "group" }] }), null);
});


/* ---------- "near me" is not a place name ---------- */

test("near me means the place the site already knows, not a town called me", () => {
  // This was the whole bug. The check for "did they name somewhere" looks for a preposition and a word, and
  // "near me" is exactly that, so a guest who wrote "...between 5-7pm near me" was taken to have named a town.
  // Their real city was never attached, the agent could not place "me", and it came back asking where they
  // were over a list of New York, Toronto and Los Angeles.
  assert.equal(
    withPlace("help me plan a team offsite with a $500 budget and 10 people for monday between 5-7pm near me", "Kitchener, ON"),
    "help me plan a team offsite with a $500 budget and 10 people for monday between 5-7pm near Kitchener, ON",
  );
});

test("every ordinary way of saying where I am", () => {
  for (const said of ["escape room near me", "escape room around here", "escape room nearby", "escape room close by", "escape room in my area", "escape room at my location"]) {
    assert.equal(withPlace(said, "Waterloo, ON"), "escape room near Waterloo, ON", said);
  }
});

test("a town the guest named still beats the one they are sitting in", () => {
  assert.equal(withPlace("escape room in waterloo near me", "Toronto, ON"), "escape room in waterloo");
  assert.equal(withPlace("axe throwing near kitchener", "Toronto, ON"), "axe throwing near kitchener");
});

test("an hour is not a place, and neither is a day", () => {
  // The check was a preposition and any letter, so "in the evening" read as a town and the guest's own city
  // was never attached. They got asked where they were instead of an answer.
  for (const said of [
    "escape room in the evening",
    "something fun in the morning",
    "axe throwing tonight at seven",
    "jet ski rental around noon",
    "karting at half past six",
    "escape room by myself",
    "boat tour at sunset",
    "escape room on monday at eight",
    "paintball in july",
    "something to do at home",
  ]) {
    assert.equal(withPlace(said, "Toronto, ON"), said + " near Toronto, ON", said);
  }
});

test("a town still counts when an hour is said first", () => {
  // The rule reads every preposition in the sentence, not just the first one it finds.
  assert.equal(withPlace("escape room in the evening in waterloo", "Toronto, ON"), "escape room in the evening in waterloo");
  assert.equal(withPlace("axe throwing at seven near kitchener", "Toronto, ON"), "axe throwing at seven near kitchener");
});

test("help me is not a place, and nor is anything else that merely contains the word", () => {
  // The self-reference has to follow a preposition, or "help me plan" loses its verb.
  assert.equal(withPlace("help me find something fun", "Toronto, ON"), "help me find something fun near Toronto, ON");
  assert.equal(withPlace("something for me and my dad", "Toronto, ON"), "something for me and my dad near Toronto, ON");
});

/* ---------- the one line a helpful person opens with ---------- */

test("a shortlist with no live times is one sentence, not three paragraphs", () => {
  const answer = ANSWER({
    intent: { categoryLabel: "Axe throwing", city: "Waterloo", region: "ON", party: 2, when: "any" },
    compare: { cheapest: 19.99, dearest: 25, count: 3 },
    counts: { quoted: 0, priced: 3, total: 3 },
    options: [OPT("A", 0, 19.99), OPT("B", 0, 21.99), OPT("C", 0, 25)],
  });
  assert.equal(headline(answer, []), "3 axe throwing places near Waterloo.");
});

test("one place is one place, not 1 places", () => {
  const answer = ANSWER({
    intent: { categoryLabel: "Escape room", city: "Guelph", region: "ON", party: 2, when: "any" },
    compare: { cheapest: 32, dearest: 32, count: 1 },
    counts: { quoted: 0, priced: 1, total: 1 },
    options: [OPT("A", 0, 32)],
  });
  assert.equal(headline(answer, []), "1 escape room place near Guelph.");
});

test("live times lead with the times, the shop and the price", () => {
  const live = { ...OPT("Escapology Waterloo", 2), offsets: [-25, 45] };
  const answer = ANSWER({ counts: { quoted: 1, priced: 0, total: 1 }, options: [live] });
  const shown = spreadDepartures([live], 4);
  assert.equal(headline(answer, shown), "2 times at Escapology Waterloo, from $99.51 + tax.");
});

test("a slot on the hour is not announced separately from the time on the row", () => {
  const live = { ...OPT("Escapology Waterloo", 2), offsets: [0, 45] };
  assert.equal(headline(ANSWER({ options: [live] }), spreadDepartures([live], 4)), "2 times at Escapology Waterloo, from $99.51 + tax.");
});

test("times at more than one shop are counted by shop, not by card", () => {
  const a = OPT("A", 2);
  const b = OPT("B", 2);
  assert.match(headline(ANSWER({ options: [a, b] }), spreadDepartures([a, b], 4)), /^4 times across 2 places,/);
});

/* ---------- telling the truth about why there is no time ---------- */

test("a shop with its own booking page is never described as publishing no times", () => {
  // Bad Axe Throwing, Lumberjacks and Riot Axe all publish their times, on their own hand-built pages. Saying
  // they do not, and telling a guest to phone them, is the product calling its own gap their absence.
  const agents = [{ ...OPT("Bad Axe", 0, 19.99), route: "agent" as const }, { ...OPT("Riot Axe", 0, 25), route: "agent" as const }];
  const line = noTimesLine(agents);
  assert.match(line, /No live times/);
  assert.ok(!/phone|call/i.test(line), line);
});

test("a shop with no booking system at all is the one that is a phone call", () => {
  const phones = [{ ...OPT("A", 0, 20), route: "phone" as const }];
  assert.match(noTimesLine(phones), /by phone/);
});

test("a mix says both, rather than picking one and being wrong about the other", () => {
  const mixed = [{ ...OPT("A", 0, 20), route: "phone" as const }, { ...OPT("B", 0, 25), route: "agent" as const }];
  const line = noTimesLine(mixed);
  assert.match(line, /No live times/);
  assert.match(line, /phone/);
});

/* ---------- what a person says next ---------- */

test("a shortlist offers the things a person would say back to it", () => {
  const live = { ...OPT("A", 2), offsets: [-25, 45] };
  const labels = refinements(ANSWER({ options: [live], compare: { cheapest: 32, dearest: 37, count: 2 } }), spreadDepartures([live], 4)).map((r) => r.label);
  assert.deepEqual(labels, ["Something else", "Cheaper", "Earlier", "Later", "Check again"]);
});

test("nothing to compare means no Cheaper button, and no times means no Earlier", () => {
  const labels = refinements(ANSWER({ options: [OPT("A", 0, 20)] }), []).map((r) => r.label);
  assert.deepEqual(labels, ["Something else", "Check again"]);
});

test("a question back is not a shortlist, so it carries no refinements", () => {
  const asking = ANSWER({ followUp: { question: "Where are you?", choices: [], why: "place" }, options: [OPT("A", 1)] });
  assert.deepEqual(refinements(asking, []), []);
  assert.deepEqual(refinements(ANSWER(), []), []);
});


/* ---------- narrowing is an offer, not a gate ---------- */

test("an offer to narrow stands down the generic Something else, which it already says better", () => {
  const live = { ...OPT("A", 2), offsets: [-25, 45] };
  const answer = ANSWER({
    options: [live],
    compare: { cheapest: 32, dearest: 37, count: 2 },
    narrow: { question: "Want me to narrow it?", why: "genre", choices: [{ label: "Something active", text: "something active" }] },
  });
  const labels = refinements(answer, spreadDepartures([live], 4)).map((r) => r.label);
  assert.ok(!labels.includes("Something else"), JSON.stringify(labels));
  // The standing actions are still there; it is only the vaguest of them that steps aside.
  assert.deepEqual(labels, ["Cheaper", "Earlier", "Later", "Check again"]);
});

test("with nothing to narrow by, the generic push-back stays", () => {
  const live = { ...OPT("A", 2), offsets: [-25, 45] };
  const shown = spreadDepartures([live], 4);
  assert.ok(refinements(ANSWER({ options: [live] }), shown).some((r) => r.label === "Something else"));
  // An empty choice list is not an offer.
  assert.ok(refinements(ANSWER({ options: [live], narrow: { question: "?", why: "genre", choices: [] } }), shown).some((r) => r.label === "Something else"));
});

test("the reading of the sentence is shown back while it is still narrowing", () => {
  const answer = ANSWER({
    intent: { categoryLabel: null, city: "Toronto", region: "ON", party: 10, when: "any", maxTotal: 500, atMinute: 1020 },
    assumptions: [],
  });
  assert.equal(understood(answer), "10 people · $500 for the group · around 5:00 PM · near Toronto");
});

test("an assumed party is never repeated back as though they said it", () => {
  // "two of you" is what the agent guessed, and reading a guess back as a fact is the guess dressed up.
  const answer = ANSWER({ intent: { categoryLabel: "Escape room", city: "Kitchener", region: "ON", party: 2, when: "any" }, assumptions: ["two of you"] });
  assert.equal(understood(answer), "escape room · near Kitchener");
});

test("a budget a head and a budget for the group are not the same sentence", () => {
  const group = ANSWER({ intent: { categoryLabel: null, city: "Toronto", region: "ON", party: 10, when: "any", maxTotal: 500 } });
  assert.match(understood(group), /\$500 for the group/);
  const head = ANSWER({ intent: { categoryLabel: null, city: "Toronto", region: "ON", party: 10, when: "any", maxPerPerson: 30 } });
  assert.match(understood(head), /up to \$30 a head/);
});


test("a menu price is never set beside a live one without saying which is which", () => {
  // "Nothing with live times comes in under $50 a head" sat directly above "$20 to $39.99 a head". Both true,
  // one about departures and one about menus, and read in order they contradict each other outright.
  const answer = ANSWER({
    intent: { categoryLabel: "Sunset sail", city: "Toronto", region: "ON", party: 20, when: "any" },
    loosened: "Nothing with live times comes in under $50 a head. The cheapest I can actually quote is $90.10.",
    compare: { cheapest: 20, dearest: 39.99, count: 2 },
    counts: { quoted: 0, priced: 2, total: 5 },
    options: [OPT("A", 0, 20), OPT("B", 0, 39.99)],
  });
  assert.equal(headline(answer, []), "5 sunset sail places near Toronto.");
});

test("a live quote says nothing about their own sites, because it did not come from one", () => {
  const live = { ...OPT("A", 2), offsets: [0, 45] };
  assert.ok(!/from their own sites/.test(headline(ANSWER({ options: [live] }), spreadDepartures([live], 4))));
});


test("a business with neither a time nor a price is still a business, not a blank screen", () => {
  // The budget filter started dropping over-cap prices, which emptied `priced` and left a headline, a budget
  // line, and no businesses at all under either of them, while counts.total said five.
  const bare = [OPT("A", 0), OPT("B", 0), OPT("C", 0)];
  const { quoted, priced, rest } = splitOptions(bare);
  assert.equal(quoted.length, 0);
  assert.equal(priced.length, 0);
  assert.deepEqual(rest.map((o) => o.name), ["A", "B", "C"]);
});


/* ---------- a price the reader cannot buy is not a price ---------- */

test("a child fare never becomes the shop's headline price", () => {
  // The crawl returns menu rows in the shop's own page order, so a site listing "Child $15" above
  // "Adult $30" put $15 on the card. Same defect as the infant fare on a live departure, one layer down.
  const o = { ...OPT("A", 0), services: [
    { name: "Child admission", price: 15, unit: null, per: "person" as const },
    { name: "Adult admission", price: 30, unit: null, per: "person" as const },
  ] };
  assert.equal(menuPrice(o), 30);
  assert.equal(headlineService(o)?.name, "Adult admission");
});

test("when every fare is a concession the cheapest still stands, because a price beats no price", () => {
  const o = { ...OPT("A", 0), services: [
    { name: "Student", price: 22, unit: null, per: "person" as const },
    { name: "Senior", price: 25, unit: null, per: "person" as const },
  ] };
  assert.equal(menuPrice(o), 22);
});

test("group, private and member fares are ones a guest can buy, so they are not excluded", () => {
  // Excluding them would push the headline price up, which is its own kind of lie.
  const o = { ...OPT("A", 0), services: [
    { name: "Member rate", price: 18, unit: null, per: "person" as const },
    { name: "Walk-in", price: 26, unit: null, per: "person" as const },
  ] };
  assert.equal(menuPrice(o), 18);
});

test("a word that merely contains an age word is not a concession", () => {
  // "Skidoo" contains "kid", "Seniority" contains "senior", "Kidney" contains "kid".
  const o = { ...OPT("A", 0), services: [
    { name: "Skidoo tour", price: 60, unit: null, per: "person" as const },
    { name: "Adult", price: 90, unit: null, per: "person" as const },
  ] };
  assert.equal(menuPrice(o), 60);
});

test("a whole-room row is only the headline when the shop sells nothing per head", () => {
  const roomOnly = { ...OPT("A", 0), services: [{ name: "Private room", price: 250, unit: null, per: "group" as const }] };
  assert.equal(headlineService(roomOnly)?.name, "Private room");
  // With a per-head row on the same menu, that is the one a single guest is quoted.
  const both = { ...OPT("A", 0), services: [
    { name: "Private room", price: 250, unit: null, per: "group" as const },
    { name: "Per player", price: 32, unit: null, per: "person" as const },
  ] };
  assert.equal(headlineService(both)?.name, "Per player");
  // A room price is still never counted as a per-head figure.
  assert.equal(menuPrice(roomOnly), null);
});


/* ---------- a long wait has to say what it is waiting on ---------- */

test("a step that already carries a sentence is shown as written, not wrapped in ours", () => {
  // Wrapping produced "Toronto Heli Tours: first read, giving it longer has not been read in a while, so this
  // one takes longer": the same fact said twice by two authors.
  assert.equal(stepLine({ ms: 900, kind: "cold", text: "Toronto Heli Tours: first read, giving it longer" }),
    "Toronto Heli Tours: first read, giving it longer");
  assert.equal(stepLine({ ms: 2400, kind: "answer", text: "Escapology Waterloo: 18 times, from $37.00 + tax" }),
    "Escapology Waterloo: 18 times, from $37.00 + tax");
  assert.equal(stepLine({ ms: 100, kind: "catalog", text: "searching 40 km around Toronto" }), "Searching 40 km around Toronto");
});

test("only the step that is a bare business name gets a verb put in front of it", () => {
  assert.equal(stepLine({ ms: 600, kind: "ask", text: "Parasail Toronto" }), "Reading Parasail Toronto's booking system");
  // A name already ending in s takes the apostrophe alone: nobody writes "Toronto Heli Tours's".
  assert.equal(stepLine({ ms: 600, kind: "ask", text: "Toronto Heli Tours" }), "Reading Toronto Heli Tours' booking system");
  // If that step ever starts carrying a sentence too, it is shown as written rather than mangled.
  assert.equal(stepLine({ ms: 600, kind: "ask", text: "Parasail Toronto: reading their calendar" }), "Parasail Toronto: reading their calendar");
});

test("steps that take no time are not narrated, because naming them is noise", () => {
  for (const kind of ["read", "assume", "clock", "skip", "compare", "queue", "budget", "carry", "question"]) {
    assert.equal(stepLine({ ms: 5, kind, text: "whatever" }), null, kind);
  }
  assert.equal(stepLine({ ms: 5, kind: "ask", text: "" }), null);
});

test("a status too long for a phone is cut rather than wrapped three lines deep", () => {
  const long = stepLine({ ms: 10, kind: "answer", text: "Niagara Falls Tours Toronto Zoom Tours: 24 times, from price on request, all of them" });
  assert.ok(long && long.length <= 76, String(long?.length));
  assert.match(long!, /\u2026$/);
});

test("a clock time from a vendor page is the HH:MM the booking API takes", () => {
  assert.equal(slotOf("12:00"), "12:00");
  assert.equal(slotOf("7:00 PM"), "19:00");
  assert.equal(slotOf("12:00 am"), "00:00");
  assert.equal(slotOf("nope"), null);
});

test("a live shop we do not hold still becomes a listing Ask can book", () => {
  const id = listingForOption({
    name: "Sealy's Karate",
    domain: "sealyskarate.example",
    city: "Waterloo",
    region: "ON",
    rating: null,
    reviews: null,
    category: "martialarts",
    bookingUrl: "",
    departures: [],
    route: "feed",
    phone: null,
    services: [{ name: "Drop-in", price: 20, unit: "class", per: "person" }],
  });
  assert.equal(id, "cg-sealyskarateexamplewaterloo");
  const u = experienceById(id);
  assert.equal(u?.title, "Sealy's Karate");
  assert.equal(u?.metroId, "waterloo");
  assert.equal(u?.options[0]?.name, "Drop-in");
  assert.equal(listingForOption({
    name: "Sealy's Karate",
    domain: "sealyskarate.example",
    city: "Waterloo",
    region: "ON",
    rating: null,
    reviews: null,
    category: "martialarts",
    bookingUrl: "",
    departures: [],
    route: "feed",
    phone: null,
    services: [],
  }), id);
});

test("a chain in Waterloo is not booked as the Tampa shop that shares the domain", () => {
  assert.equal(listingIdFor({ domain: "escapology.com", city: "Waterloo", name: "Escapology Waterloo" }), null);
  const id = listingForOption({
    name: "Escapology Waterloo",
    domain: "escapology.com",
    city: "Waterloo",
    region: "ON",
    rating: null,
    reviews: null,
    category: "escape",
    bookingUrl: "",
    departures: [],
    route: "feed",
    phone: null,
    services: [],
  });
  assert.notEqual(id, "u-escgy");
  assert.equal(experienceById(id)?.area, "Waterloo, ON");
});

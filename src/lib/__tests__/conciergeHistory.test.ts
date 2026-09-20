import assert from "node:assert/strict";
import test from "node:test";
import { titleOf, transcript, turnText, whenLabel, type Conversation, type Turn } from "../conciergeHistory";
import type { ConciergeAnswer, ConciergeDeparture, ConciergeOption } from "../concierge";

/**
 * A conversation has to come back out as text.
 *
 * The reason history exists is not that a thread is nice to scroll. It is that the way this gets better is
 * somebody reading a wrong answer, copying the whole exchange, and pasting it at whoever can fix it. So every
 * number that reached the screen has to reach the clipboard, and the two have to agree.
 */

const DEP = (over: Partial<ConciergeDeparture> = {}): ConciergeDeparture => ({
  item: "Batman: The Dark Knight Challenge", date: "2026-09-20", time: "17:35", fromPrice: 37, priceLabel: "Players",
  taxIncluded: false, rates: [], bookUrl: "https://example.com", seatsLeft: 6, ...over,
});

const OPT = (over: Partial<ConciergeOption> = {}): ConciergeOption => ({
  name: "Escapology Waterloo", domain: "escapology.com", city: "Waterloo", region: "ON", rating: null, reviews: null,
  category: "escape", bookingUrl: "https://example.com", route: "feed", phone: null, via: "their Resova calendar",
  departures: [DEP()], offsets: [-25], services: [], ...over,
});

const ANSWER = (over: Partial<ConciergeAnswer> = {}): ConciergeAnswer => ({
  session: "abc123", ms: 2462,
  intent: { categoryLabel: "Escape room", city: "Waterloo", region: "ON", party: 4, when: "any", atMinute: 1080 },
  assumptions: [], followUp: null, options: [OPT()], counts: { quoted: 1, priced: 0, total: 5 }, ...over,
});

const TURN = (over: Partial<Turn> = {}): Turn => ({
  q: "escape room in waterloo ontario at 6pm, 4 of us", at: Date.UTC(2026, 8, 20, 10, 42), ms: 2462, answer: ANSWER(), ...over,
});

test("a copied answer carries every number that was on the screen", () => {
  const text = turnText(TURN());
  assert.match(text, /^> escape room in waterloo ontario at 6pm, 4 of us$/m);
  assert.match(text, /read: Escape room · Waterloo · 4 people · 18:00/);
  assert.match(text, /Escapology Waterloo - Batman: The Dark Knight Challenge/);
  // The time, how far off it is, the pre-tax price, the seats and whose calendar it came from.
  assert.match(text, /\(25 min earlier\)/);
  assert.match(text, /\$37 \+ tax/);
  assert.match(text, /6 seats left/);
  assert.match(text, /their Resova calendar/);
  assert.match(text, /1 with live times, 0 priced, 5 found · 2462ms/);
});

test("a question back is quoted with the choices it offered", () => {
  const text = turnText(TURN({ answer: ANSWER({ followUp: { question: "Where are you?", why: "place", choices: [{ label: "Toronto, ON", text: "toronto" }] } }) }));
  assert.match(text, /asked back: Where are you\?\s+\[Toronto, ON\]/);
});

test("a budget nothing met is in the transcript, because that is the complaint", () => {
  const text = turnText(TURN({ answer: ANSWER({ loosened: "Nothing with live times comes in under $50 a head. The cheapest I can actually quote is $90.10." }) }));
  assert.match(text, /! Nothing with live times comes in under \$50 a head/);
});

test("a failure is kept too, because it said it could not reach the shops is a bug report", () => {
  const text = turnText(TURN({ answer: null, error: "I could not reach the shops just now." }));
  assert.match(text, /I could not reach the shops just now\./);
});

test("a sentence the app supplied is not put in the guest's mouth", () => {
  // The app answers "where are you?" from what it already knows. A transcript that shows the guest typing
  // "Toronto, ON" is a record of something that never happened.
  assert.match(turnText(TURN({ q: "Toronto, ON", auto: true })), /^> \(app answered\) Toronto, ON$/m);
});

test("a shop priced off its own site says so, and says which route it took", () => {
  const priced = OPT({ name: "Bad Axe Throwing", departures: [], offsets: undefined, via: undefined, route: "agent", city: "Kitchener", services: [{ name: "Walk-in", price: 19.99, unit: null, per: "person" }] });
  const text = turnText(TURN({ answer: ANSWER({ options: [priced], counts: { quoted: 0, priced: 1, total: 3 } }) }));
  assert.match(text, /Bad Axe Throwing · Kitchener - \$19\.99 per person · route agent/);
});

test("the price copied out is the one the card printed, not the child fare above it", () => {
  // The crawl returns a shop's menu in its own page order, and `headlineService` exists because a site that
  // lists "Child (under 12) $15" above "Adult $30" put $15 on the card. The transcript took the first priced
  // row, so it quoted $15 for a screen that said $30: a wrong answer reported with the wrong number on it.
  const kid = OPT({
    name: "Riot Axe", domain: "riotaxe.com", departures: [], offsets: undefined, via: undefined, route: "agent",
    services: [
      { name: "Child (under 12)", price: 15, unit: null, per: "person" },
      { name: "Adult", price: 30, unit: null, per: "person" },
    ],
  });
  const text = turnText(TURN({ answer: ANSWER({ options: [kid], counts: { quoted: 0, priced: 1, total: 1 } }) }));
  assert.match(text, /Riot Axe · Waterloo - \$30 per person/);
  assert.doesNotMatch(text, /\$15/);
});

test("the shops shown under a live time as also nearby are in the transcript too", () => {
  // The screen lists up to three priced shops under "Also nearby, priced but without a time I can read". The
  // transcript listed none of them the moment anything had a live time, so it dropped businesses the guest
  // was looking at while claiming to be what was on the screen.
  const live = OPT({ name: "Bad Axe", domain: "badaxe.com" });
  const also = OPT({
    name: "Riot Axe", domain: "riotaxe.com", departures: [], offsets: undefined, via: undefined, route: "agent",
    services: [{ name: "Walk-in", price: 24, unit: null, per: "person" }],
  });
  const text = turnText(TURN({ answer: ANSWER({ options: [live, also], counts: { quoted: 1, priced: 1, total: 2 } }) }));
  assert.match(text, /Bad Axe/);
  assert.match(text, /Riot Axe · Waterloo - \$24 per person · route agent/);
});

test("a shop with nothing published is still listed, not silently dropped", () => {
  const bare = OPT({ name: "Gray Line Toronto", departures: [], offsets: undefined, via: undefined, route: "phone", city: "Toronto", services: [] });
  const text = turnText(TURN({ answer: ANSWER({ options: [bare], counts: { quoted: 0, priced: 0, total: 1 } }) }));
  assert.match(text, /Gray Line Toronto · Toronto - nothing published · route phone/);
});

const CONVO = (turns: Turn[]): Conversation => ({ id: "abc123", startedAt: turns[0].at, lastAt: turns[turns.length - 1].at, turns });

test("a whole conversation carries its session id, so it can be matched to the agent's own trace", () => {
  const text = transcript(CONVO([TURN(), TURN({ q: "anything cheaper" })]));
  assert.match(text, /^Outset concierge · .* · session abc123$/m);
  assert.equal(text.match(/^> /gm)?.length, 2);
});

test("a conversation is named by the first thing actually asked, not by what the app filled in", () => {
  assert.equal(titleOf(CONVO([TURN({ q: "Toronto, ON", auto: true }), TURN()])), "escape room in waterloo ontario at 6pm, 4 of us");
  // Every turn auto is not a real case, but it must not produce an empty name in the list.
  assert.equal(titleOf(CONVO([TURN({ q: "Toronto, ON", auto: true })])), "Toronto, ON");
});

test("the time on a row is short enough for a narrow list, and says enough to tell two apart", () => {
  const now = new Date(2026, 8, 20, 14, 0);
  assert.match(whenLabel(new Date(2026, 8, 20, 6, 42).getTime(), now), /^6:42\s?AM$/);
  // Earlier in the week needs the day; anything older needs the date.
  assert.match(whenLabel(new Date(2026, 8, 18, 6, 42).getTime(), now), /^Fri 6:42\s?AM$/);
  assert.equal(whenLabel(new Date(2026, 7, 2, 6, 42).getTime(), now), "Aug 2");
});

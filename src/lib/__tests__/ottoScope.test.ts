import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { companyReply } from "../companyAgent";
import type { OperatorContact, Unclaimed } from "../../data/types";

/**
 * What Otto refuses, and what it only looked like it should refuse.
 *
 * Rule 4 in `companyAgent.ts` says Otto never confirms a booking and never answers about weather, traffic or
 * other businesses. Two gates enforce it and neither had a test.
 *
 * The out-of-scope gate reads the question for words that belong to somebody else's business. Several of those
 * words are also how a guest asks this shop an ordinary question: "how far in advance do I need to book" is a
 * notice period, "the nearest opening" is the next departure, and "rated" sits inside "operated". Those guests
 * were told "I only know what X publishes, so I can't help with that".
 *
 * The other gate is intent order. `book` fired on any question carrying the word "booking", and it was read
 * before `cancel`, so a guest trying to cancel was answered "Yes. Pick a service and time on this page", with
 * the shop's own published refund policy sitting right there unread. The same "Yes." answered "is my booking
 * confirmed?", which is the one thing Otto must never say.
 *
 * `o-1000islandscruises-ca` is a real shipped listing: it publishes a refund policy, hours and a phone.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const cruises = listing("o-1000islandscruises-ca");
const ask = (q: string, item: Unclaimed = cruises, contact: OperatorContact | null = null) =>
  companyReply({ item, contact }, q);

const REFUSAL = /so I can't help with that/;

/* ---------- the gate must still hold ---------- */

test("Otto still refuses another business, a forecast, a review and a drive", () => {
  for (const q of [
    "how far is it from downtown?",
    "what are your reviews like?",
    "how is it rated?",
    "how many stars on Yelp?",
    "are you better than the other operator?",
    "who owns it?",
    "what's the traffic like?",
    "how do I get there from the airport?",
    "have you had any accidents?",
  ]) {
    assert.match(ask(q), REFUSAL, q);
  }
  // The forecast has a refusal of its own, which is still a refusal.
  assert.match(ask("what's the weather tomorrow?"), /I can't check the forecast/);
});

/* ---------- what the gate was catching by accident ---------- */

test("a notice period is not a distance, however the guest phrases it", () => {
  // "how far" was reading as a distance question, so the commonest booking question there is got a refusal.
  for (const q of ["how far in advance do I need to book?", "how far ahead should I book?"]) {
    const said = ask(q);
    assert.doesNotMatch(said, REFUSAL, q);
  }
  // The plain phrasing always worked, and the two now answer alike.
  assert.equal(ask("how far in advance do I need to book?"), ask("do I need to book in advance?"));
});

test("the nearest opening is the next departure, not a nearby business", () => {
  for (const q of ["when is the nearest available slot?", "what's the nearest opening?"]) {
    assert.doesNotMatch(ask(q), REFUSAL, q);
  }
  assert.equal(ask("when is the nearest available slot?"), ask("when is the next available slot?"));
  // A question that really is about somewhere else keeps its refusal.
  assert.match(ask("is there a hotel nearby?"), REFUSAL);
});

test("a rating word inside an ordinary word is not a rating question", () => {
  // "rated" had no word boundaries, so it matched inside "operated", "decorated" and "celebrated".
  assert.doesNotMatch(ask("is the boat operated by a captain?"), REFUSAL);
  assert.doesNotMatch(ask("can I sign up for your newsletter?"), REFUSAL);
  assert.match(ask("how is it rated?"), REFUSAL);
  assert.match(ask("what are your ratings?"), REFUSAL);
});

test("the two scope gates exempt the same topics, so a pet question survives both", () => {
  // `readQuestion` exempted rainPolicy, meet and pets; `companyAnswer` re-ran the gate exempting only the first
  // two, so a pet question carrying a place word was exempted and then refused anyway.
  const said = ask("can I bring a dog on the tour, how far is it?");
  assert.doesNotMatch(said, REFUSAL);
  assert.match(said, /pet policy/i);
});

/* ---------- a booking the guest already has ---------- */

test("a guest cancelling is read the shop's refund policy, not offered the booking flow", () => {
  const policy = /Ticket Assurance refundable up to 3 hours/;
  assert.match(cruises.cancellation!, policy, "the listing changed, so this case needs a new one");
  for (const q of [
    "cancel my booking please",
    "how do I cancel my booking?",
    "I need to cancel my reservation",
    "can I get a refund on my booking?",
    "can I reschedule my booking?",
  ]) {
    const said = ask(q);
    assert.match(said, policy, q);
    assert.doesNotMatch(said, /^Yes\./, q);
  }
  // A shop with no published policy says so rather than pointing at the booking flow.
  assert.match(ask("cancel my booking please", listing("o-033b649-netsolhost-com")), /haven't published a cancellation policy/);
});

test("Otto never says a booking it cannot see is confirmed", () => {
  for (const q of ["is my booking confirmed?", "did my reservation go through?", "where's my booking?", "can you check my reservation?"]) {
    const said = ask(q);
    assert.doesNotMatch(said, /^Yes\./, q);
    assert.match(said, /can't look up a booking you already have/, q);
    assert.match(said, /Kingston 1000 Islands Cruises can check it/, q);
  }
  // With a number on file it hands the guest the shop instead.
  const said = ask("is my booking confirmed?", cruises, { phone: "+16135495544" } as OperatorContact);
  assert.match(said, /Call /);
});

test("making a booking still reads as making one", () => {
  for (const q of ["can I book online?", "how do I book?", "do you take walk-ins?"]) {
    assert.doesNotMatch(ask(q), /can't look up a booking/, q);
  }
  assert.match(ask("can I book online?"), /^Yes\./);
});

test("Otto can start a booking but never takes a card", () => {
  const said = ask("can you book it for me?");
  assert.match(said, /I can start it/);
  assert.match(said, /never see the card/);
  assert.match(said, /Stripe/);
  assert.doesNotMatch(said, /^Yes\./);
  assert.doesNotMatch(said, /confirmed/i);
});

test("an entry rule is still an entry rule unless the guest is cancelling", () => {
  // The `rules` reader matches "need to", which "I need to cancel my reservation" also says.
  for (const q of ["do I need to swim?", "do I need a licence?", "must I be 18?", "do I need experience?"]) {
    assert.doesNotMatch(ask(q), /cancellation|refund/i, q);
  }
});

/* ---------- somebody else's place, asked as "where" ---------- */

test("a question about somebody else's place is not answered with this shop's address", () => {
  // `meet` outranks the out-of-scope gate so "where do we meet" survives a place word, and the exemption was
  // wide enough that any question starting "where" did too. Kingston publishes a meeting point, so each of
  // these was answered "Meet at dock located at 1 Brock St", which reads as an answer to what was asked.
  assert.match(cruises.meetingPoint!, /1 Brock St/, "the listing changed, so this case needs a new one");
  for (const q of [
    "where's the nearest hotel?",
    "where can I get an uber?",
    "where are the best reviews?",
    "where is the closest hotel to the dock?",
    "where do I find a taxi?",
    "where is it rated highest?",
  ]) {
    assert.match(ask(q), REFUSAL, q);
  }
});

test("where this shop is, and where to park at it, are still answered", () => {
  for (const q of ["where do we meet?", "where are you located?", "what's the address?", "where do we check in?"]) {
    assert.doesNotMatch(ask(q), REFUSAL, q);
  }
  // "Nearest" is an out-of-scope word and their own parking is not somebody else's place.
  assert.doesNotMatch(ask("where's the nearest parking?"), REFUSAL);
  assert.match(ask("where's the nearest parking?"), /[Pp]arking/);
});

test("a shop whose own meeting point is a hotel keeps answering about it", () => {
  // The exemption-breaker is about whose place it is, not about the word, so a pickup at a hotel is still theirs.
  const atHotel = { ...cruises, meetingPoint: "Meet in the lobby of the Marriott Hotel on Ontario St" };
  assert.doesNotMatch(ask("do we meet at the hotel?", atHotel), REFUSAL);
  assert.match(ask("where is the hotel we meet at?", atHotel), /Marriott/);
});

/* ---------- signing up ---------- */

test("signing up for a mailing list is not a booking", () => {
  // "Sign up" was read as `book`, so Otto said "Yes. Pick a service and time on this page" to a newsletter.
  for (const q of ["can I sign up for your newsletter?", "can I sign up for the mailing list?", "how do I sign up for email updates?"]) {
    const said = ask(q);
    assert.doesNotMatch(said, /Pick a service and time/, q);
    assert.doesNotMatch(said, /^Yes\./, q);
  }
  // Signing up for the thing itself is still booking it.
  for (const q of ["how do I sign up?", "can I sign up online?"]) {
    assert.match(ask(q), /^Yes\./, q);
  }
});

/* ---------- a booking the guest already has, without the "my" ---------- */

test("Otto never says a booking is confirmed, whichever word the guest puts in front of it", () => {
  // `asksAboutOwnBooking` needed "my" or "our". Every other determiner fell through to `book`, whose answer
  // opens "Yes.", which is the one answer rule 4 forbids.
  for (const q of ["is the booking confirmed?", "did the reservation go through?", "is that reservation confirmed?", "where is the booking?"]) {
    const said = ask(q);
    assert.doesNotMatch(said, /^Yes\./, q);
    assert.match(said, /can't look up a booking you already have/, q);
  }
  // How booking here works in general is still a question about this page, not about one booking.
  assert.match(ask("are bookings confirmed instantly?"), /^Yes\./);
  assert.doesNotMatch(ask("can I book the sunset cruise?"), /can't look up a booking/);
});

/* ---------- a holiday is not this week ---------- */

test("a holiday is not answered with today's hours", () => {
  // No weekday in the question, so the hours chain fell through to "open right now": a guest asking about
  // Christmas Day was told "Not yet. They open today at 9 AM".
  for (const q of [
    "are you open on Christmas?",
    "are you open on Thanksgiving?",
    "what time do you close on New Year's Eve?",
    "are you open December 25?",
    "are you open on the holidays?",
    "are you open Good Friday?",
  ]) {
    const said = ask(q);
    assert.match(said, /not holiday hours/, q);
    assert.doesNotMatch(said, /today/, q);
  }
  // A weekday, right now, and a plain closing time all still read as themselves.
  assert.match(ask("are you open Sunday?"), /Sunday/);
  assert.match(ask("are you open right now?"), /today at/);
  assert.match(ask("what time do you close?"), /They close at/);
  // A holiday package is a thing they sell, not a question about hours.
  assert.doesNotMatch(ask("do you have holiday packages?"), /holiday hours/);
});

test("a shop that publishes no hours at all says so, rather than naming a week it has not published", () => {
  const noHours = listing("o-aliioceantours-com");
  assert.match(ask("are you open right now?", noHours), /haven't published opening hours/, "the listing changed, so this case needs a new one");
  assert.match(ask("are you open on Christmas?", noHours), /haven't published opening hours/);
});

/* ---------- which sense of a rule word ---------- */

test("reaching a place by boat is not an accessibility note", () => {
  // "accessib" matched "restaurants that are accessible by boat", so a guest asking whether the trip is
  // wheelchair accessible was read a line about where to have dinner.
  const item = listing("o-1000islandexcursions-com");
  assert.ok(item.includes.some((l) => /accessible by boat/i.test(l)), "the listing changed, so this case needs a new one");
  const said = ask("is it wheelchair accessible?", item);
  assert.doesNotMatch(said, /dinner|restaurant/i);
  assert.match(said, /haven't published an accessibility note/);
});

test("asking how old you have to be is an age question, not a generic entry rule", () => {
  // The age reader needed the word "age", "kid" or a number, so "how old do you have to be?" was read as
  // `rules` and answered with whatever the shop's first requirement happened to be. On Ali'i Ocean Tours that
  // was a briefing about swimming with mantas.
  const manta = listing("o-aliioceantours-com");
  for (const q of ["how old do you have to be?", "how old do I need to be?", "how old must my child be?"]) {
    const said = ask(q, manta);
    assert.match(said, /age limit|minimum age|age \d/i, q);
    assert.doesNotMatch(said, /manta/i, q);
  }
  // A shop that publishes one gives the number rather than its first rule and a count of the rest.
  assert.match(ask("how old do you have to be?", listing("o-captainbobsboatrentals-com")), /minimum age is 21/);
  // How old the boat is, is not how old the guest has to be.
  assert.doesNotMatch(ask("how old is the boat?", listing("o-captainbobsboatrentals-com")), /minimum age/);
});

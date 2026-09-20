import { isConcessionFare, openFarePrice } from "../../backend/src/lib/fares";
import { ART_LABEL } from "../data/art";
import type { ArtKind, Unclaimed } from "../data/types";
import { API_URL } from "./api";
import { domainOf, experienceById, getCatalog, rememberOverlay } from "./catalog";
import { dateFromKey } from "./dates";
import { fmtDate, fmtTime, money, plural } from "./format";

/**
 * The concierge, from inside the guest app.
 *
 * The concierge is the answer to the question the catalog cannot answer. The catalog knows who is there; a
 * guest asks "is there a seat at seven tonight, and what will it cost me", and that answer lives inside
 * whatever booking software each shop happens to run. `backend/src/concierge/` reads those systems live and
 * `backend/src/api/concierge.ts` serves the result. Until this file there was no way for the site to ask it:
 * the only surface was `/go`, a page the API renders itself, which meant the strongest thing the product does
 * was reachable from a demo link and not from onoutset.com.
 *
 * This is the whole wire contract in one place, so the app and the page cannot drift apart on what an answer
 * is. The shapes mirror `payload()` in `backend/src/api/concierge.ts`, `Option` and `FollowUp` in
 * `backend/src/concierge/plan.ts`, and `Departure` in `backend/src/concierge/live.ts`. Mirrored by hand rather
 * than imported, the way `pricing.ts` mirrors `backend/src/payments/money.ts`: the app's build compiles `src`
 * alone, and the backend is free to hold things in an answer that no browser is meant to read.
 *
 * Three things the site can do that the standalone page cannot, because the page has no guest and no catalog:
 *
 * 1. It already knows where the guest is, so it answers the "where are you?" question before it is asked.
 * 2. An option is a business we already hold a listing for, so it opens that listing and its booking flow
 *    instead of a confirmation number the page invents.
 * 3. A stream that fails falls back to the plain route rather than telling the guest something broke.
 */

/* ---------- the wire contract ---------- */

/** One ticket on one departure. `taxIncluded` is false for FareHarbor: their checkout adds tax on top. */
export type ConciergeDeparture = {
  item: string;
  /** The shop's own local date and time, "2026-09-20" and "12:00". Never a UTC instant: see `whenLine`. */
  date: string;
  time: string;
  fromPrice: number | null;
  priceLabel: string | null;
  taxIncluded: boolean;
  rates: { label: string; price: number; minParty: number | null; maxParty: number | null }[];
  bookUrl: string;
  seatsLeft: number | null;
};

/**
 * A row off the shop's own menu, read by the crawl. `per` is the field that matters: "group" is the price of
 * the whole room, and printing it beside a head count is how "$32 to $250 a head" reached the screen for
 * Kitchener escape rooms. Nothing here multiplies by party size unless `per` says "person".
 */
export type ConciergeService = { name: string; price: number | null; unit: string | null; per: "person" | "group" };

export type ConciergeOption = {
  name: string;
  domain: string;
  city: string | null;
  region: string | null;
  rating: number | null;
  reviews: number | null;
  category: string;
  bookingUrl: string;
  departures: ConciergeDeparture[];
  route: "feed" | "agent" | "phone";
  phone: string | null;
  /** True when nothing was free when they asked and these times come from a wider search. */
  widened?: boolean;
  /** Where a live time was read from: "their FareHarbor calendar". The claim the whole product rests on. */
  via?: string;
  /**
   * Signed minutes from the clock time the guest asked for, one per entry in `departures` and in the same
   * order. -90 is an hour and a half earlier than they asked. Absent when they named no time.
   */
  offsets?: number[];
  services: ConciergeService[];
};

/**
 * A question back, with its answers ready to tap. A question with no answers attached is a form field: the
 * guest has to work out what shape of reply will be understood. `why` is "place", "activity" or "nothing".
 */
export type ConciergeFollowUp = { question: string; choices: { label: string; text: string }[]; why: string };

/** One line of what the agent is doing, as it happens. `kind` is open ended, so it is typed as a string. */
export type ConciergeStep = { ms: number; kind: string; text: string; detail?: string };

export type ConciergeAnswer = {
  session: string;
  ms: number;
  intent: {
    categoryLabel: string | null;
    city: string | null;
    region: string | null;
    party: number;
    when: string;
    /** The clock time they asked for, in minutes after midnight. 990 is half past four. Null if they only said "tonight". */
    atMinute?: number | null;
    /** "$2,000 for the group" and "under $30 a head" are different numbers, so they are different fields. */
    maxTotal?: number | null;
    maxPerPerson?: number | null;
    cover?: "indoor" | "outdoor" | null;
  } | null;
  assumptions: string[];
  /**
   * The one question it cannot proceed without, which is now only ever "where are you?". Nothing comes back
   * with it: `payload()` returns no options alongside a followUp, because there was nothing to search on.
   */
  followUp: ConciergeFollowUp | null;
  /**
   * An offer to narrow, which arrives WITH the results rather than instead of them.
   *
   * Genre and budget used to be asked as blocking questions, so a guest who wrote out their party, budget, day
   * and place got a four item menu and no businesses. They are the same shape and the same chips, but now they
   * sit under an answer the guest already has, which is the difference between being interrogated and being
   * offered a filter.
   */
  narrow?: ConciergeFollowUp | null;
  loosened?: string | null;
  compare?: { cheapest: number; dearest: number; count: number } | null;
  options: ConciergeOption[];
  counts: { quoted: number; priced: number; total: number };
};

/* ---------- reading the stream ---------- */

export type SseFrame = { event: string; data: string };

/**
 * Server-sent frames out of a buffer that is still filling.
 *
 * A chunk off the socket is whatever fitted in a packet, so it ends wherever it ends: mid frame, mid line,
 * sometimes mid multi-byte character. Only whole frames, the ones followed by a blank line, are returned; the
 * tail goes back to the caller to be prepended to the next chunk. Both line endings are accepted because a
 * proxy in front of the API is free to rewrite them, and `data:` may appear more than once in a frame, which
 * the specification says to join with newlines.
 *
 * Pure on purpose: this is the part that is easy to get subtly wrong and impossible to see going wrong, since
 * a dropped frame looks exactly like a step that never happened.
 */
export function readFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let rest = buffer.replace(/\r\n/g, "\n");
  for (;;) {
    const cut = rest.indexOf("\n\n");
    if (cut < 0) break;
    const block = rest.slice(0, cut);
    rest = rest.slice(cut + 2);
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length) frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}

/* ---------- asking ---------- */

export const conciergeReady = (): boolean => !!API_URL;

export type AskResult = { ok: true; answer: ConciergeAnswer } | { ok: false; error: string };

/**
 * One question, and the steps while it works.
 *
 * The streaming route is a POST, so this is a stream read by hand rather than an `EventSource`, which can only
 * GET. Every way it can fail ends at the same place: the plain route. A stream is a nicety, the answer is the
 * product, and a guest on a network that buffers responses, or behind a proxy that will not forward
 * `text/event-stream`, should get the answer a second later rather than a sentence about something breaking.
 *
 * `signal` is how a second question cancels the first. Without it a slow answer to "escape room in waterloo"
 * lands after the guest has moved on to "axe throwing" and overwrites it, which reads as the agent answering
 * the wrong question rather than as a race.
 */
export async function askConcierge(
  text: string,
  opts: { session?: string | null; ask?: number; onStep?: (s: ConciergeStep) => void; signal?: AbortSignal } = {},
): Promise<AskResult> {
  const body = JSON.stringify({ text, session: opts.session || null, ask: opts.ask ?? 3 });
  if (!API_URL) return { ok: false, error: "The concierge is not reachable from this build." };

  const streamed = await stream(body, opts);
  if (streamed) return streamed;
  if (opts.signal?.aborted) return { ok: false, error: "" };
  return plain(body, opts.signal);
}

/** null when the stream could not be used at all, so the caller falls back. A refusal from the API is not null. */
async function stream(body: string, opts: { onStep?: (s: ConciergeStep) => void; signal?: AbortSignal }): Promise<AskResult | null> {
  try {
    const res = await fetch(API_URL + "/concierge/stream", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body,
      signal: opts.signal,
    });
    // A 400 is the API reading the sentence and declining it, which is an answer, not a transport failure.
    if (res.status === 400) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: j?.error || "Say what you want to do." };
    }
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let answer: ConciergeAnswer | null = null;
    let failed: string | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // `stream: true` so a multi-byte character split across two chunks is held rather than mangled.
      buf += dec.decode(value, { stream: true });
      const read = readFrames(buf);
      buf = read.rest;
      for (const f of read.frames) {
        let obj: unknown;
        try {
          obj = JSON.parse(f.data);
        } catch {
          continue;
        }
        if (f.event === "step") opts.onStep?.(obj as ConciergeStep);
        else if (f.event === "answer") answer = obj as ConciergeAnswer;
        else if (f.event === "failed") failed = (obj as { error?: string }).error || "Something broke reaching the shops.";
      }
    }
    if (answer) return { ok: true, answer };
    if (failed) return { ok: false, error: failed };
    // The socket closed with nothing on it. The plain route may still answer, so say nothing and let it try.
    return null;
  } catch (e) {
    if (opts.signal?.aborted) return { ok: false, error: "" };
    console.warn(`[concierge] stream: ${(e as Error).message}`);
    return null;
  }
}

/** The same answer in one response. The fallback, and the whole of it on a browser with no streams. */
async function plain(body: string, signal?: AbortSignal): Promise<AskResult> {
  try {
    const res = await fetch(API_URL + "/concierge/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // The plan asks several shops' booking systems and waits on the slowest, so this is not a 12 second call.
      signal: signal || AbortSignal.timeout(35000),
    });
    const data = (await res.json().catch(() => null)) as (ConciergeAnswer & { error?: string }) | null;
    if (!res.ok || !data) return { ok: false, error: data?.error || "I could not reach the shops just now. Try again in a moment." };
    return { ok: true, answer: data };
  } catch (e) {
    if (signal?.aborted) return { ok: false, error: "" };
    console.warn(`[concierge] ask: ${(e as Error).message}`);
    return { ok: false, error: "I could not reach the shops just now. Try again in a moment." };
  }
}

/** The guest changed their mind rather than refined it, so the agent forgets what it was told. */
export async function resetConcierge(session: string | null): Promise<void> {
  if (!API_URL || !session) return;
  try {
    await fetch(API_URL + "/concierge/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    /* Forgetting is best effort: a session left standing expires on its own. */
  }
}

/* ---------- what the site knows that the sentence did not say ---------- */

/**
 * The sentence, with the guest's own place added when they did not name one.
 *
 * "where are you? a town or city is enough" is the most common thing the agent has to ask, and on the site it
 * is a question we already have the answer to: the home opened on a place, either one the guest chose or one
 * read off their connection. Asking anyway spends a whole turn of the conversation establishing something
 * known before the guest typed a character.
 *
 * Only when the sentence names nowhere. A place word in what they typed always wins, because the guest asking
 * about Waterloo from a sofa in Toronto means Waterloo, and `plan.ts` is the thing that knows how to read it.
 */
export function withPlace(text: string, place: string | null | undefined): string {
  const said = text.trim();
  if (!said || !place) return said;
  // "near me" is the guest asking for their own place, not naming one, so it comes out before the question of
  // whether they named somewhere is asked at all.
  const cleaned = said.replace(SELF_REFERENCE, " ").replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  if (!cleaned) return said;
  if (namesAPlace(cleaned)) return cleaned;
  return `${cleaned} near ${place.trim()}`;
}

/**
 * The ways a person says "where I am" without naming it.
 *
 * This was the whole of a bug worth remembering. The check below looks for a preposition with a word after it,
 * and "near me" is exactly that, so a guest who wrote "...for monday between 5-7pm near me" was taken to have
 * named a town. Their real city, which the home had already opened on, was never added, the agent could not
 * place "me", and it came back asking "Where are you?" over a list of three cities on the other side of the
 * continent. The one phrase that most plainly means "use my location" was the one phrase that switched it off.
 */
const SELF_REFERENCE =
  /\b(?:near|around|close to|by|in|at|from)\s+(?:me|us|here|my\s+(?:place|area|location|office|home|city|town))\b|\bnear\s?by\b|\bclose\s?by\b|\baround\s+here\b|\bin\s+my\s+area\b/gi;

/**
 * The words that follow one of those prepositions and are never the start of a town.
 *
 * Without this the check was a preposition and any letter, and "escape room in the evening" is exactly that,
 * so the sentence was taken to name a place. The guest's own city, which the home had already opened on, was
 * never added, and the agent came back asking where they were. The hour and the day are the two things a
 * person says after "at" and "in" far more often than a town: "at seven", "in the morning", "by myself", "at
 * sunset", "on monday at eight". Eleven of twelve ordinary sentences that name nowhere tripped it.
 *
 * Of the two directions to be wrong in, this one is the cheap one. A place here that the list rejects ("in
 * the villages") only means the guest's own city is appended to the end of a sentence that already named one,
 * and `plan.ts` takes the place it reads first, which is still theirs.
 */
const NOT_A_PLACE = new Set(
  (
    "the a an my our your their his her its this that these those some any another each either every " +
    "morning mornings afternoon afternoons evening evenings night nights noon midnight midday " +
    "dawn dusk sunset sunrise lunch lunchtime dinner dinnertime breakfast brunch " +
    "today tonight tomorrow now later soon anytime sometime " +
    "monday tuesday wednesday thursday friday saturday sunday mon tue tues wed weds thu thur thurs fri sat sun " +
    "weekend weekends weekday weekdays week month " +
    "january february march april may june july august september october november december " +
    "jan feb mar apr jun jul aug sep sept oct nov dec " +
    "one two three four five six seven eight nine ten eleven twelve half quarter o " +
    "me us myself ourselves him them anyone someone everyone " +
    "about around under over between roughly approx least most all home work"
  ).split(" "),
);

/**
 * Whether the sentence already carries a place. Deliberately shallow: it looks for the words a person puts in
 * front of one rather than trying to recognise town names, which is `plan.ts`'s job and needs the catalog to
 * do it. A false positive costs the guest their own city and a wasted turn being asked for it; a false
 * negative appends a place the reader then ignores in favour of the one that was named.
 */
const PLACE_LEAD = /\b(?:in|near|around|by|at|close to|downtown)\s+([a-z][a-z'’-]*)/gi;

function namesAPlace(text: string): boolean {
  for (const m of text.matchAll(PLACE_LEAD)) {
    if (!NOT_A_PLACE.has(m[1].toLowerCase())) return true;
  }
  return false;
}

/* ---------- an option is a business we already have a page for ---------- */

let byDomain: Map<string, string> | null = null;
let builtFrom = 0;

/**
 * The catalog listing for a concierge option, by domain.
 *
 * This is the join that makes the two halves one product. The concierge shortlists out of the same catalog the
 * site renders, so nearly every option it returns is a business with a listing here already: its photos, its
 * menu, its hours, Otto, and the booking flow. Without this the option is a dead end and the guest has to go
 * and find the business again.
 *
 * Built on demand and rebuilt when the catalog grows, because `catalog.json` merges in after first paint and
 * a map built before that holds the seeds alone.
 */
function foldPlace(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The catalog listing for this shop, or null when the domain is a chain whose seed is in another city.
 * Escapology Waterloo used to book the Tampa seed because both sit on escapology.com.
 */
export function listingIdFor(option: { domain: string; city?: string | null; name?: string | null }): string | null {
  const cat = getCatalog();
  if (!byDomain || builtFrom !== cat.length) {
    byDomain = new Map();
    for (const u of cat) {
      const d = domainOf(u.src);
      // First wins: the seeds are hand-verified and sit at the front of the catalog.
      if (d && !byDomain.has(d)) byDomain.set(d, u.id);
    }
    builtFrom = cat.length;
  }
  const want = domainOf(option.domain || "");
  if (!want) return null;
  const city = foldPlace(option.city || "");
  const first = byDomain.get(want) || null;
  if (!city) return first;
  const match = (u: Unclaimed | null) => {
    if (!u) return false;
    return foldPlace([u.title, u.area].join(" ")).includes(city);
  };
  if (match(experienceById(first))) return first;
  for (const u of cat) {
    if (domainOf(u.src) === want && match(u)) return u.id;
  }
  return null;
}

/**
 * A listing Ask can book against. Catalog first, then a stub so a live shop we have never ingested still
 * finishes on Outset instead of dumping the guest onto the vendor's own pay page.
 */
export function listingForOption(option: ConciergeOption): string {
  const existing = listingIdFor(option);
  if (existing) return existing;
  const host = domainOf(option.domain || "");
  const place = foldPlace(option.city || "").replace(/ /g, "").slice(0, 16);
  const slug = ((host || option.name).toLowerCase().replace(/[^a-z0-9]+/g, "") + place).slice(0, 48) || "shop";
  const id = "cg-" + slug;
  if (experienceById(id)) return id;
  const art = (ART_LABEL[option.category] ? option.category : "tour") as ArtKind;
  const here = `${option.city || ""} ${option.region || ""}`;
  const u: Unclaimed = {
    id,
    title: option.name,
    cat: "play",
    art,
    area: [option.city, option.region].filter(Boolean).join(", ") || option.city || "",
    metroId: /\b(waterloo|kitchener)\b/i.test(here) ? "waterloo" : "",
    src: host,
    specs: [],
    options: option.services.filter((s) => s.name).map((s) => ({
      name: s.name,
      detail: s.unit || "",
      price: s.price,
      per: s.per === "group" ? "group" : s.per === "person" ? "person" : undefined,
    })),
    includes: [],
    gap: "",
    rating: option.rating ?? undefined,
    reviews: option.reviews ?? undefined,
  };
  rememberOverlay(u);
  return id;
}

/* ---------- saying it out loud ---------- */

/** HH:MM the booking API accepts. Vendor times are usually 24h; a 7:00 PM from a page still has to book. */
export function slotOf(t: string): string | null {
  const m = /^(\d{1,2}):([0-5]\d)(?:\s*([ap]m))?$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23) return null;
  return String(h).padStart(2, "0") + ":" + m[2];
}

/**
 * "Sat, Sep 20 at 12:00 PM", in the shop's own wall clock.
 *
 * The date is split by hand rather than handed to `new Date`, because `new Date("2026-09-20")` is parsed as
 * UTC and comes back as the nineteenth anywhere west of Greenwich. That exact mistake is on the list in
 * `backend/src/concierge/AGENTS.md`: after eight in the evening "tomorrow" silently became the day after, and
 * the flight the guest asked about was never offered.
 */
export function whenLine(d: { date: string; time: string }, now: Date = new Date()): string {
  const day = dateFromKey(d.date);
  const when = day ? fmtDate(day, now) : d.date;
  return d.time ? `${when} at ${fmtTime(d.time)}` : when;
}


/**
 * How far a slot sits from the time the guest asked for, in words.
 *
 * A copy of `describeOffset` in `backend/src/concierge/plan.ts`, which writes the same phrase into the agent's
 * trace. Both say it the same way on purpose: a slot that has quietly slid four hours is how a guest misses
 * their dinner, and a screen that words it differently from the trace behind it is two accounts of one fact.
 */
export function offsetLine(min: number): string {
  if (min === 0) return "exactly when you asked";
  const a = Math.abs(min);
  const when = min < 0 ? "earlier" : "later";
  if (a < 60) return a + " min " + when;
  const h = Math.floor(a / 60);
  const m = a % 60;
  return h + (m ? "h " + m + "m" : " hour" + (h === 1 ? "" : "s")) + " " + when;
}

/** The offset for one departure, by its place in the list. Null when the guest never named a time. */
export function offsetOf(o: ConciergeOption, index: number): number | null {
  const n = o.offsets?.[index];
  return typeof n === "number" ? n : null;
}

/** "$99.51 + tax", or "Price on request". One sentence, so no surface quotes a pre-tax number as the price. */
export function priceLine(d: ConciergeDeparture): string {
  if (d.fromPrice == null) return "Price on request";
  return money(d.fromPrice) + (d.taxIncluded ? "" : " + tax");
}

/**
 * What a menu row costs, with the unit it is actually sold in.
 *
 * The rule this exists for: a "group" price is the whole room, and saying it "a head" is a five times
 * over-quote on a party of five. "for the room" is the wording `/go` uses, kept the same here so the two
 * surfaces cannot contradict each other about what a guest is being quoted.
 */
export function serviceLine(s: ConciergeService): string | null {
  if (s.price == null) return null;
  if (s.per === "group") return money(s.price) + " for the room";
  const unit = (s.unit || "").replace(/^\//, "").trim();
  return money(s.price) + (unit && unit !== "each" ? ` / ${unit}` : " per person");
}

/**
 * The cheapest per-head figure this shop publishes on its own site, for a departure whose own price the vendor
 * would not give up.
 *
 * FareHarbor answers "price on request" for some operators, and Resova and Checkfront have no feed to read at
 * all, so a live time can arrive with no price attached. `compare` is still built from these menu figures
 * (`priceOf` in `plan.ts` falls back to them the same way), which put "Across 4 places nearby: $79 to $250 a
 * head" above four cards that each said "Price on request". A guest reading that sees the screen quoting
 * prices and then refusing to show them.
 *
 * Per head only, and said to be from their site rather than from their calendar, because it is a published
 * price for this activity and not the price of this departure.
 */
export function menuPrice(o: ConciergeOption): number | null {
  return openFarePrice(o.services.filter((s) => s.per === "person"), (s) => s.price, (s) => s.name);
}

/**
 * The menu row to quote for a shop we cannot time, which is the cheapest one a guest could actually buy.
 *
 * The card used to print whichever priced row came back first, and the crawl returns them in the shop's own
 * page order, so a site that lists "Child $15" above "Adult $30" put $15 on the card. Same defect as the
 * infant fare on a live departure, one layer down: the number is real and the reader cannot buy it.
 *
 * Per-head rows are preferred over whole-room ones, because a room price beside a single business name reads
 * as a ticket. `isConcessionFare` is `backend/src/lib/fares.ts`, the same rule the listing page's picker and
 * the concierge's own FareHarbor reader use, so the three cannot drift into three different headline prices
 * for one shop.
 */
export function headlineService(o: ConciergeOption): ConciergeService | null {
  const priced = o.services.filter((s) => s.price != null);
  if (!priced.length) return null;
  const person = priced.filter((s) => s.per === "person");
  const pool = person.length ? person : priced;
  const open = pool.filter((s) => !isConcessionFare(s.name));
  return (open.length ? open : pool).reduce((a, b) => ((b.price as number) < (a.price as number) ? b : a));
}

/**
 * The comparison line, which is the answer to "why not just use a search engine".
 *
 * Those prices sit on a dozen separate websites behind a dozen different booking widgets, and nobody compares
 * them because nobody can. Only ever per head: `priceOf` in `plan.ts` builds `compare` from per-person figures
 * alone for the same reason `serviceLine` will not say "a head" about a room.
 */
export function compareLine(c: ConciergeAnswer["compare"]): string | null {
  if (!c || c.count < 2) return null;
  if (c.cheapest === c.dearest) return `All ${c.count} places nearby charge about ${money(c.cheapest)} a head.`;
  return `Across ${c.count} places nearby: ${money(c.cheapest)} to ${money(c.dearest)} a head.`;
}

/**
 * What the agent took from the sentence, in a phrase, for when it has to ask one more thing.
 *
 * A guest who typed "a team offsite with a $500 budget and 10 people for monday between 5-7pm near me" and got
 * back a four item menu concluded the product had not listened. It had: the party, the budget, the day, the
 * hour and the place were all read correctly. It just had no activity to search on, because "offsite" is not
 * one. Showing the reading above the question is the difference between being ignored and being nearly there.
 *
 * Only what they actually said. An assumed party of two is not something they told us, and repeating it back
 * as though it were is the silent guess dressed up as a fact.
 */
export function understood(answer: ConciergeAnswer): string {
  const i = answer.intent;
  if (!i) return "";
  const said = new Set(answer.assumptions || []);
  const parts: string[] = [];
  if (i.categoryLabel) parts.push(i.categoryLabel.toLowerCase());
  // The party is only ours to repeat when nobody assumed it for them.
  if (i.party > 1 && ![...said].some((a) => /of you|people|party/i.test(a))) parts.push(plural(i.party, "person").replace("persons", "people"));
  if (i.maxTotal != null) parts.push(money(i.maxTotal) + " for the group");
  else if (i.maxPerPerson != null) parts.push("up to " + money(i.maxPerPerson) + " a head");
  if (i.when && i.when !== "any") parts.push(i.when);
  if (i.atMinute != null) parts.push("around " + fmtTime(`${String(Math.floor(i.atMinute / 60)).padStart(2, "0")}:${String(i.atMinute % 60).padStart(2, "0")}`));
  if (i.cover) parts.push(i.cover === "indoor" ? "indoors" : "outdoors");
  if (i.city) parts.push("near " + i.city);
  return parts.join(" · ");
}

/**
 * What to say while it works, in words, from the agent's own trace.
 *
 * The wide view has a panel showing every step as it happens. The phone does not, and the phone is where a
 * long wait is actually felt: a cold shop now gets twelve seconds rather than five, because a shop nobody has
 * read recently is worth waiting for, and twelve seconds of three bouncing dots is indistinguishable from a
 * hang. The guest does not need the trace, but they do need to know something is happening and roughly what.
 *
 * Most steps already carry a written sentence, so they are shown as written. Wrapping them in phrasing of our
 * own produced "Toronto Heli Tours: first read, giving it longer has not been read in a while, so this one
 * takes longer", which is the same fact said twice by two authors. Only `ask` carries a bare business name,
 * and only it gets a verb put in front. Steps that finish in milliseconds are not narrated at all: naming
 * them is noise, and the time does not go there.
 */
const NARRATED = new Set(["catalog", "ask", "cold", "answer", "widen", "loosen"]);
/** Long enough to say which shop and what happened, short enough not to wrap three lines on a phone. */
const STATUS_MAX = 76;

export function stepLine(s: ConciergeStep): string | null {
  const text = (s.text || "").trim();
  if (!text || !NARRATED.has(s.kind)) return null;
  // "ask" is the only one whose text is a business and nothing else.
  // "Toronto Heli Tours's" is not how anybody writes it; a name already ending in s takes the apostrophe alone.
  const possessive = /s$/i.test(text) ? `${text}'` : `${text}'s`;
  const said = s.kind === "ask" && !text.includes(":") ? `Reading ${possessive} booking system` : text.charAt(0).toUpperCase() + text.slice(1);
  return said.length > STATUS_MAX ? said.slice(0, STATUS_MAX - 1).trimEnd() + "\u2026" : said;
}

/**
 * The one line a helpful person would open with.
 *
 * What was found and where, in one sentence. Prices live on the cards. The hour they asked for is
 * the time on the row.
 */
export function headline(answer: ConciergeAnswer, shown: Pick[]): string {
  const what = (answer.intent?.categoryLabel || "").toLowerCase();
  const where = answer.intent?.city ? " near " + answer.intent.city : "";

  if (shown.length) {
    const shops = new Set(shown.map((p) => p.option.name));
    const times = plural(shown.length, "time");
    const at = shops.size === 1 ? ` at ${shown[0].option.name}` : ` across ${plural(shops.size, "place")}`;
    const price = livePrice(shown);
    return `${times}${at}${price ? `, from ${money(price.amount)}${price.taxIncluded ? "" : " + tax"}` : ""}.`;
  }

  const n = answer.counts.total;
  if (!n) return "";
  return `${plural(n, what ? what + " place" : "place")}${where}.`;
}

/** The cheapest live ticket on show, and whether that figure already carries tax. */
function livePrice(shown: Pick[]): { amount: number; taxIncluded: boolean } | null {
  let best: { amount: number; taxIncluded: boolean } | null = null;
  for (const p of shown) {
    const a = p.departure.fromPrice ?? menuPrice(p.option);
    if (a == null) continue;
    // A menu figure is a published price rather than a live quote, so it is never claimed to include tax.
    const taxIncluded = p.departure.fromPrice != null ? p.departure.taxIncluded : false;
    if (!best || a < best.amount) best = { amount: a, taxIncluded };
  }
  return best;
}

/**
 * The things a guest would say next, as buttons.
 *
 * `plan.ts` reads all of these out of a sentence already, and almost nobody will think to type them. A shortlist
 * with no way to push back on it is a dead end, and "show me something else" is the commonest thing anybody
 * says to a recommendation.
 */
export function refinements(answer: ConciergeAnswer, shown: Pick[]): { label: string; text: string }[] {
  if (answer.followUp || !answer.options.length) return [];
  const out = [{ label: "Something else", text: "something else" }];
  // An offer to narrow already says "something else" in a more useful way, so the generic one stands down.
  if (answer.narrow?.choices?.length) out.length = 0;
  const c = answer.compare;
  if (c && c.dearest > c.cheapest) out.push({ label: "Cheaper", text: "anything cheaper" });
  if (shown.length) {
    out.push({ label: "Earlier", text: "earlier" }, { label: "Later", text: "later" });
  }
  out.push({ label: "Check again", text: "check again" });
  return out;
}

/**
 * Why we cannot quote a time at these shops, said accurately.
 *
 * "None of these publish live times" was a lie and got called one. Bad Axe Throwing, Lumberjacks and Riot Axe
 * all publish their times: they run their own hand-built booking pages, with a calendar, a guest count and
 * add-ons on them. What is true is that we cannot read those pages yet, which is our limitation and not their
 * absence, and telling a guest to phone a shop that takes bookings online is the product looking broken.
 *
 * Only a shop with no booking system at all is a phone call, and `route` is what says which is which.
 */
export function noTimesLine(options: ConciergeOption[]): string {
  /*
   * Said as our own limitation, never as a claim about the shop, and never as a permanent one.
   *
   * The bucket we file as unreadable is mostly a classification gap. Of 9,016 links that look hand-built from
   * the URL alone, a sample of 36 found a quarter embed a booking vendor in the page after all; a later pass
   * that opened twelve of them headless and watched what the calendar fetched found a usable endpoint on nine,
   * including all three of the axe shops a guest complained about. One was FareHarbor, which we have read for
   * months and had misfiled because the booking link was the shop's own page.
   *
   * So "yet" is load bearing in both directions. Do not harden this into a claim about what a shop runs, and
   * do not harden it into "most shops cannot be read" either: on the evidence, most of them can be, and the
   * reader that replays those endpoints is the piece that is missing rather than the shops' own systems.
   */
  const phone = options.filter((o) => o.route === "phone").length;
  if (phone === options.length) return "These book by phone. Here is what they charge:";
  if (phone === 0) return "No live times I can read. Prices from their sites:";
  return "No live times I can read on most of these. One books by phone. Prices from their sites:";
}

/** The three piles the answer sorts into, in the order the page shows them. Mirrors `payload()`'s own order. */
export function splitOptions(options: ConciergeOption[]): { quoted: ConciergeOption[]; priced: ConciergeOption[]; rest: ConciergeOption[] } {
  const quoted = options.filter((o) => o.departures.length);
  const priced = options.filter((o) => !o.departures.length && o.services.some((s) => s.price != null));
  const rest = options.filter((o) => !o.departures.length && !o.services.some((s) => s.price != null));
  return { quoted, priced, rest };
}

/**
 * The departures to show, at most `cap`, one each before any shop gets a second.
 *
 * Four slots drawn straight off the list is two businesses twice, which reads as two choices when the guest
 * asked to be shown what is out there. One each first is the same thing `/go` does, kept here so both
 * surfaces order them alike.
 */
export type Pick = { option: ConciergeOption; departure: ConciergeDeparture; offset: number | null };

export function spreadDepartures(quoted: ConciergeOption[], cap = 4): Pick[] {
  const out: Pick[] = [];
  for (let round = 0; out.length < cap; round++) {
    let added = false;
    for (const o of quoted) {
      const d = o.departures[round];
      if (!d) continue;
      // The offset travels with the departure it belongs to. `offsets` is parallel to `departures`, so the
      // index is the only thing joining them, and it is lost the moment a departure is lifted out alone.
      out.push({ option: o, departure: d, offset: offsetOf(o, round) });
      added = true;
      if (out.length >= cap) break;
    }
    if (!added) break;
  }
  return out;
}

/**
 * The same picks, one shop at a time.
 *
 * Spreading is how we choose which four times to keep. Showing them is a different job: three 10 o'clock,
 * 11 o'clock and 1 o'clock rides at one dock are one choice with three times, not three listings.
 */
export function groupShops(shown: Pick[]): { option: ConciergeOption; slots: { departure: ConciergeDeparture; offset: number | null }[] }[] {
  const order: string[] = [];
  const byDomain = new Map<string, { option: ConciergeOption; slots: { departure: ConciergeDeparture; offset: number | null }[] }>();
  for (const p of shown) {
    let g = byDomain.get(p.option.domain);
    if (!g) {
      g = { option: p.option, slots: [] };
      byDomain.set(p.option.domain, g);
      order.push(p.option.domain);
    }
    g.slots.push({ departure: p.departure, offset: p.offset });
  }
  return order.map((d) => byDomain.get(d)!);
}

/**
 * True when the guest named a clock time and not one slot on offer is at it.
 *
 * Then the answer opens differently: "nothing at exactly that time, these are the closest" rather than "here
 * is what is actually free", because the second sentence in front of a list that all sits two hours off is
 * the screen telling a guest they got what they asked for when they did not.
 */
export function missedTheHour(answer: ConciergeAnswer, shown: Pick[]): boolean {
  if (answer.intent?.atMinute == null || !shown.length) return false;
  return !shown.some((p) => p.offset === 0);
}

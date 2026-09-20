import type { OperatorContact, Unclaimed } from "../data/types";
import type { LiveAvailability } from "./api";
import { addressLine, plainWords } from "./catalog";
import { callablePhone } from "./phone";
import { withoutNoticeWindows } from "./duration";
import { money } from "./format";
import { faqText, groupCap, minAge } from "./listingDerive";
import { clockIn, hourLines, itemWeek, openStateAt, zoneFor, type Week } from "./openNow";
import { venueLabel } from "./places";
import { hasPrice } from "./pricing";

/**
 * Otto: the 24/7 assistant on a catalog listing.
 *
 * How it answers, in order:
 * 1. One idea per reply. The direct answer first, in about fifteen words, then at most one supporting sentence.
 * 2. Only this operator's published facts: live availability, options, hours, rules, policies, FAQ, contact.
 * 3. When a fact is missing it says so in one short sentence and offers the next step. It never guesses.
 * 4. It never confirms a booking, a hold or a discount, and never answers about weather, traffic or other businesses.
 */

export const ASSISTANT_NAME = "Otto";

export type CompanyContext = {
  item: Unclaimed;
  contact: OperatorContact | null;
  /** Real departures from FareHarbor, Peek or Xola when the listing has them. */
  live?: LiveAvailability | null;
};

/** What the last answer was about, so "and the longer one?" has something to refer back to. */
export type ChatState = {
  topic?: Topic;
  /** Family of offers the last answer named ("Jet Ski Rental"). */
  family?: string;
  /** The exact offer the last answer named. */
  offer?: string;
  /** Day the last answer was about, 0 = Sunday. */
  day?: number;
};

export type Answer = { text: string; chips: string[]; state: ChatState };

type Topic =
  | "greet" | "thanks" | "price" | "priceOf" | "cheapest" | "list" | "duration"
  | "openNow" | "closeTime" | "dayHours" | "holidayHours" | "slot" | "book" | "group" | "age"
  | "rules" | "bring" | "included" | "cancel" | "rainPolicy" | "meet" | "deals"
  | "waiver" | "contact" | "describe" | "fee" | "outOfScope" | "unknown"
  | "ack" | "next" | "walkin" | "pets" | "search";

/* ---------- small text helpers ---------- */

const NUM_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n: number) => (n < NUM_WORD.length ? NUM_WORD[n] : String(n));

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Operator prose, cut to one readable sentence of at most `max` characters. */
function clip(raw: string, max = 150): string {
  const text = plainWords(String(raw || "")).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const stop = text.search(/[.;]\s+[A-Z0-9]/);
  let out = stop > 20 ? text.slice(0, stop) : text;
  if (out.length > max) {
    const cut = out.lastIndexOf(" ", max);
    out = out.slice(0, cut > 40 ? cut : max).replace(/[,;:]$/, "") + "…";
  }
  return out.replace(/\s*[.;,:]+$/, "");
}

const sentence = (s: string) => (s ? s.replace(/\s*$/, "") + (/[.!?…]$/.test(s.trim()) ? "" : ".") : "");
const upper1 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Short operator lines read as a list ("camera, towel and sunscreen"); longer ones read as up to two sentences. */
function factList(items: string[], lead: string): string {
  const clean = items.map((i) => clip(i, 90)).filter(Boolean);
  if (!clean.length) return "";
  const wordy = clean.some((i) => i.split(" ").length > 5);
  if (!wordy) return lead + list(clean.map(lower1), 3) + ".";
  const two = clean.slice(0, 2).map((i) => sentence(upper1(i)));
  const take = two.join(" ").length > 115 ? 1 : two.length;
  const rest = clean.length - take;
  return two.slice(0, take).join(" ") + (rest > 0 ? " Plus " + rest + " more on this page." : "");
}

function list(items: string[], max = 4): string {
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  if (more > 0) return shown.join(", ") + " and " + more + " more";
  return shown.length > 1 ? shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1] : shown[0] || "";
}

const lower1 = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/* ---------- the operator's offers, flattened and grouped ---------- */

type Offer = {
  name: string;
  label: string;
  price: number | null;
  per?: string;
  minutes: number | null;
  desc?: string | null;
  family: string;
};

const OFFER_NOUN = /^(rentals?|tours?|packages?|admission|lessons?|class(es)?|instruction|pass(es)?|part(y|ies)|rides?|encounters?|sessions?|games?|massages?|facials?|charters?|cruises?|sails?|experiences?|tickets?|membership|access|combo|special|room|rooms|event|events|dinner|course|trip)$/;

/** Minutes a piece of text states, or null. Reads "90 minutes", "1.5 hours", "1 hr 30 min", "half day". */
export function minutesIn(text: string): number | null {
  // How much notice a cancellation needs is not how long the thing runs. Asked "how long is it?", Otto told a
  // campground's guests "About 72 hours" off the line "Cancellations prior to 72 hours", and a golf course's
  // twilight round "2 hours" because the rate starts two hours before close. See duration.ts.
  const t = withoutNoticeWindows(text).toLowerCase();
  if (/\bhalf[ -]day\b/.test(t)) return 240;
  if (/\b(full|all)[ -]day\b/.test(t)) return 480;
  const frac = t.match(/\b(\d+)\/(\d+)\s*(?:hours?|hrs?\b|hr\b)/);
  if (frac && Number(frac[2])) return Math.round((Number(frac[1]) / Number(frac[2])) * 60);
  const h = t.match(/(\d+(?:\.\d+)?)[\s-]*(?:hours?|hrs?\b|hr\b)/);
  const m = t.match(/(\d+)\s*(?:minutes?|mins?\b|min\b)/);
  if (h && m) return Math.round(Number(h[1]) * 60) + Number(m[1]);
  if (h) return Math.round(Number(h[1]) * 60);
  if (m) return Number(m[1]);
  return null;
}

export function fmtDur(mins: number): string {
  if (mins < 60) return mins + " minutes";
  if (mins % 60 === 0) return mins / 60 + (mins === 60 ? " hour" : " hours");
  if (mins % 30 === 0) return mins / 60 + " hours";
  return Math.floor(mins / 60) + " hr " + (mins % 60) + " min";
}

/** Drop the parts of a name that only separate one variant from another, so siblings share a family. */
function familyOf(name: string, ctx: CompanyContext): string {
  let s = " " + name + " ";
  s = s.replace(/\b\d+\/\d+\s*(hours?|hrs?|hr)\b/gi, " ");
  s = s.replace(/\b\d+(\.\d+)?[\s-]*(hours?|hrs?|hr|minutes?|mins?|min)\b/gi, " ");
  s = s.replace(/\b(half|full|all)[ -]day\b/gi, " ");
  s = s.replace(/,\s*\d+\s*(students?|people|persons?|guests?|players?)\b/gi, " ");
  s = s.replace(/\b(weekends?|weekdays?|weeknights?)\b/gi, " ");
  s = s.replace(/\bper (hour|person|day|night|lane|group|game|round)\b/gi, " ");
  const cities = [ctx.contact?.city, ...(ctx.item.locations || []).map((l) => venueLabel({ city: l.city }))].filter(Boolean) as string[];
  for (const c of cities) s = s.replace(new RegExp("\\b" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), " ");
  s = s.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/(\s*[–—,:\/-])+\s*$/, "").trim();
  return s.length > 2 ? s : plainWords(name);
}

function offersOf(ctx: CompanyContext): Offer[] {
  const { item } = ctx;
  const out: Offer[] = [];
  if (item.services?.length) {
    for (const s of item.services) {
      for (const v of s.variants) {
        const name = plainWords(s.name);
        const label = plainWords(v.label || "");
        out.push({ name, label, price: v.price, per: v.per, minutes: minutesIn(label) ?? minutesIn(name), desc: s.desc ? plainWords(s.desc) : null, family: familyOf(name, ctx) });
      }
    }
  } else {
    for (const o of item.options) {
      const name = plainWords(o.name);
      const label = plainWords(o.detail || "");
      out.push({ name, label, price: o.price, per: o.per, minutes: minutesIn(label) ?? minutesIn(name), desc: null, family: familyOf(name, ctx) });
    }
  }
  // "10-pin Lane Rental Vernon" and "10-pin Lane Rental Penticton" are one thing in two towns.
  for (let pass = 0; pass < 2; pass += 1) {
    const names = [...new Set(out.map((o) => o.family))];
    for (const n of names) {
      const parts = n.split(" ");
      if (parts.length < 3) continue;
      const prefix = parts.slice(0, -1).join(" ");
      const siblings = names.filter((m) => m === prefix || (m.startsWith(prefix + " ") && m.split(" ").length === parts.length));
      const tails = siblings.map((m) => m.slice(prefix.length).trim().toLowerCase()).filter(Boolean);
      if (tails.some((t) => OFFER_NOUN.test(t))) continue;
      if (siblings.length >= 2) for (const o of out) if (siblings.includes(o.family)) o.family = prefix;
    }
  }
  return out;
}

function families(offers: Offer[]): { name: string; offers: Offer[] }[] {
  const map = new Map<string, Offer[]>();
  for (const o of offers) {
    const key = o.family.toLowerCase();
    const cur = map.get(key);
    if (cur) cur.push(o);
    else map.set(key, [o]);
  }
  // Extras (shoe rental, fees, deposits, storage) are real prices but not what a guest means by "what do you offer".
  const extra = (n: string) => /\b(shoe|shoes|fee|fees|deposit|storage|tax|gratuity|add.?on|upgrade|surcharge|tokens?|straightening|mechanic)\b/i.test(n);
  return [...map.values()].map((group) => ({ name: group[0].family, offers: group })).sort((a, b) => Number(extra(a.name)) - Number(extra(b.name)));
}

// A 0 here is the crawler finding a currency sign and no number, not a free offer: see hasPrice in pricing.ts.
const priceOf = (o: Offer) => (hasPrice(o.price) ? money(o.price) + (o.per || "") : "");

/** How a guest would name this offer in a sentence. */
function offerLabel(o: Offer): string {
  const l = o.label;
  const useless = !l || /^per\b/i.test(l) || /\b(sun|mon|tue|wed|thu|fri|sat)\w*\b.*\d/i.test(l) || /^varies$/i.test(l) || l.length > 30 || o.name.toLowerCase().includes(l.toLowerCase());
  const sameLength = o.minutes != null && minutesIn(o.name) === o.minutes;
  return useless || sameLength ? o.name : o.name + " (" + l + ")";
}

/* ---------- fuzzy match: "how much for the sunset cruise" ---------- */

const STOP = new Set(
  ("how much does do did it is are was the a an for of you your yours we i my me us can could would should please price prices pricing cost costs costing" +
    " about what when where which who any there they them their have has had be been but and or to at in on with that this its it's one thing things" +
    " tell show give book long time take takes run runs ok okay just like get got need also much many will allowed bring").split(/\s+/),
);

const stem = (w: string) => w.replace(/ies$/, "y").replace(/(sses|ses|xes|zes|ches|shes)$/, "").replace(/s$/, "");

function words(text: string): string[] {
  return plainWords(text)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

/** The offer a question names, matched loosely against names, labels and descriptions. */
function matchOffer(offers: Offer[], q: string): Offer | null {
  // Only the clause that names the thing: "how much is the sunset sail and how long is it" -> "sunset sail".
  const qw = words(q.split(/\band\b|,/i)[0]).filter((w) => !/^(how|long|hour|minute|people|person|price)$/.test(w));
  if (!qw.length || !offers.length) return null;
  const docs = offers.map((o) => words(o.name + " " + o.label + " " + (/[a-z]/.test(o.desc || "") ? o.desc : "")));
  const has = (ow: string[], w: string) => ow.includes(w) || ow.some((x) => x.length >= 5 && w.length >= 5 && (x.startsWith(w) || w.startsWith(x)));
  // A word every offer shares ("cruise" at a cruise company) names nothing in particular.
  const share = (w: string) => docs.filter((ow) => has(ow, w)).length / docs.length;
  let best: { o: Offer; score: number; hit: number; distinct: number } | null = null;
  offers.forEach((o, i) => {
    const ow = docs[i];
    let hit = 0;
    let distinct = 0;
    for (const w of qw) {
      if (!has(ow, w)) continue;
      hit += 1;
      if (share(w) <= 0.5 || docs.length === 1 || (qw.length === 1 && share(w) < 1)) distinct += 1;
    }
    if (!hit) return;
    const score = hit + distinct + hit / Math.max(3, new Set(ow).size) + (o.price != null ? 0.25 : 0);
    if (!best || score > best.score) best = { o, score, hit, distinct };
  });
  const b = best as { o: Offer; score: number; hit: number; distinct: number } | null;
  if (!b) return null;
  const unmatched = qw.length - b.hit;
  if (b.distinct === 0) return null;
  if (unmatched > 0 && b.hit < 2 && qw.length > 1 && b.distinct < 1) return null;
  if (unmatched > b.hit) return null;
  return b.o;
}

function familyOfOffer(offers: Offer[], hit: Offer): { name: string; offers: Offer[] } {
  return families(offers).find((f) => f.name.toLowerCase() === hit.family.toLowerCase()) || { name: hit.family, offers: [hit] };
}

/** The thing a price question names, even when the operator doesn't sell it: "how much for the sunset cruise" -> "sunset cruise". */
function askedThing(q: string): string | null {
  const m = q.toLowerCase().split(/\band\b|,/)[0].trim().match(/\b(?:for|is|are|of)\s+(?:the|a|an|your|one)?\s*([a-z][a-z' -]{2,40}?)\s*\??$/);
  if (!m) return null;
  const thing = m[1].trim();
  if (!words(thing).length || /^(it|that|this|them|us|me|one|two|people|person|kids?|adults?|group|everyone|a group|each|entry|admission)$/.test(thing)) return null;
  return thing;
}

function matchFamily(offers: Offer[], q: string): { name: string; offers: Offer[] } | null {
  const hit = matchOffer(offers, q);
  return hit ? familyOfOffer(offers, hit) : null;
}

/* ---------- published prose, searched by topic ---------- */

function corpus(item: Unclaimed): string[] {
  return [
    ...(item.requirements || []),
    ...(item.policies || []),
    ...item.specs,
    ...item.includes,
    ...(item.groupInfo || []),
    ...(item.bring || []),
    ...(item.highlights || []),
    item.extraNote || "",
    item.checkin || "",
    item.meetingPoint || "",
    item.season || "",
  ]
    .flatMap((l) => l.split(/\s+·\s+|(?<=[.!?])\s+(?=[A-Z0-9])|\s+\d\.\s+/))
    .map((l) => l.trim())
    .filter((l) => l.length > 3);
}

function findLine(item: Unclaimed, re: RegExp): string | null {
  const hit = corpus(item).find((l) => re.test(l));
  return hit ? clip(hit) : null;
}

/* ---------- day-specific deals, from the operator's own site ---------- */

export type Promo = NonNullable<Unclaimed["promos"]>[number];

/** "16:00" -> "4 PM", "10:30" -> "10:30 AM". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h)) return hhmm;
  return (h % 12 === 0 ? 12 : h % 12) + (m ? ":" + String(m).padStart(2, "0") : "") + " " + (h >= 12 ? "PM" : "AM");
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Whether a promo applies at the operator's local clock: right day (empty days = every day), inside its window. */
export function promoOn(p: Promo, clock: { day: number; minutes: number }): boolean {
  if (p.days.length && !p.days.includes(clock.day)) return false;
  if (p.start && clock.minutes < toMin(p.start)) return false;
  if (p.end && clock.minutes >= toMin(p.end)) return false;
  return true;
}

/** The deals running right now in the operator's own time zone. Nothing when the site published none. */
export function todaysDeals(item: Unclaimed, now = new Date()): Promo[] {
  if (!item.promos?.length) return [];
  const zone = zoneFor(item);
  const clock = clockIn(zone, now);
  // A dated deal ("May 10") runs on that date only: its empty day list does not mean every day.
  let dateToday = "";
  try {
    dateToday = now.toLocaleDateString("en-US", { month: "long", day: "numeric", ...(zone ? { timeZone: zone } : {}) });
  } catch {
    dateToday = now.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  }
  return item.promos.filter((p) => (p.date ? p.date.replace(/,\s*\d{4}$/, "") === dateToday && promoOn({ ...p, days: [] }, clock) : promoOn(p, clock)));
}

/** Lite records carry the first deal as "3,5|Glow nights $25". True when that deal names today in the operator's zone. */
export function dealToday(item: Unclaimed, now = new Date()): boolean {
  if (!item.deal) return false;
  const days = item.deal.split("|")[0].split(",").map(Number).filter((n) => n >= 0 && n <= 6);
  return days.length > 0 && days.includes(clockIn(zoneFor(item), now).day);
}

/** "Mon, Wed" or "Every day" or "Weekends", the way a guest reads a day list. */
export function dayLabel(days: number[]): string {
  if (!days.length) return "Every day";
  const s = [...days].sort((a, b) => a - b).join(",");
  if (s === "1,2,3,4,5") return "Weekdays";
  if (s === "0,6") return "Weekends";
  if (s === "0,1,2,3,4,5,6") return "Every day";
  return days.map((d) => DAY_SHORT[d]).join(", ");
}

/* ---------- hours ---------- */

function weekFor(ctx: CompanyContext): Week | null {
  const week = itemWeek(ctx.item);
  if (!week || !week.some((d) => d && d.close > 0)) return null;
  const text = hourLines(ctx.item).join(" ");
  // "Summer: 8:30-6:30" and "Winter: 8:30-4:30" both parse onto every day; say both rather than pick one.
  if (hourLines(ctx.item).filter((l) => /\b(spring|summer|fall|autumn|winter|season|peak|off.?season|memorial day|labor day)\b/i.test(l)).length >= 2) return null;
  // "5-10:30 pm" means 5 PM. The shared parser reads it as 5 AM when only the close carries the suffix.
  if (text && !/\b\d{1,2}(:\d{2})?\s*a\.?m\b/i.test(text)) {
    return week.map((d) => (d && d.close > 0 && d.open < 7 * 60 && d.open + 12 * 60 < d.close ? { open: d.open + 12 * 60, close: d.close } : d));
  }
  return week;
}

function clockLabel(m: number): string {
  const h = Math.floor((m % (24 * 60)) / 60);
  const mm = m % 60;
  return (h % 12 === 0 ? 12 : h % 12) + (mm ? ":" + String(mm).padStart(2, "0") : "") + " " + (h >= 12 ? "PM" : "AM");
}

const spanLabel = (s: { open: number; close: number }) => clockLabel(s.open) + " to " + clockLabel(s.close);

function nextOpenDay(week: Week | null, from: number): { day: number; span: { open: number; close: number } } | null {
  if (!week) return null;
  for (let i = 1; i <= 7; i += 1) {
    const d = (from + i) % 7;
      const span = week[d];
    if (span && span.close > 0) return { day: d, span };
  }
  return null;
}

/* ---------- live availability ---------- */

type Slot = { when: string; price?: number; seats?: number; date: string };

function liveSlots(ctx: CompanyContext): Slot[] {
  const days = ctx.live?.live ? ctx.live.days || [] : [];
  const out: Slot[] = [];
  // A row marked timeUnknown only says the date is open: its midnight is a placeholder, not a departure, so
  // Otto would have read out "Monday Sunset Cruise" as a start time. Rule 4: never invent an open slot.
  for (const d of days) for (const s of d.slots || []) if (!s.timeUnknown) out.push({ when: s.label, date: d.date, price: s.priceCents != null ? s.priceCents / 100 : undefined, seats: s.seatsLeft });
  return out;
}

function slotLine(s: Slot): string {
  const day = new Date(s.date + "T12:00:00");
  const name = Number.isNaN(day.getTime()) ? "" : DAY_NAMES[day.getDay()] + " ";
  const bits = [name + s.when];
  if (s.price != null) bits.push(money(s.price));
  if (s.seats != null && s.seats > 0 && s.seats <= 9) bits.push(s.seats + " left");
  return bits.join(", ");
}

function slotsOn(ctx: CompanyContext, day: number | null, minutes: number | null): Slot[] {
  let slots = liveSlots(ctx);
  if (day != null) {
    slots = slots.filter((s) => {
      const d = new Date(s.date + "T12:00:00");
      return !Number.isNaN(d.getTime()) && d.getDay() === day;
    });
  }
  if (minutes != null) {
    slots = slots.filter((s) => {
      const m = minutesOfDay(s.when);
      return m != null && Math.abs(m - minutes) <= 90;
    });
  }
  return slots;
}

/* ---------- reading the question ---------- */

const OUT_OF_SCOPE =
  /(how far|distance|miles (from|away)|downtown|close to (the )?(airport|hotel|beach|city)|\breviews?\b|\brated\b|\bratings?\b|stars on|worth it|safe\?|weather (forecast|tomorrow|today)|forecast|will it (rain|snow)|traffic|directions|how (do|to) (i )?get there|uber|lyft|hotel|competitor|compare|better than|other (company|place|shop|operator)|near(by|est)|yelp|tripadvisor|reddit|\bnews\b|who owns|lawsuit|accident|safety record|injur)/i;

/**
 * Topics that outrank the out-of-scope gate, because the words that trip it are also how a guest asks these.
 * "How far in advance do I need to book" is a notice period, not a distance; "the nearest opening" is the next
 * departure, not a nearby business; a pet question often carries a place word. One list, read by both gates:
 * they used to hold different lists, so the `pets` exemption was granted and then quietly taken back.
 */
const IN_SCOPE_ANYWAY: Topic[] = ["rainPolicy", "meet", "pets", "walkin", "next"];

/**
 * Somebody else's premises, somebody else's ride, somebody else's opinion. No exemption above reaches these,
 * because no question about this shop's own meeting point can be about one.
 *
 * The `meet` exemption is there so a guest asking where to meet survives a place word, and it was wide enough
 * to swallow every out-of-scope word a question starting "where" could carry: "where's the nearest hotel?",
 * "where can I get an uber?" and "where are the best reviews?" were all answered with this shop's own dock.
 * Handing a guest an address they did not ask for is worse than saying no, because it reads as an answer.
 *
 * A word the operator publishes themselves is theirs to answer, so a tour that meets in a hotel lobby or at an
 * airport terminal keeps its meeting point: `namesSomeoneElse` checks the shop's own location lines first.
 */
const SOMEONE_ELSE =
  /(hotels?|motels?|hostels?|airbnb|\bairport\b|\buber\b|\blyft\b|\btaxis?\b|yelp|tripadvisor|\breddit\b|\breviews?\b|\brated\b|\bratings?\b|stars on|who owns|lawsuit|\bdowntown\b|\btraffic\b|directions|how (do|to) (i )?get there)/i;

function namesSomeoneElse(ctx: CompanyContext, q: string): boolean {
  const m = q.match(SOMEONE_ELSE);
  if (!m) return false;
  const own = [ctx.item.meetingPoint || "", ctx.item.checkin || "", ctx.item.area || "", ctx.contact?.street || "", ctx.contact?.city || ""].join(" ");
  return !new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(own);
}

/**
 * Signing up is how a guest asks to book at some shops and how they ask about a mailing list at others. Otto
 * read every "sign up" as a booking, so "can I sign up for your newsletter?" was answered "Yes. Pick a service
 * and time on this page", which is a yes to something this page cannot do.
 */
const NOT_A_BOOKING = /\b(newsletter|mailing list|e-?mail list|email updates?|waiver|release form|an account|text alerts?)\b/i;

/**
 * A holiday or a calendar date. A shop publishes a week, never a calendar, so Otto cannot know whether it
 * trades on Christmas Day. Asked "are you open on Christmas?" it found no weekday in the question, fell
 * through to the "open right now" branch and answered "Not yet. They open today at 9 AM".
 */
const NAMED_DATE =
  /\b(christmas(\s+(eve|day))?|xmas|boxing day|new year'?s?(\s+(eve|day))?|thanksgiving|easter(\s+(sunday|monday))?|good friday|victoria day|canada day|independence day|fourth of july|july 4|memorial day|labor day|labour day|halloween|bank holiday|public holiday|stat(utory)? holiday|holidays?)\b|\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|jun(e)?|jul(y)?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?\s+\d{1,2}\b/i;

/** Undoing a booking rather than making one. Read in two places, so it lives here. */
const CANCEL_RE = /(cancel|refund|reschedul|no.?show|deposit|money back)/i;

/**
 * A question about a booking the guest already holds. Otto cannot see one: these listings are request to book
 * and the shop confirms. Saying "Yes" to "is my booking confirmed" is the one answer it must never give.
 */
function asksAboutOwnBooking(q: string): boolean {
  // "Is the booking confirmed?" is the same guest as "is my booking confirmed?" and was getting "Yes." A
  // determiner is what makes it one booking rather than the shop's policy on bookings in general, so a bare
  // plural ("are bookings confirmed instantly?") still reads as a question about how booking here works.
  if (!/\b(my|our|the|this|that)\s+(booking|reservation|order|tickets?)\b/i.test(q)) return false;
  return /\b(confirm\w*|go(es|ne)? through|went through|co(me|mes|ming)? through|came through|status|valid|receiv\w*|show\w* up|find|look ?up|check)\b|\bwhere'?s\b|\bwhere is\b/i.test(q);
}

const DAY_RE = /\b(sun|mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?)(day)?s?\b/i;
const DAY_KEY: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, wednes: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, satur: 6 };

/** Day number a question names, or null. "today" and "tomorrow" resolve against the operator's own day. */
function dayIn(q: string, today: number): number | null {
  if (/\btomorrow\b/i.test(q)) return (today + 1) % 7;
  if (/\btonight\b|\btoday\b/i.test(q)) return today;
  if (/\bweekends?\b/i.test(q)) return 6;
  const m = q.match(DAY_RE);
  return m ? DAY_KEY[m[1].toLowerCase()] ?? null : null;
}

/** Minutes past midnight a question names ("3pm", "at 3", "15:00", "noon"), or null. */
function minutesOfDay(q: string): number | null {
  const t = q.toLowerCase();
  if (/\bnoon\b|\bmidday\b/.test(t)) return 12 * 60;
  if (/\bmidnight\b/.test(t)) return 0;
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/) || t.match(/\b(\d{1,2}):(\d{2})\b/) || t.match(/\bat\s+(\d{1,2})\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = Number(m[2] || 0);
  const ap = (m[3] || "").replace(/\./g, "");
  if (h > 23 || mm > 59) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h <= 8) h += 12; // "come at 3" means the afternoon
  return h * 60 + mm;
}

/** A party size a question names: "8 of us", "for 6 people", "can you take 8". */
function partySize(q: string): number | null {
  const m =
    q.match(/\b(\d{1,3})\s*(?:of us|people|persons?|guests?|players?|kids?|adults?|pax)\b/i) ||
    q.match(/\b(?:group|party|team)\s*of\s*(\d{1,3})\b/i) ||
    q.match(/\b(?:take|fit|hold|seat|accommodate)\s*(\d{1,3})\b/i) ||
    q.match(/\bfor\s+(\d{1,3})\b/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n < 500 ? n : null;
}

/** An age a question names: "my 6 year old", "is 10 ok". */
function ageIn(q: string): number | null {
  const m = q.match(/\b(\d{1,2})\s*(?:year|yr|yo)\b/i) || q.match(/\bages?\s*(\d{1,2})\b/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n <= 99 ? n : null;
}

/**
 * A number sitting next to a ceiling or floor word that is a height, a clock, a calendar window, a weight or a
 * price, and so is not anybody's age. "Children must be at least 48 inches tall" is not a minimum age of 48.
 */
const NOT_AN_AGE = String.raw`(?!\s*(?:"|”|''|′|″|inch|inches|ft|feet|foot|'|cm\b|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|%|lbs?|pounds?|kg\b|dollars?))`;
/** The same bar `minAge` keeps on the listing page: a minimum age nobody would write outside it. */
const plausibleAge = (n: number) => Number.isFinite(n) && n >= 2 && n <= 21;

/** The minimum age the operator publishes, with the line it came from. */
function ageRule(item: Unclaimed): { min?: number; line: string } | null {
  // The listing page's reader answers first, for the same reason the group size one does: these disagreed on
  // 83 of the 1,210 listings where both had a number. Otto's own scan bridged "must be at least" to the first
  // number within twelve characters, whatever that number counted, so it told guests the minimum age was 48
  // ("at least 48 inches tall"), 30 ("arrive 30 minutes prior"), 14 ("canceled 14 days in advance") and 62
  // (a senior ticket price). It reads the requirement lines, which is where an age rule is written.
  const stated = minAge(item.requirements || []);
  if (stated != null) {
    const line = (item.requirements || []).find((l) => minAge([l]) === stated) || (item.requirements || [])[0];
    return { min: stated, line: clip(line) };
  }
  const lines = corpus(item);
  for (const l of lines) {
    let m = l.match(new RegExp(String.raw`\b(?:minimum age|age minimum|must be(?: at least)?)\D{0,12}(\d{1,2})\b` + NOT_AN_AGE, "i"));
    if (m && plausibleAge(Number(m[1]))) return { min: Number(m[1]), line: clip(l) };
    m = l.match(/\bages?\s*(\d{1,2})\s*(?:\+|and (?:up|older|above))/i) || l.match(/\b(\d{1,2})\s*(?:years?|yrs?)\s*(?:and\s*)?(?:\+|up|older|above)\b/i);
    if (m && plausibleAge(Number(m[1]))) return { min: Number(m[1]), line: clip(l) };
    m = l.match(/\b(?:no children|no kids|not permitted|no one)\D{0,14}under\D{0,6}(\d{1,2})\b/i) || l.match(/\bunder\s*(\d{1,2})\s*(?:are\s*)?not\b/i);
    if (m && plausibleAge(Number(m[1]))) return { min: Number(m[1]), line: clip(l) };
  }
  const any = lines.find((l) => /\b(ages?|years? old|minors?|(children|kids) (under|over|must|aged?)|under \d{1,2}|adults? only|all ages|family.friendly)\b/i.test(l) && !/waiver/i.test(l));
  return any ? { line: clip(any) } : null;
}

/** The largest group the operator says it takes, with the line. */
const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const digits = (l: string) => l.replace(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)\b/gi, (w) => String(NUMBER_WORDS[w.toLowerCase()]));

function capacityRule(item: Unclaimed): { max?: number; line: string } | null {
  const lines = [...(item.groupInfo || []), ...item.specs, ...(item.requirements || []), ...(item.policies || [])];
  // The listing page's own reader answers first, so the page and Otto can never name different numbers. They
  // used to, on 267 of the 1,722 listings where both had one: the page reads the group lines carefully, and
  // the scan below took the first ceiling word it saw and the first count after it, which is the floor of a
  // range ("Baskets hold 2 to 6 passengers" gave 2) and the head of a thousands separator ("accommodate up to
  // 10,000 people" gave 10). It only reads `groupInfo`, so the wider scan still has the rest to itself.
  const stated = groupCap(item.groupInfo);
  if (stated != null) {
    const line = (item.groupInfo || []).find((l) => groupCap([l]) === stated) || (item.groupInfo || [])[0];
    return { max: stated, line: clip(line) };
  }
  for (const l of lines) {
    const d = digits(l);
    const m =
      // The units are every unit a shop states next to a ceiling word that is not a count of people. Otto told
      // guests a group limit of 20 because the shop advertises "Views up to 20 miles on a clear day", and 48
      // because a pony ride asks riders to be "up to 48 inches tall".
      d.match(/\b(?:up to|maximum(?: of)?|max(?:imum)?(?: of)?|capacity(?: of)?|accommodates?(?: up to)?|holds?(?: up to)?|seats?(?: up to)?|no more than)\s*(\d{1,3})\b(?!\s*(?:lanes?|hours?|hrs?|days?|minutes?|mins?|years?|weeks?|%|lbs?|pounds?|feet|ft|in\b|inch|yards?|m\b|met(?:er|re)s?|km|miles?|"|”))/i) ||
      d.match(/\b(\d{1,2})\s*(?:-|to|–)\s*(\d{1,3})\s*(?:players?|people|guests?|persons?|passengers?|participants?)\b/i);
    if (m) {
      const max = Number(m[2] || m[1]);
      if (Number.isFinite(max) && max > 0) return { max, line: clip(l) };
    }
  }
  const any = lines.find((l) => /\bgroup|part(y|ies)|people|capacity\b/i.test(l));
  return any ? { line: clip(any) } : null;
}

function readQuestion(ctx: CompanyContext, q: string, prev: ChatState): Topic[] {
  const t = q.toLowerCase();
  const hits: Topic[] = [];
  const add = (x: Topic) => { if (!hits.includes(x)) hits.push(x); };

  if (/^(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/i.test(t) && t.length < 24) return ["greet"];
  if (/^(thanks|thank you|thx|ty|cheers|perfect|great|awesome|nice|cool|got it)\b/i.test(t) && t.length < 30) return ["thanks"];
  if (/^(ok|okay|k|hmm+|sure|alright|yes|yep|no|nope)\W*$/i.test(t)) return ["ack"];

  const offers = offersOf(ctx);
  const namedOffer = matchOffer(offers, q);
  const askedPrice = /(how much|price|pricing|cost|rate|fee|\$|expensive|charge)/i.test(t);
  // "Good Friday" and "Easter Monday" carry a weekday word that belongs to the holiday's name, not to this week.
  const noHoliday = t.replace(new RegExp(NAMED_DATE.source, "gi"), " ");
  const namesDay = DAY_RE.test(noHoliday) || /\b(tomorrow|today|tonight|weekends?)\b/i.test(noHoliday);
  const namesTime = minutesOfDay(t) != null;

  if (/(service fee|booking fee|hidden fee|extra (charge|fee)|fees\b|why.*fee)/i.test(t)) add("fee");
  if (/(cheapest|least expensive|lowest price|most affordable|budget option)/i.test(t)) add("cheapest");
  else if (askedPrice && (namedOffer || askedThing(q))) add("priceOf");
  else if (askedPrice) add("price");

  if (/(what do you (offer|have|do|sell)|what('s| is) (on offer|available|there to do)|options|services|packages|menu|what kinds?|what types?|list of)/i.test(t)) add("list");
  if (/(how long|duration|how many (hours|minutes)|how much time)/i.test(t) && !/(ahead|before|in advance|cancel)/i.test(t)) add("duration");

  if (/\b(open|opening|close|closed|closing|hours)\b/i.test(t) && !namesDay && NAMED_DATE.test(t)) add("holidayHours");
  else if (/(what time|when)\D{0,20}\b(close|closing)\b/i.test(t) || /\bclosing time\b/i.test(t)) add("closeTime");
  else if (/(what time|when)\D{0,20}\b(open|opening)\b/i.test(t) || /\bopening time\b/i.test(t)) add("closeTime");
  else if (/(open (right )?now|open yet|still open|you open\??$|r u open)/i.test(t) || (/\bopen\b/i.test(t) && !namesDay && !namesTime)) add("openNow");
  else if (/\b(open|close|closed|hours)\b/i.test(t) && namesDay) add("dayHours");

  const blocksSlot = /(deal|promo|special|discount|happy hour)/i.test(t) || hits.some((h) => ["dayHours", "closeTime", "openNow", "price", "priceOf", "cheapest"].includes(h));
  if (/(can i|can we|could i|do you have|any(thing)?\b|is there|availab|slot|spot|space|come by|come in|drop in|get in)/i.test(t) && (namesDay || namesTime) && !blocksSlot) add("slot");
  if (/((next|nearest) (one|slot|time|departure|opening|available|trip|tour|sail)|when'?s the next|earliest|soonest)/i.test(t)) add("next");
  if (/(walk.?ins?|without (a )?(booking|reservation|appointment)|need (a )?(reservation|appointment)|book ahead|how far ahead|ahead of time|in advance)/i.test(t)) add("walkin");
  // "How do I cancel my booking" is a cancellation question that happens to say "booking". Leave it to `cancel`,
  // which reads the shop's own refund policy, rather than answering "Yes, pick a service and time on this page".
  if ((/(book|reserve|reservation|buy tickets?)/i.test(t) || (/\bsign up\b/i.test(t) && !NOT_A_BOOKING.test(t))) && !hits.includes("slot") && !CANCEL_RE.test(t)) add("book");

  if (partySize(t) != null || /(group|party of|birthday|corporate|team|bachelor|how many (people|can)|capacity)/i.test(t)) add("group");
  // "How old do you have to be" says neither "age" nor a number, so it was read as a generic entry rule and
  // answered with whatever the shop's first requirement line happened to be. "How old is the boat" is not one.
  if (ageIn(t) != null || /\b(age|kid|kids|child|children|minor|toddler|baby|infant|senior|teen|year old)\b/i.test(t) || /\bhow old (do|does|must|should|would)\b/i.test(t)) add("age");
  // Same reason as `book` above: "I need to cancel my reservation" is not a question about who may take part.
  if (/(do i need|need to|have to|must |require|experience|beginner|first.?time|licen[sc]e|certif|swim|weight|height|how tall|pregnan|wheelchair|disab)/i.test(t) && !CANCEL_RE.test(t)) add("rules");
  if (/\b(dogs?|pets?|puppy|service animal)\b/i.test(t)) add("pets");
  if (/(what (should|do) (i|we) bring|bring|wear|what to wear|dress code)/i.test(t) && !/\bbring (my|our|a|the) (kid|child|son|daughter|dogs?|pets?|\d)/i.test(t)) add("bring");
  if (/(include|included|come with|provided|supplied|gear|equipment|what do (i|we) get|life ?jackets?|on ?board|bathroom|restroom|wifi|food|drinks?|alcohol|\bbar\b|byob)/i.test(t)) add("included");
  if (CANCEL_RE.test(t)) add("cancel");
  if (/(\brain|weather|storm|windy|snow(s|ing)?\b)/i.test(t)) add("rainPolicy");
  if (/(where|address|located|location|meet|meeting point|dock|launch|find you|check.?in|parking)/i.test(t)) add("meet");
  if (/(deal|promo|special|discount|coupon|happy hour)/i.test(t)) add("deals");
  if (/(waiver|release form|paperwork|sign (a|the|any) form)/i.test(t)) add("waiver");
  if (/(phone|call|number|contact|email|reach (you|them))/i.test(t)) add("contact");
  if (/(what is|what's|tell me about|describe|explain|what happens)/i.test(t) && (namedOffer || askedThing(q.replace(/tell me about/i, "info for")))) add("describe");

  // Follow-ups that only make sense against the last answer.
  if (!hits.length) {
    if (/^(and|what about|how about|ok|okay|so)?\s*(the )?(longer|shorter|bigger|smaller|cheaper|pricier|next|other)\s*(one|option)?\??$/i.test(t.trim())) add(prev.family || prev.offer ? "priceOf" : "list");
    else if (/^(what about|how about|and)\b/i.test(t) && namesDay) add(prev.topic === "slot" ? "slot" : "dayHours");
    else if (/^(what about|how about|and)\b/i.test(t) && namedOffer) add(prev.topic === "duration" ? "duration" : "priceOf");
    else if (/^(what about|how about|and)\b/i.test(t)) add("describe");
  }

  if ((OUT_OF_SCOPE.test(t) || SOMEONE_ELSE.test(t)) && (!hits.some((h) => IN_SCOPE_ANYWAY.includes(h)) || namesSomeoneElse(ctx, t))) return ["outOfScope"];
  if (!hits.length && namedOffer) add("describe");
  if (!hits.length) add("search");
  return hits;
}

/* ---------- answers ---------- */

/** The number Otto reads out, or null: a field that is two numbers or an unrendered template is not one. */
const shopPhone = (ctx: CompanyContext) => callablePhone(ctx.contact?.phone);

const nextStep = (ctx: CompanyContext) => (shopPhone(ctx) ? "Want their number?" : "A booking request on this page reaches them directly.");

const noFact = (ctx: CompanyContext, what: string) => "They haven't published " + what + ". " + nextStep(ctx);

function priceAnswer(ctx: CompanyContext): { text: string; state: ChatState } {
  const offers = offersOf(ctx).filter((o) => hasPrice(o.price));
  if (!offers.length) {
    if (ctx.item.from != null) return { text: "From " + money(ctx.item.from) + ". They haven't published the rest of the price list.", state: { topic: "price" } };
    return { text: noFact(ctx, "prices"), state: { topic: "price" } };
  }
  const sorted = [...offers].sort((a, b) => (a.price as number) - (b.price as number));
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const tail = high.price !== low.price ? " Up to " + priceOf(high) + " for the " + offerLabel(high) + "." : "";
  const head = "From " + priceOf(low) + " for the " + offerLabel(low) + ".";
  return { text: head + ((head + tail).length <= 125 ? tail : ""), state: { topic: "price", family: low.family, offer: low.name } };
}

function priceOfAnswer(ctx: CompanyContext, q: string, prev: ChatState): { text: string; state: ChatState } {
  const offers = offersOf(ctx);
  let fam = matchFamily(offers, q);
  const rel = q.toLowerCase();
  const relative = /\b(longer|shorter|bigger|smaller|cheaper|pricier|more expensive|next|other)\b/i.test(rel);
  if (!fam && prev.family && (relative || !askedThing(q))) fam = families(offers).find((f) => f.name.toLowerCase() === prev.family?.toLowerCase()) || null;

  if (relative) {
    const byTime = /\b(longer|shorter)\b/i.test(rel);
    const up = /\b(longer|bigger|pricier|more expensive|next)\b/i.test(rel);
    const base = (prev.offer && offers.find((o) => o.name === prev.offer)) || fam?.offers[0];
    const measure = (o: Offer) => (byTime ? o.minutes : o.price);
    const inFamily = fam && fam.offers.filter((o) => measure(o) != null && hasPrice(o.price)).length > 1;
    const pool = (inFamily && fam ? fam.offers : offers).filter((o) => measure(o) != null && hasPrice(o.price));
    const sorted = [...pool].sort((a, b) => (measure(a) as number) - (measure(b) as number));
    if (!sorted.length) return { text: byTime ? "They don't publish lengths to compare." : "They don't publish prices to compare.", state: prev };
    if (base && measure(base) == null) {
      const edge = up ? sorted[sorted.length - 1] : sorted[0];
      return { text: "No " + (byTime ? "length" : "price") + " is listed for that one. The " + (up ? "longest" : "shortest") + " is " + offerLabel(edge) + (edge.minutes && minutesIn(offerLabel(edge)) !== edge.minutes ? ", " + fmtDur(edge.minutes) : "") + ", at " + priceOf(edge) + ".", state: { topic: "priceOf", family: edge.family, offer: edge.name } };
    }
    if (measure(sorted[0]) === measure(sorted[sorted.length - 1])) {
      return { text: byTime && sorted[0].minutes ? "They all run " + fmtDur(sorted[0].minutes) + "." : "They're all " + priceOf(sorted[0]) + ".", state: prev };
    }
    const b = base ? (measure(base) as number) : up ? -Infinity : Infinity;
    const want = up ? sorted.find((o) => (measure(o) as number) > b) : [...sorted].reverse().find((o) => (measure(o) as number) < b);
    if (want) {
      const dur = want.minutes && minutesIn(want.name) !== want.minutes ? " (" + fmtDur(want.minutes) + ")" : "";
      return { text: want.name + dur + " is " + priceOf(want) + ".", state: { topic: "priceOf", family: want.family, offer: want.name } };
    }
    return { text: "That's already the " + (byTime ? (up ? "longest" : "shortest") : up ? "priciest" : "cheapest") + " one they list.", state: prev };
  }

  if (!fam) {
    const thing = askedThing(q);
    const general = priceAnswer(ctx).text;
    return { text: thing ? "They don't list a " + thing + ". " + (general.match(/^.*?[.!?](?=\s|$)/) || [general])[0] : general, state: { topic: "price" } };
  }
  const withPrice = fam.offers.filter((o) => hasPrice(o.price));
  if (!withPrice.length) return { text: "They list " + fam.name + " but no price for it. " + nextStep(ctx), state: { topic: "priceOf", family: fam.name } };
  const sorted = [...withPrice].sort((a, b) => (a.price as number) - (b.price as number));
  if (sorted.length === 1) {
    const o = sorted[0];
    const dur = o.minutes && minutesIn(offerLabel(o)) !== o.minutes ? " Runs " + fmtDur(o.minutes) + "." : "";
    return { text: offerLabel(o) + " is " + priceOf(o) + "." + dur, state: { topic: "priceOf", family: o.family, offer: o.name } };
  }
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  if (low.price === high.price) return { text: fam.name + " is " + priceOf(low) + ".", state: { topic: "priceOf", family: low.family, offer: low.name } };
  const cheap = low.minutes ? " Cheapest is the " + fmtDur(low.minutes) + " one." : low.label && offerLabel(low) !== low.name ? " Cheapest is " + lower1(low.label) + "." : "";
  return { text: fam.name + " runs " + priceOf(low) + " to " + priceOf(high) + "." + cheap, state: { topic: "priceOf", family: low.family, offer: low.name } };
}

function listAnswer(ctx: CompanyContext, q: string): { text: string; state: ChatState } {
  const offers = offersOf(ctx);
  if (!offers.length) {
    if (ctx.item.blurb) return { text: sentence(clip(ctx.item.blurb, 130)), state: { topic: "list" } };
    const spec = ctx.item.specs[0] || ctx.item.highlights?.[0];
    if (spec) return { text: sentence(clip(spec, 130)), state: { topic: "list" } };
    return { text: noFact(ctx, "a list of what they offer"), state: { topic: "list" } };
  }
  const fams = families(offers);
  const wantsAll = /\b(list|all|everything|show me)\b/i.test(q);
  const n = fams.length;
  let shown = wantsAll ? 6 : n > 4 ? 3 : 4;
  const build = () => (n === 1 ? "Just one: " + fams[0].name + "." : upper1(countWord(n)) + (n <= shown ? " things: " : " options: ") + list(fams.map((f) => f.name), shown) + ".");
  while (build().length > (wantsAll ? 170 : 115) && shown > 2) shown -= 1;
  const head = build();
  const priced = offers.filter((o) => hasPrice(o.price)).sort((a, b) => (a.price as number) - (b.price as number));
  return { text: head + (priced.length && n > 1 ? " Prices start at " + priceOf(priced[0]) + "." : ""), state: { topic: "list", family: fams[0].name } };
}

function durationAnswer(ctx: CompanyContext, q: string, prev: ChatState): { text: string; state: ChatState } {
  const offers = offersOf(ctx);
  const spread = (group: Offer[]) => [...new Set(group.map((o) => o.minutes as number))].sort((a, b) => a - b);
  const range = (mins: number[]) => (mins.length === 1 ? fmtDur(mins[0]) : fmtDur(mins[0]) + " to " + fmtDur(mins[mins.length - 1]));
  const hit = matchFamily(offers, q);
  const named = hit || (prev.family ? families(offers).find((f) => f.name.toLowerCase() === prev.family?.toLowerCase()) || null : null);
  const timed = (named ? named.offers : []).filter((o) => o.minutes != null);
  if (named && timed.length) return { text: named.name + " runs " + range(spread(timed)) + ".", state: { topic: "duration", family: named.name } };
  const hourly = offers.filter((o) => hasPrice(o.price)).length > 0 && offers.filter((o) => hasPrice(o.price)).every((o) => /\/(hr|hour)\b|per hour|hourly/i.test((o.per || "") + " " + o.label + " " + o.name));
  if (hourly) return { text: "It's priced by the hour, so as long as you book.", state: { topic: "duration" } };
  const all = offers.filter((o) => o.minutes != null);
  if (hit && !timed.length && all.length) return { text: "They don't list a length for " + hit.name + ". Other options run " + range(spread(all)) + ".", state: { topic: "duration", family: hit.name } };
  if (all.length) {
    const mins = spread(all);
    return { text: mins.length === 1 ? "About " + fmtDur(mins[0]) + "." : range(mins) + ", depending which you pick.", state: { topic: "duration" } };
  }
  if (ctx.item.dur) return { text: "About " + plainWords(ctx.item.dur) + ".", state: { topic: "duration" } };
  const line = corpus(ctx.item).find((l) => /\b\d+(\.\d+)?\s*(hours?|minutes?|mins?)\b/i.test(l) && !/cancel|refund|advance|before|prior|notice|arrive|early|late/i.test(l));
  if (line) return { text: sentence(clip(line)), state: { topic: "duration" } };
  return { text: noFact(ctx, "how long it runs"), state: { topic: "duration" } };
}

/** Hour lines as written, for when they can't be read into a week: "Spring & Summer: 8:30 AM - 6:30 PM; Fall & Winter: 8:30 AM - 4:30 PM". */
function hoursAsWritten(item: Unclaimed): string | null {
  const lines = hourLines(item).map((l) => clip(l, 70)).filter(Boolean);
  if (!lines.length) return null;
  const seasonal = lines.filter((l) => /\b(spring|summer|fall|autumn|winter|season)\b/i.test(l));
  if (seasonal.length >= 2) return "Hours change by season. " + seasonal.slice(0, 2).join("; ") + ".";
  return "Their hours say: " + lower1(lines[0]) + ".";
}

function openNowAnswer(ctx: CompanyContext): { text: string; state: ChatState } {
  const week = weekFor(ctx);
  const clock = clockIn(zoneFor(ctx.item));
  const st = openStateAt(week, clock);
  if (!st) {
    const next = nextOpenDay(week, clock.day);
    if (week && next) return { text: "No hours listed for today (" + DAY_NAMES[clock.day] + "). Next: " + DAY_NAMES[next.day] + " " + spanLabel(next.span) + ".", state: { topic: "openNow", day: clock.day } };
    if (hourLines(ctx.item).length) return { text: hoursAsWritten(ctx.item) as string, state: { topic: "openNow" } };
    return { text: noFact(ctx, "opening hours"), state: { topic: "openNow" } };
  }
  if (st.open) return { text: "Yes, open now" + (st.closesAt ? " until " + st.closesAt : "") + ".", state: { topic: "openNow", day: clock.day } };
  if (st.opensAt && /^Opens today/.test(st.label)) return { text: "Not yet. They open today at " + st.opensAt + ".", state: { topic: "openNow", day: clock.day } };
  if (st.opensAt) return { text: "No, closed now. Opens " + st.label.replace(/^Closed now, opens /, "") + ".", state: { topic: "openNow", day: clock.day } };
  if (st.label === "Closed today") {
    const next = nextOpenDay(week, clock.day);
    return { text: "No, closed today." + (next ? " Next open " + DAY_NAMES[next.day] + " at " + clockLabel(next.span.open) + "." : ""), state: { topic: "openNow", day: clock.day } };
  }
  return { text: "No, closed right now.", state: { topic: "openNow", day: clock.day } };
}

function closeTimeAnswer(ctx: CompanyContext, q: string): { text: string; state: ChatState } {
  const week = weekFor(ctx);
  const clock = clockIn(zoneFor(ctx.item));
  const asked = dayIn(q, clock.day);
  const day = asked ?? clock.day;
  const opening = /\bopen(ing)?\b/i.test(q) && !/\bclos/i.test(q);
  if (!week) {
    if (hourLines(ctx.item).length) return { text: hoursAsWritten(ctx.item) as string, state: { topic: "closeTime" } };
    return { text: noFact(ctx, "opening hours"), state: { topic: "closeTime" } };
  }
  const span = week[day];
  const when = day === clock.day && !DAY_RE.test(q) ? "today" : DAY_NAMES[day];
  if (!span) {
    const next = nextOpenDay(week, day);
    return { text: "They don't list hours for " + when + "." + (next ? " " + DAY_NAMES[next.day] + " they're open " + spanLabel(next.span) + "." : ""), state: { topic: "closeTime", day } };
  }
  if (span.close === 0) {
    const next = nextOpenDay(week, day);
    return { text: "They're closed " + when + "." + (next ? " Open " + DAY_NAMES[next.day] + " " + spanLabel(next.span) + "." : ""), state: { topic: "closeTime", day } };
  }
  return { text: (opening ? "They open at " + clockLabel(span.open) : "They close at " + clockLabel(span.close)) + " " + when + ".", state: { topic: "closeTime", day } };
}

function dayHoursAnswer(ctx: CompanyContext, q: string, prev: ChatState): { text: string; state: ChatState } {
  const week = weekFor(ctx);
  const clock = clockIn(zoneFor(ctx.item));
  if (week && /\bweekends?\b/i.test(q)) {
    const sat = week[6];
    const sun = week[0];
    const fmt = (d: typeof sat) => (!d ? "not listed" : d.close === 0 ? "closed" : spanLabel(d));
    if (!sat && !sun) {
      const wk = week[1] || week[2] || week[3];
      return { text: "No weekend hours are listed." + (wk && wk.close > 0 ? " Weekdays they're open " + spanLabel(wk) + "." : ""), state: { topic: "dayHours", day: 6 } };
    }
    if (sat && sun && fmt(sat) === fmt(sun)) return { text: sat.close === 0 ? "No, closed on weekends." : "Yes, weekends " + spanLabel(sat) + ".", state: { topic: "dayHours", day: 6 } };
    return { text: "Saturday " + fmt(sat) + ", Sunday " + fmt(sun) + ".", state: { topic: "dayHours", day: 6 } };
  }
  const day = dayIn(q, clock.day) ?? prev.day ?? clock.day;
  if (!week) {
    if (hourLines(ctx.item).length) return { text: hoursAsWritten(ctx.item) as string, state: { topic: "dayHours" } };
    return { text: noFact(ctx, "opening hours"), state: { topic: "dayHours" } };
  }
  const span = week[day];
  const name = /\b(today|tonight)\b/i.test(q) ? "today" : DAY_NAMES[day];
  if (!span) {
    const next = nextOpenDay(week, day);
    return { text: "They don't list hours for " + name + "." + (next ? " Next listed: " + DAY_NAMES[next.day] + " " + spanLabel(next.span) + "." : ""), state: { topic: "dayHours", day } };
  }
  if (span.close === 0) {
    const next = nextOpenDay(week, day);
    return { text: "No, closed " + (name === "today" ? "today" : DAY_NAMES[day] + "s") + "." + (next ? " Open " + DAY_NAMES[next.day] + " " + spanLabel(next.span) + "." : ""), state: { topic: "dayHours", day } };
  }
  return { text: "Yes, " + name + " " + spanLabel(span) + ".", state: { topic: "dayHours", day } };
}

function slotAnswer(ctx: CompanyContext, q: string, prev: ChatState): { text: string; state: ChatState } {
  const clock = clockIn(zoneFor(ctx.item));
  const day = dayIn(q, clock.day) ?? prev.day ?? null;
  const at = minutesOfDay(q);
  const hit = slotsOn(ctx, day, at);
  if (hit.length) {
    const more = hit.length > 1 ? " " + (hit.length - 1) + " more around then." : "";
    return { text: "Yes, " + slotLine(hit[0]) + "." + more, state: { topic: "slot", day: day ?? undefined } };
  }
  const all = liveSlots(ctx);
  if (all.length) return { text: "Nothing then. Next open time is " + slotLine(all[0]) + ".", state: { topic: "slot", day: day ?? undefined } };

  const week = weekFor(ctx);
  if (week && day != null) {
    const span = week[day];
    const name = day === clock.day ? "today" : DAY_NAMES[day];
    if (span && span.close === 0) return { text: "No, they're closed " + DAY_NAMES[day] + "s.", state: { topic: "slot", day } };
    if (span && at != null) {
      const ok = at >= span.open && at < span.close;
      return {
        text: ok ? "Yes, they're open " + name + " " + spanLabel(span) + ". Pick that time on this page to request it." : "Not at that time. " + name + " they're open " + spanLabel(span) + ".",
        state: { topic: "slot", day },
      };
    }
    if (span) return { text: "Open " + name + " " + spanLabel(span) + ". Pick a time on this page to request it.", state: { topic: "slot", day } };
    if (!span) return { text: "They don't list hours for " + DAY_NAMES[day] + ". Send a request for that time on this page and they confirm it.", state: { topic: "slot", day } };
  }
  const written = hoursAsWritten(ctx.item);
  if (written && day != null) return { text: written + " Request the time on this page and they confirm it.", state: { topic: "slot", day } };
  return { text: "I can't see their live calendar. Pick a date and time on this page and they confirm it.", state: { topic: "slot", day: day ?? undefined } };
}

function bookAnswer(ctx: CompanyContext, q: string): { text: string; state: ChatState } {
  if (/\b(for me|on my behalf|you book|book it for me|can you book)\b/i.test(q)) {
    return {
      text: "I can start it. You pay on Stripe, or from the card on your Profile if Otto is on. I never see the card. Pick a time on this page.",
      state: { topic: "book" },
    };
  }
  if (asksAboutOwnBooking(q)) {
    const phone = shopPhone(ctx);
    return {
      text: "I can't look up a booking you already have. " + (phone ? "Call " + phone + "." : ctx.item.title + " can check it for you."),
      state: { topic: "book" },
    };
  }
  const slots = liveSlots(ctx);
  if (slots.length) return { text: "Yes. Next open time is " + slotLine(slots[0]) + ". Book it on this page.", state: { topic: "book" } };
  return { text: "Yes. Pick a service and time on this page and " + ctx.item.title + " confirms it.", state: { topic: "book" } };
}

function groupAnswer(ctx: CompanyContext, q: string): { text: string; state: ChatState } {
  const n = partySize(q);
  const cap = capacityRule(ctx.item);
  if (!cap) return { text: noFact(ctx, "a group size limit"), state: { topic: "group" } };
  if (cap.max != null && n != null) {
    if (n <= cap.max) return { text: "Yes, " + n + " works. They take groups up to " + cap.max + ".", state: { topic: "group" } };
    return { text: n + " is over their limit of " + cap.max + ". " + sentence(cap.line), state: { topic: "group" } };
  }
  if (n != null) return { text: "No size limit is published. " + sentence(cap.line), state: { topic: "group" } };
  return { text: sentence(cap.line), state: { topic: "group" } };
}

function ageAnswer(ctx: CompanyContext, q: string): { text: string; state: ChatState } {
  const age = ageIn(q);
  const fams = families(offersOf(ctx));
  // Rules that name one experience ("Capybara Encounter minimum age 10") answer per experience.
  const scoped: { what: string; min: number }[] = [];
  for (const l of corpus(ctx.item)) {
    // Same two guards as `ageRule`, and for the same reason: "Children must be at least 48 inches tall to
    // paddle in any of our kayak tours" had this answering a parent asking about an eight year old with
    // "Not for Kayak Tour (48+)".
    const m = l.match(new RegExp(String.raw`\b(?:minimum age|age minimum|at least|ages?)\D{0,6}(\d{1,2})\b` + NOT_AN_AGE, "i")) || l.match(/\b(\d{1,2})\s*(?:years?|yrs?)\s*(?:and\s*)?(?:\+|up|older)\b/i);
    if (!m || !plausibleAge(Number(m[1]))) continue;
    const f = fams.find((x) => x.name.split(" ").length >= 2 && l.toLowerCase().includes(x.name.toLowerCase()));
    if (f && !scoped.some((s) => s.what === f.name)) scoped.push({ what: f.name, min: Number(m[1]) });
  }
  if (scoped.length && fams.length > 1) {
    if (age != null) {
      const ok = scoped.filter((s) => age >= s.min).map((s) => s.what);
      const no = scoped.filter((s) => age < s.min).map((s) => s.what + " (" + s.min + "+)");
      if (!no.length) return { text: "Yes. The age rules they publish all allow " + age + ".", state: { topic: "age" } };
      return { text: (ok.length ? "Yes for " + list(ok, 2) + ", but not " : "Not for ") + list(no, 2) + ".", state: { topic: "age" } };
    }
    return { text: "It depends: " + list(scoped.map((s) => s.what + " is " + s.min + "+"), 2) + ".", state: { topic: "age" } };
  }
  const rule = ageRule(ctx.item);
  if (!rule) return { text: noFact(ctx, "an age limit"), state: { topic: "age" } };
  if (rule.min != null && age != null) {
    if (age >= rule.min) return { text: "Yes, " + age + " is old enough. Their minimum age is " + rule.min + ".", state: { topic: "age" } };
    return { text: "No, their minimum age is " + rule.min + ".", state: { topic: "age" } };
  }
  if (rule.min != null) return { text: "Their minimum age is " + rule.min + ".", state: { topic: "age" } };
  if (/\b(all ages|family.friendly|kids welcome|children welcome)\b/i.test(rule.line)) return { text: "Yes. " + sentence(rule.line), state: { topic: "age" } };
  return { text: "No minimum age is published. " + sentence(rule.line), state: { topic: "age" } };
}

/**
 * Each row: how a guest asks it, the lines that answer it, the gap sentence when nothing does, and lines whose
 * words match but mean something else. A guest asking whether a boat is wheelchair accessible was read "A
 * perfect end to your day may include dinner at one of the area restaurants that are accessible by boat",
 * because "accessib" matched and nothing checked which sense of the word it was.
 */
const RULE_TOPICS: [RegExp, RegExp, string, RegExp?][] = [
  [/swim/i, /swim/i, "a swimming rule"],
  [/\b(dogs?|pets?|puppy|service animal)\b/i, /\b(dogs?|pets?|service animals?)\b/i, "a pet policy"],
  [/licen[sc]e|permit|boater/i, /licen[sc]e|permit|boater|certif/i, "a licence rule"],
  [/experience|beginner|first.?time|new to|never/i, /no experience|experience (is )?(not )?(required|necessary|needed)|beginners?|first.?time|novice|all (skill|experience) levels|certification required|requires? .*certification/i, "an experience rule"],
  [/weight|lbs|pound/i, /weight|lbs?|pound/i, "a weight limit"],
  [/height|how tall/i, /height|tall|inches|cm\b/i, "a height limit"],
  [/pregnan/i, /pregnan/i, "a pregnancy rule"],
  // "Accessible by boat", "accessible by car" and "accessible from the highway" are about getting there.
  [/wheelchair|disab|accessib|mobility/i, /wheelchair|disab|accessib|mobility/i, "an accessibility note", /\baccessib\w*\s+(by|from|via)\b/i],
  [/shoes?|socks?|dress code|what to wear/i, /shoes?|socks?|footwear|attire|dress/i, "a dress rule"],
];

function rulesAnswer(ctx: CompanyContext, q: string): { text: string; state: ChatState } {
  for (const [ask, find, missing, otherSense] of RULE_TOPICS) {
    if (!ask.test(q)) continue;
    const qw = words(q).filter((w) => w.length > 3);
    const lines = corpus(ctx.item).filter((l) => find.test(l) && !(otherSense && otherSense.test(l)));
    const scored = lines.map((l) => ({ l, n: qw.filter((w) => words(l).includes(w)).length })).sort((a, b) => b.n - a.n);
    const named = matchOffer(offersOf(ctx), q);
    if (named && scored.length && scored[0].n === 0) {
      return { text: "They don't publish " + missing.replace(/^an? /, "a ").replace(/^a ([aeiou])/, "an $1") + " for " + named.family + ". " + nextStep(ctx), state: { topic: "rules" } };
    }
    const line = scored.length ? clip(scored[0].l) : null;
    if (line) {
      const lead = /\b(not required|not necessary|no experience|no need|don't need|do not need|not needed|all (skill|experience) levels|beginners? welcome)\b/i.test(line) ? "No. " : /\b(must|required|need to|have to)\b/i.test(line) ? "Yes. " : "";
      return { text: lead + sentence(line), state: { topic: "rules" } };
    }
    return { text: "They haven't published " + missing + ". " + nextStep(ctx), state: { topic: "rules" } };
  }
  const reqs = ctx.item.requirements || [];
  if (reqs.length) {
    const more = reqs.length - 1;
    return { text: sentence(clip(reqs[0])) + (more > 0 ? " " + more + " more rule" + (more > 1 ? "s" : "") + " on this page." : ""), state: { topic: "rules" } };
  }
  return { text: noFact(ctx, "entry rules"), state: { topic: "rules" } };
}

function bringAnswer(ctx: CompanyContext): { text: string; state: ChatState } {
  const bring = ctx.item.bring || [];
  if (bring.length) return { text: factList(bring, "Bring "), state: { topic: "bring" } };
  const line = findLine(ctx.item, /\b(bring|socks|towel|sunscreen|closed.toe)\b/i);
  if (line) return { text: sentence(line), state: { topic: "bring" } };
  return { text: noFact(ctx, "a what-to-bring list"), state: { topic: "bring" } };
}

function includedAnswer(ctx: CompanyContext, q = ""): { text: string; state: ChatState } {
  const specific = q.match(/life ?jackets?|bathroom|restroom|wifi|food|drinks?|alcohol|\bbar\b|byob|towels?|snacks?|water|lunch|gear|helmet|shoes?/i);
  if (specific) {
    const faq = faqMatch(ctx.item, q);
    if (faq) return { text: faq, state: { topic: "included" } };
    const key = specific[0].toLowerCase().replace(/s$/, "").replace(/life ?jacket/, "life ?jacket|pfd");
    const line = findLine(ctx.item, new RegExp(key, "i"));
    if (line) return { text: sentence(upper1(line)), state: { topic: "included" } };
    return { text: "They don't mention " + specific[0].toLowerCase() + " in what they publish. " + nextStep(ctx), state: { topic: "included" } };
  }
  if (ctx.item.includes.length) return { text: factList(ctx.item.includes, "Included: "), state: { topic: "included" } };
  const line = findLine(ctx.item, /\b(included?|provided|supplied)\b/i);
  if (line) return { text: sentence(line), state: { topic: "included" } };
  return { text: noFact(ctx, "what's included"), state: { topic: "included" } };
}

function cancelAnswer(ctx: CompanyContext): { text: string; state: ChatState } {
  const pols = ctx.item.policies || [];
  const pol = pols.find((p) => /cancel/i.test(p)) || pols.find((p) => /refund|reschedul|no.?show/i.test(p));
  if (pol) return { text: sentence(clip(pol, 170)), state: { topic: "cancel" } };
  if (ctx.item.cancellation) return { text: sentence(clip(ctx.item.cancellation, 170)), state: { topic: "cancel" } };
  if (ctx.item.fc) return { text: sentence(clip(ctx.item.fc, 120)), state: { topic: "cancel" } };
  const line = findLine(ctx.item, /cancel|refund|reschedul/i);
  if (line) return { text: sentence(line), state: { topic: "cancel" } };
  return { text: noFact(ctx, "a cancellation policy"), state: { topic: "cancel" } };
}

function rainAnswer(ctx: CompanyContext, q: string): { text: string; state: ChatState } {
  if (/\b(forecast|will it|going to rain|weather (tomorrow|today))\b/i.test(q)) {
    return { text: "I can't check the forecast. I only know what " + ctx.item.title + " publishes.", state: { topic: "outOfScope" } };
  }
  const line = findLine(ctx.item, /rain|weather|wind|storm|lightning|inclement/i);
  if (line) return { text: sentence(line), state: { topic: "rainPolicy" } };
  return { text: "They haven't published a bad-weather policy. " + nextStep(ctx), state: { topic: "rainPolicy" } };
}

function meetAnswer(ctx: CompanyContext, q: string): { text: string; state: ChatState } {
  if (/parking|park my car/i.test(q)) {
    const line = findLine(ctx.item, /parking/i);
    if (line) return { text: sentence(line), state: { topic: "meet" } };
    return { text: "Parking isn't in what they publish. " + nextStep(ctx), state: { topic: "meet" } };
  }
  if (/check.?in/i.test(q) && ctx.item.checkin) return { text: sentence(clip(ctx.item.checkin, 150)), state: { topic: "meet" } };
  if (ctx.item.meetingPoint) {
    const mp = clip(ctx.item.meetingPoint, 120).replace(/^at\s+/i, "");
    return { text: /^(check|meet|arrive|go to|report|head)/i.test(mp) ? sentence(upper1(mp)) : "Meet at " + lower1(mp) + ".", state: { topic: "meet" } };
  }
  const addr = ctx.contact ? addressLine(ctx.contact) : null;
  if (addr) return { text: "They're at " + addr + ".", state: { topic: "meet" } };
  return { text: "They're in " + ctx.item.area + ", but no street address is published. " + nextStep(ctx), state: { topic: "meet" } };
}

/** The consolidated deal in guest words: its title and one sentence when the sync wrote them, else the raw text. */
function dealWords(p: Promo): string {
  const t = (p as Promo & { title?: string; detail?: string }).title;
  const d = (p as Promo & { title?: string; detail?: string }).detail;
  return t && d ? t + ". " + d : t || d || p.text;
}

function dealsAnswer(ctx: CompanyContext): { text: string; state: ChatState } {
  const promos = (ctx.item.promos || []).filter((p) => /[a-z]{3}/.test(p.text));
  if (!promos.length) return { text: "No deals published right now. The price on this page is what you pay.", state: { topic: "deals" } };
  const rank = (p: Promo) => (/\$\d/.test(p.text) ? 2 : 0) + (p.text.length >= 30 ? 1 : 0);
  const priced = (list: Promo[]) => [...list].sort((a, b) => rank(b) - rank(a) || a.days.length - b.days.length);
  const today = priced(todaysDeals(ctx.item).filter((p) => promos.includes(p)));
  if (today.length) {
    const p = today[0];
    const more = today.length - 1;
    return { text: "Today: " + sentence(clip(dealWords(p), 100) + (p.end ? " until " + clock12(p.end) : "")) + (p.code ? " Use code " + p.code + "." : "") + (more ? " " + more + " more deal" + (more > 1 ? "s" : "") + " on today." : ""), state: { topic: "deals" } };
  }
  const p = priced(promos)[0];
  // A dated deal runs on its date; an empty day list there does not mean every day.
  const when = p.date ? p.date : dayLabel(p.days);
  return { text: "Nothing today. " + when + ": " + sentence(clip(dealWords(p), 100)) + (p.code ? " Use code " + p.code + "." : ""), state: { topic: "deals" } };
}

function waiverAnswer(ctx: CompanyContext): { text: string; state: ChatState } {
  if (ctx.item.waiverUrl) return { text: "Yes, there's an online waiver, and the link on this page lets you sign before you arrive.", state: { topic: "waiver" } };
  const line = findLine(ctx.item, /waiver|liabilit|release form/i);
  if (line) return { text: sentence(line), state: { topic: "waiver" } };
  return { text: "No waiver is mentioned in what they publish. " + nextStep(ctx), state: { topic: "waiver" } };
}

function contactAnswer(ctx: CompanyContext): { text: string; state: ChatState } {
  const phone = shopPhone(ctx);
  if (phone) return { text: "Call " + phone + ".", state: { topic: "contact" } };
  return { text: "They haven't published a phone number. A booking request on this page reaches them directly.", state: { topic: "contact" } };
}

function describeAnswer(ctx: CompanyContext, q: string): { text: string; state: ChatState } {
  const hit = matchOffer(offersOf(ctx), q);
  if (hit) {
    const price = hasPrice(hit.price) ? " It's " + priceOf(hit) + "." : "";
    if (hit.desc && /[a-z]{3}/.test(hit.desc)) return { text: sentence(clip(hit.desc, 140)) + price, state: { topic: "describe", family: hit.family, offer: hit.name } };
    const dur = hit.minutes ? " Runs " + fmtDur(hit.minutes) + "." : "";
    return { text: offerLabel(hit) + "." + (price || dur), state: { topic: "describe", family: hit.family, offer: hit.name } };
  }
  const thing = askedThing(q.replace(/tell me about|what about|how about/i, "info for").replace(/^and\s+/i, ""));
  if (thing) {
    const name = /\sone$/.test(thing) ? thing.replace(/\s+one$/, "") + " option" : thing;
    return { text: "They don't list " + (/^[aeiou]/.test(name) ? "an " : "a ") + name + ". Want to see what they do offer?", state: { topic: "describe" } };
  }
  if (ctx.item.blurb) return { text: sentence(clip(ctx.item.blurb, 150)), state: { topic: "describe" } };
  return { text: noFact(ctx, "a description"), state: { topic: "describe" } };
}

/* ---------- the operator's own FAQ ---------- */

function faqMatch(item: Unclaimed, q: string): string | null {
  if (!item.faq?.length) return null;
  const qw = words(q);
  if (qw.length < 2) return null;
  let best: { score: number; a: string } | null = null;
  for (const f of item.faq) {
    const fw = new Set(words(faqText(f.q)));
    let hit = 0;
    for (const w of qw) if (fw.has(w)) hit += 1;
    const score = hit / Math.max(2, Math.min(qw.length, fw.size));
    if (hit >= 2 && score >= 0.5 && (!best || score > best.score)) best = { score, a: faqText(f.a) };
  }
  return best ? sentence(clip(best.a, 190)) : null;
}

/* ---------- chips ---------- */

const CHIP = {
  price: "How much is it?",
  list: "What do you offer?",
  open: "Are you open right now?",
  cancel: "Can I cancel?",
  included: "What's included?",
  bring: "What should I bring?",
  meet: "Where do we meet?",
  duration: "How long is it?",
  age: "Is it ok for kids?",
  deals: "Any deals on?",
  waiver: "Do I sign a waiver?",
  book: "Can I book now?",
  next: "When's the next opening?",
  sunday: "Are you open Sunday?",
  rules: "Any other rules?",
};

function chipsFor(ctx: CompanyContext, topic: Topic | undefined): string[] {
  const { item } = ctx;
  const has = {
    hours: !!weekFor(ctx) || !!hourLines(item).length,
    cancel: !!(item.cancellation || item.policies?.length || item.fc),
    included: item.includes.length > 0,
    bring: !!item.bring?.length,
    rules: !!item.requirements?.length,
    deals: !!item.promos?.length,
    waiver: !!item.waiverUrl,
    offers: offersOf(ctx).length > 0,
    live: liveSlots(ctx).length > 0,
  };
  const pool: string[] = [];
  const push = (...c: string[]) => { for (const x of c) if (x && !pool.includes(x)) pool.push(x); };

  if (has.live) push(CHIP.next);
  switch (topic) {
    case "price":
    case "priceOf":
    case "cheapest":
    case "fee":
      push(CHIP.duration, has.included ? CHIP.included : "", has.cancel ? CHIP.cancel : "", has.hours ? CHIP.open : "");
      break;
    case "list":
    case "describe":
      push(CHIP.price, CHIP.duration, has.included ? CHIP.included : "", has.hours ? CHIP.open : "");
      break;
    case "openNow":
    case "closeTime":
    case "dayHours":
    case "holidayHours":
    case "slot":
    case "book":
      push(CHIP.sunday, CHIP.price, CHIP.meet, has.offers ? CHIP.list : "");
      break;
    case "age":
    case "rules":
    case "group":
      push(has.rules ? CHIP.rules : "", CHIP.price, has.bring ? CHIP.bring : "", has.hours ? CHIP.open : "");
      break;
    case "included":
    case "bring":
      push(CHIP.price, CHIP.duration, CHIP.meet, has.cancel ? CHIP.cancel : "");
      break;
    case "cancel":
      push(has.waiver ? CHIP.waiver : "", CHIP.price, CHIP.book, CHIP.meet);
      break;
    case "meet":
      push(has.hours ? CHIP.open : "", CHIP.price, CHIP.book, CHIP.duration);
      break;
    case "deals":
      push(CHIP.price, CHIP.book, has.hours ? CHIP.open : "", has.offers ? CHIP.list : "");
      break;
    default:
      push(CHIP.price, has.offers ? CHIP.list : "", has.hours ? CHIP.open : "", has.cancel ? CHIP.cancel : "");
  }
  push(CHIP.price, has.offers ? CHIP.list : "", has.hours ? CHIP.open : "", CHIP.meet, has.deals ? CHIP.deals : "");
  return pool.slice(0, 4);
}

/** The chips a listing starts with: price, what's included, hours, cancellation, adapted to what is published. */
export function companySuggestions(ctx: CompanyContext): string[] {
  const { item } = ctx;
  const out: string[] = [];
  if (offersOf(ctx).some((o) => hasPrice(o.price)) || item.from != null) out.push(CHIP.price);
  if (item.includes.length) out.push(CHIP.included);
  else if (offersOf(ctx).length) out.push(CHIP.list);
  if (weekFor(ctx) || hourLines(item).length) out.push(CHIP.open);
  if (item.promos?.length) out.push(CHIP.deals);
  if (item.cancellation || item.policies?.length || item.fc) out.push(CHIP.cancel);
  if (item.requirements?.length) out.push(CHIP.age);
  if (item.bring?.length) out.push(CHIP.bring);
  out.push(CHIP.meet);
  if (offersOf(ctx).length || item.blurb) out.push(CHIP.list);
  if (shopPhone(ctx)) out.push("What's your phone number?");
  return [...new Set(out)].slice(0, 4);
}

export function companyGreeting(ctx: CompanyContext): string {
  return "Hi, I'm " + ASSISTANT_NAME + ". Ask me anything about " + ctx.item.title + ". I answer from what they publish.";
}

/**
 * Whether this listing offers Otto to guests. The Assistant page's switch writes `assistant` through the
 * catalog patch; an unclaimed listing carries no such key and is on, which is what every listing did before
 * the switch was wired up. Only an explicit false turns it off, so a patch that predates the key reads as on.
 */
export function assistantOn(item: Unclaimed): boolean {
  return item.assistant !== false;
}

/**
 * What a guest is told in a thread the operator has since switched Otto off in. The thread itself stays, so
 * nobody is cut off mid-question; the next step is the shop, the same one contactAnswer offers.
 */
export function companyHandoff(ctx: CompanyContext): string {
  const phone = shopPhone(ctx);
  return ctx.item.title + " answers questions themselves. " + (phone ? "Call " + phone + "." : "A booking request on this page reaches them directly.");
}

/* ---------- the engine ---------- */

const FEE_LINE = "Outset adds a service fee at checkout: 5% up to $100, 4% from $100 to $500, 3% above $500, capped at $25.";

function answerOne(ctx: CompanyContext, topic: Topic, q: string, prev: ChatState): { text: string; state: ChatState } {
  switch (topic) {
    case "greet": return { text: "Hey. Ask me about prices, hours, what's included or where to meet.", state: {} };
    case "thanks": return { text: "Any time. Pick a time on this page when you're ready to book.", state: prev };
    case "price": return priceAnswer(ctx);
    case "priceOf": return priceOfAnswer(ctx, q, prev);
    case "fee": return { text: FEE_LINE, state: { topic: "fee" } };
    case "cheapest": {
      const priced = offersOf(ctx).filter((o) => hasPrice(o.price)).sort((a, b) => (a.price as number) - (b.price as number));
      if (!priced.length) return priceAnswer(ctx);
      const o = priced[0];
      return { text: "The " + offerLabel(o) + " at " + priceOf(o) + ".", state: { topic: "cheapest", family: o.family, offer: o.name } };
    }
    case "list": return listAnswer(ctx, q);
    case "duration": return durationAnswer(ctx, q, prev);
    case "openNow": return openNowAnswer(ctx);
    case "closeTime": return closeTimeAnswer(ctx, q);
    case "dayHours": return dayHoursAnswer(ctx, q, prev);
    case "holidayHours": {
      const open = (weekFor(ctx) || []).find((d) => d && d.close > 0);
      // A shop that publishes no hours at all has not published a week either, so say that instead.
      if (!open && !hourLines(ctx.item).length) return { text: noFact(ctx, "opening hours"), state: { topic: "holidayHours" } };
      const usual = open ? " Their published week runs " + spanLabel(open) + " on the days they list." : " " + nextStep(ctx);
      return { text: "They publish a normal week, not holiday hours, so I can't say." + usual, state: { topic: "holidayHours" } };
    }
    case "slot": return slotAnswer(ctx, q, prev);
    case "book": return bookAnswer(ctx, q);
    case "group": return groupAnswer(ctx, q);
    case "age": return ageAnswer(ctx, q);
    case "rules": return rulesAnswer(ctx, q);
    case "bring": return bringAnswer(ctx);
    case "included": return includedAnswer(ctx, q);
    case "cancel": return cancelAnswer(ctx);
    case "rainPolicy": return rainAnswer(ctx, q);
    case "meet": return meetAnswer(ctx, q);
    case "deals": return dealsAnswer(ctx);
    case "waiver": return waiverAnswer(ctx);
    case "contact": return contactAnswer(ctx);
    case "describe": return describeAnswer(ctx, q);
    case "ack": return { text: "Anything else? I can check prices, hours or what to bring.", state: prev };
    case "next": {
      const slots = liveSlots(ctx);
      if (slots.length) return { text: "Next open time is " + slotLine(slots[0]) + ".", state: { topic: "slot" } };
      const week = weekFor(ctx);
      const clock = clockIn(zoneFor(ctx.item));
      const next = nextOpenDay(week, clock.day);
      const today = week?.[clock.day];
      if (today && today.close > 0 && clock.minutes < today.open) return { text: "I can't see their live times, but they open today at " + clockLabel(today.open) + ".", state: { topic: "slot" } };
      if (next) return { text: "I can't see their live times. Next day they're open is " + DAY_NAMES[next.day] + ", from " + clockLabel(next.span.open) + ".", state: { topic: "slot", day: next.day } };
      return { text: "I can't see their live times. Pick a date on this page and they confirm it.", state: { topic: "slot" } };
    }
    case "walkin": {
      const line = findLine(ctx.item, /walk.?ins?|reservations? (are )?(required|recommended|needed)|by appointment|appointment only|book(ing)? (ahead|in advance)|advance (booking|reservation)/i);
      if (line) return { text: sentence(upper1(line)), state: { topic: "walkin" } };
      return { text: "They don't say whether they take walk-ins. Booking ahead on this page is the safe bet.", state: { topic: "walkin" } };
    }
    case "pets": return rulesAnswer(ctx, q);
    case "search": {
      const faq = faqMatch(ctx.item, q);
      if (faq) return { text: faq, state: { topic: "describe" } };
      const qw = words(q).filter((w) => w.length >= 4);
      const scored = corpus(ctx.item).map((l) => ({ l, n: qw.filter((w) => words(l).includes(w)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
      if (scored.length && (scored[0].n >= 2 || (qw.length <= 2 && scored[0].n === qw.length))) return { text: sentence(upper1(clip(scored[0].l))), state: { topic: "describe" } };
      return { text: "I'm not sure what you mean. I can answer prices, hours, what's included, rules or where to meet.", state: prev };
    }
    case "outOfScope": return { text: "I only know what " + ctx.item.title + " publishes, so I can't help with that.", state: { topic: "outOfScope" } };
    default: return { text: "Ask me about prices, what they offer, hours, rules or where to meet.", state: { topic: "unknown" } };
  }
}

const HARD_FACT: Topic[] = ["price", "priceOf", "cheapest", "openNow", "closeTime", "dayHours", "slot", "fee"];

/** One answer, its follow-up chips, and what it was about. */
export function companyAnswer(ctx: CompanyContext, question: string, prev: ChatState = {}): Answer {
  const q = question.trim();
  if (!q) return { text: companyGreeting(ctx), chips: companySuggestions(ctx), state: prev };

  const topics = readQuestion(ctx, q, prev);

  if (topics[0] === "outOfScope" || ((OUT_OF_SCOPE.test(q) || SOMEONE_ELSE.test(q)) && (!topics.some((t) => IN_SCOPE_ANYWAY.includes(t)) || namesSomeoneElse(ctx, q)))) {
    const faq = faqMatch(ctx.item, q);
    if (faq) return { text: faq, chips: chipsFor(ctx, prev.topic), state: { topic: "describe" } };
    const out = answerOne(ctx, "outOfScope", q, prev);
    return { text: out.text, chips: chipsFor(ctx, undefined), state: out.state };
  }

  // The operator's own FAQ beats anything we assemble, unless we hold a harder fact (a price, a time).
  if (topics[0] !== "greet" && topics[0] !== "thanks" && !HARD_FACT.includes(topics[0])) {
    const faq = faqMatch(ctx.item, q);
    if (faq) return { text: faq, chips: chipsFor(ctx, topics[0]), state: { topic: topics[0] } };
  }

  const first = answerOne(ctx, topics[0], q, prev);
  let text = first.text;
  // Two questions in one ("how much and how long") get one short sentence each, never more.
  const compound = /\band\b|,|\+/.test(q.toLowerCase().replace(/^and\b/, ""));
  if (compound && topics.length > 1 && topics[1] !== "unknown") {
    const second = answerOne(ctx, topics[1], q, { ...prev, ...first.state });
    const lead = (t: string) => (t.match(/^.*?[.!?](?=\s|$)/) || [t])[0];
    const a = lead(first.text);
    const b = lead(second.text);
    const gapA = a.match(/^They haven't published (.*)\.$/);
    const gapB = b.match(/^They haven't published (.*)\.$/);
    const subject = offersOf(ctx).find((o) => o.name === first.state.offer);
    if (gapA && gapB) text = "They haven't published " + gapA[1] + " or " + gapB[1] + ". " + nextStep(ctx);
    else if (["price", "priceOf", "cheapest"].includes(topics[0]) && topics[1] === "duration" && subject?.minutes && hasPrice(subject.price)) {
      text = (topics[0] === "price" ? "From " : "") + priceOf(subject) + (topics[0] === "price" ? " for the " + subject.name : " for " + subject.name) + ", and it runs " + fmtDur(subject.minutes) + ".";
    }
    else if (b && b !== a) text = a + " " + (first.state.family && b.startsWith(first.state.family + " ") ? "It " + b.slice(first.state.family.length + 1) : b);
  }
  return { text: upper1(text), chips: chipsFor(ctx, first.state.topic || topics[0]), state: { ...prev, ...first.state } };
}

/** Text-only answer, for callers that keep no conversation state. */
export function companyReply(ctx: CompanyContext, question: string): string {
  return companyAnswer(ctx, question).text;
}

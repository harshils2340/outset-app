import { explainTerms, type Explained } from "./glossary.ts";

/**
 * What a guest reads for a service and its price tiers. Operators write menus for regulars and site builders cut them
 * short: "Tent Site w/o water & electric =", "6 × 1-Hour Sessions:", "bounce house 10×10 bounce house",
 * "3-3.5 hours total tour time from check-in, 4-4.5 hours with ". This module turns those into plain labels
 * ("Tent site without water & electric", "6 one-hour sessions", "10 × 10 ft", "3 to 3.5 hours total tour time from
 * check-in") and nothing more.
 *
 * The rule is the same as everywhere in sync: formatting only. Words are expanded, repeated, trimmed or re-cased, a
 * clause the crawl cut mid-way is dropped, and a label that is not a bookable thing at all (an event timetable, a
 * loading spinner) is refused. No price, size, time or detail is ever added that the operator did not write.
 */

export type RawVariant = { label: string; price: number | null; per?: string; optionIdx: number };
export type RawService = { name: string; desc: string | null; photo?: string; variants: RawVariant[] };
export type PlainVariant = RawVariant & { explain?: Explained[]; moreOptions?: true };
export type PlainService = { name: string; desc: string | null; photo?: string; variants: PlainVariant[]; explain?: Explained[] };

/** What a variant is called when its own words were empty or refused. The page has always shown this word. */
export const STANDARD = "Standard";

/* ---------- small helpers ---------- */

const NUM_WORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const UNIT_OF: Record<string, string> = { hr: "hour", hrs: "hour", hour: "hour", hours: "hour", h: "hour", min: "minute", mins: "minute", minute: "minute", minutes: "minute", day: "day", days: "day", night: "night", nights: "night", week: "week", weeks: "week", wk: "week", wks: "week", month: "month", months: "month", mo: "month", mos: "month", year: "year", years: "year", yr: "year", yrs: "year" };
const UNIT_RE = "(hours?|hrs?|minutes?|mins?|days?|nights?|weeks?|wks?|months?|years?|yrs?)";

/** Acronyms that stay in capitals when a shouted label is brought down to sentence case. */
const ACRONYM = new Set(["RV", "ATV", "UTV", "SUP", "PWC", "USCG", "PFD", "BYOB", "VIP", "GA", "AM", "PM", "US", "USA", "CA", "CAD", "USD", "HP", "PADI", "AFF", "USPA", "BJJ", "MMA", "HIIT", "YTT", "VR", "ADA", "CBD", "ID", "GPS", "DJ", "TV", "BBQ", "XL", "XXL", "LED", "NYC", "LA", "BC", "ON", "FL", "TX", "UK", "EV", "FAA", "EASA", "ASA", "R44", "R22", "II", "III", "IV", "PGA", "LPGA", "YMCA", "LLC", "QR", "UV"]);

/** Short everyday words a shouted label writes in capitals. Any other two or three capitals are kept as an acronym. */
const SHORT_WORD = new Set("a an as at be by do go he if in is it me my no of oh on or so to up us we am pm ft hr the and for per day fee kid kids fun all any are big box can cap car cup dry each far few get had has her him his hot how its let low man max may min mix new not now off old one our out own pay pet put ran raw red run sea see set she sit six ski spa sun tax ten tip top two use van via war way wet who why yes yet you age air art bar bay bed bus cat dog ear eat egg end eye fly gym hat ice jet lab lap leg lot map mom dad net nut oil pad pan pen pie pin pit pot row rod saw shy sip sky son tag tea tee tie toe toy tub vip ale gin rum ipa hut inn lake half full rent".split(" "));

/** Everyday words a menu writes in Title Case. In a label they read better lower case; anything else (a boat's name, a place) keeps its capital. */
const COMMON = new Set(
  (
    "a an and or of the to in on at by for with without from per plus includes including not up over under only each " +
    "adult adults child children kid kids youth junior juniors senior seniors student students teen teens infant infants toddler toddlers guest guests person people rider riders passenger passengers player players " +
    "family group groups private public shared standard regular basic premium deluxe classic general admission ticket tickets entry pass passes day days half full weekday weekdays weekend weekends evening morning afternoon night nights hour hours minute minutes session sessions class classes lesson lessons " +
    "rental rentals rent boat boats kayak kayaks canoe canoes paddleboard paddleboards board boards bike bikes tour tours trip trips ride rides cruise cruises sail flight flights jump jumps charter charters package packages " +
    "single double triple tandem second first third extra additional add-on add-ons option options site sites tent tents cabin cabins campsite campsites water electric electricity sewer hookup hookups amp " +
    "court courts lane lanes game games round rounds hole holes cart carts bucket buckets range time times slot slots " +
    "bounce house houses combo slide slides castle inflatable enclosed open covered indoor outdoor small medium large big mini " +
    "massage facial treatment treatments membership monthly annual yearly season seasonal daily hourly weekly total experience with water surcharge fee fees deposit no free sunset sunrise"
  ).split(" "),
);

/** Nouns that turn "2 hour" into "2-hour" when they follow: "2-hour tour", but "2 hours" when nothing follows. */
const COMPOUND_NOUN = /^(?:tours?|trips?|charters?|rentals?|sessions?|classes?|lessons?|rides?|cruises?|sails?|flights?|packages?|pass(?:es)?|experiences?|adventures?|excursions?|hikes?|massages?|facials?|treatments?|party|parties|fishing|jumps?|rounds?|blocks?|workshops?|camps?|programs?|courses?|clinics?|visits?|hunts?|safaris?|outings?|paddles?|floats?|boat|kayak|jet|pontoon|window|minimum|slot|slots|intensive|retreats?|stays?|trail)$/i;

const pluralUnit = (unit: string, n: number) => unit + (n === 1 ? "" : "s");

/** A run of text written in capitals: at least six letters, more than 70% capital, two words or more. */
function isShouted(t: string): boolean {
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6) return false;
  if (t.trim().split(/\s+/).filter((w) => /[A-Za-z]{2}/.test(w)).length < 2 && letters.length < 10) return false;
  return (t.match(/[A-Z]/g) || []).length / letters.length > 0.7;
}

function capFirst(t: string): string {
  // Only a label that opens on a word gets a capital: "10 × 10 ft" and "3 to 3.5 hours" stay as they are.
  const m = t.match(/^([("'“‘]*)([a-z])/);
  if (!m) return t;
  // "iFLY", "eBike" are brands; leave a lower-case letter followed by a capital alone.
  if (/^[a-z][A-Z]/.test(t.slice(m[1].length, m[1].length + 2))) return t;
  return m[1] + m[2].toUpperCase() + t.slice(m[0].length);
}

/** Shouting down to sentence case; acronyms, tokens with digits (R44, 13HP) and the first letter keep capitals. */
function sentenceCase(t: string): string {
  // Two or three capitals that are not an everyday word ("HPA", "DLX", "BBQ") are an acronym; "THE", "DAY" and "FEE" are words.
  const out = t.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => ((ACRONYM.has(w.toUpperCase()) && w.length <= 5) || (/^[A-Z]{2,3}$/.test(w) && !SHORT_WORD.has(w.toLowerCase())) ? w : w.toLowerCase()));
  return capFirst(out);
}

/** Names that are capitalised in any sentence, so they never count for or against Title Case. */
const PROPER = /^(?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|i)$/i;

/** Two or more words and nearly all of them capitalised: the site wrote a heading. */
function isTitleCase(t: string): boolean {
  const words = (t.match(/[A-Za-z][A-Za-z'’-]*/g) || []).filter((w) => !PROPER.test(w));
  const big = words.filter((w) => w.length > 3 || /^[A-Z]/.test(w));
  return big.length >= 2 && big.filter((w) => /^[A-Z]/.test(w)).length / big.length >= 0.8;
}

/**
 * Everyday words a menu capitalised go lower case ("Second Tent" -> "Second tent", "Weekend Adult Ticket" ->
 * "Weekend adult ticket"); names keep their capitals. A label written wholly in Title Case that carries words we
 * cannot judge ("Kiddie Fun Hour", "Early Bird Tickets") stays in Title Case instead, and the words this module wrote
 * ("hours", "to") follow suit, so a label is never half one style and half the other.
 */
function calmCase(t: string, titleCased: boolean): string {
  const tokens = [...t.matchAll(/[A-Za-z][A-Za-z'’-]*/g)];
  const startsOnWord = (at: number) => /^[\s("'“‘]*$/.test(t.slice(0, at)) || /[.!?:]\s+$/.test(t.slice(0, at));
  const capital = (w: string) => /^[A-Z][a-z'’-]+$/.test(w);
  const isCommon = (w: string) => COMMON.has(w.toLowerCase().replace(/['’]s$/, ""));
  const allCommon = tokens.every((m) => startsOnWord(m.index!) || !capital(m[0]) || PROPER.test(m[0]) || isCommon(m[0]));
  if (!allCommon && !titleCased) return capFirst(t);
  if (allCommon) {
    const out = t.replace(/[A-Za-z][A-Za-z'’-]*/g, (w, at: number) => (!startsOnWord(at) && capital(w) && !PROPER.test(w) && isCommon(w) ? w.toLowerCase() : w));
    return capFirst(out);
  }
  // Title Case kept: only the unit words this module wrote in lower case take a capital ("3 Hours Unlimited Riding").
  const out = t.replace(/[A-Za-z][A-Za-z'’-]*/g, (w) => (/^(?:hours?|minutes?|days?|nights?|weeks?|months?|years?|people)$/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w));
  return capFirst(out);
}

/* ---------- words ---------- */

/** Abbreviations a guest has to decode. Order matters: "w/o" before "w/", "hrs" before "hr". */
export function expandAbbreviations(t: string): string {
  return (
    t
      .replace(/\bw\/o\b\.?|\bw\/out\b/gi, "without")
      .replace(/\bw\/\s*(?=[A-Za-z0-9$(])/gi, "with ")
      .replace(/\bincl\.?(?=\s|$|\)|,)/gi, "includes")
      .replace(/\binc\.(?=\s+[a-z])/g, "includes")
      .replace(/\bexcl?\.?(?=\s|$|\)|,)/gi, "not including")
      .replace(/\bapprox\.?(?=\s*\d)/gi, "about")
      .replace(/\bapprox\.?(?=\s|$)/gi, "approximately")
      .replace(/\b(?:pp|p\/p|per pers\.?)(?=\s|$|\)|,|\.)/gi, "per person")
      .replace(/(\d)\s*ppl\b/gi, "$1 people")
      .replace(/\bppl\b/gi, "people")
      .replace(/(\d)\s*pax\b/gi, "$1 people")
      .replace(/(\d)\s*\+\s*yrs?\b\.?/gi, "$1+ years")
      .replace(/\belec\.?(?=\s|$|,)/gi, "electric")
      .replace(/\bhook[- ]up(s?)\b/gi, "hookup$1")
      .replace(/\bea\.?(?=\s*$|\s*\))/g, "each")
      .replace(/\bmin\.?\s+(?=\d)/gi, "minimum ")
      // "M-F", "M-TH", "Tu-Th": day codes read as days.
      .replace(/\b(M|Mon|T|Tu|Tue|Tues|W|Wed|Th|Thu|Thur|Thurs|F|Fri|Sa|Sat|Su|Sun)\.?\s*[-–—]\s*(TH|Th|Thu|Thur|Thurs|F|Fri|Sa|Sat|Su|Sun|W|Wed)\b\.?/g, (m, a: string, b: string) => {
        const day = (x: string) => ({ m: "Monday", mon: "Monday", t: "Tuesday", tu: "Tuesday", tue: "Tuesday", tues: "Tuesday", w: "Wednesday", wed: "Wednesday", th: "Thursday", thu: "Thursday", thur: "Thursday", thurs: "Thursday", f: "Friday", fri: "Friday", sa: "Saturday", sat: "Saturday", su: "Sunday", sun: "Sunday" } as Record<string, string>)[x.toLowerCase()];
        // A lone "T-F" or "W-F" is ambiguous between days and sizes only when it is lower case; these are capitals by pattern.
        return day(a) && day(b) ? day(a) + " to " + day(b) : m;
      })
  );
}

/** Numbers, lengths and sizes as a guest says them. `sizey` adds "ft" to a bare "10×10" only where sizes mean feet. */
export function tidyNumbers(t: string, sizey: boolean): string {
  let s = t;
  // "6 × 1-Hour Sessions" -> "6 one-hour sessions"; "4 x 90 min massages" -> "4 massages, 90 minutes each".
  s = s.replace(new RegExp("\\b(\\d{1,3})\\s*[×xX]\\s*(\\d{1,3}(?:\\.\\d)?)\\s*[- ]?" + UNIT_RE + "\\.?\\s+([A-Za-z]+?)(s?)\\b", "gi"), (_m, n: string, d: string, u: string, noun: string) => {
    const unit = UNIT_OF[u.toLowerCase()] || u;
    const count = Number(n);
    const len = Number(d);
    const nounPl = noun.toLowerCase() + (count === 1 ? "" : "s");
    if (Number.isInteger(len) && len <= 12) return n + " " + NUM_WORD[len] + "-" + unit + " " + nounPl;
    return n + " " + nounPl + ", " + d + " " + pluralUnit(unit, len) + " each";
  });
  // "2 in 1-13×71": a product name glued to a size.
  s = s.replace(/\b(\d)\s+in\s+(\d)\b\s*-?\s*(?=\d+\s*['′]?\s*[x×X]\s*\d)/g, "$1-in-1, ").replace(/\b(\d)\s+in\s+(\d)\b/g, "$1-in-$2");
  // Sizes: "10×10", "10x20'", "145′ x 56′", "13 X 13 ft".
  s = s.replace(/\b(\d{1,3}(?:\.\d)?)\s*(['′]|ft\.?|feet)?\s*[x×X]\s*(\d{1,3}(?:\.\d)?)\s*(['′]|ft\.?|feet|foot)?(?![A-Za-z0-9])/g, (m, a: string, ua: string | undefined, b: string, ub: string | undefined) => {
    // "4x4" and "6x6" are drive types, not sizes, unless the listing rents things measured in feet.
    if (!sizey && !ua && !ub && a === b && ["2", "4", "6", "8"].includes(a)) return m;
    return a + " × " + b + (ua || ub || sizey ? " ft" : "");
  });
  // Hours, minutes and days: "2 hr - 6 hr" -> "2 to 6 hours"; "3-3.5 hours" -> "3 to 3.5 hours".
  s = s.replace(new RegExp("\\b(\\d+(?:\\.\\d+)?)\\s*" + UNIT_RE + "\\.?\\s*(?:-|–|—|to)\\s*(\\d+(?:\\.\\d+)?)\\s*" + UNIT_RE + "\\b\\.?", "gi"), (m, a: string, ua: string, b: string, ub: string) => {
    const u1 = UNIT_OF[ua.toLowerCase()];
    const u2 = UNIT_OF[ub.toLowerCase()];
    return u1 && u1 === u2 ? a + " to " + b + " " + u2 + "s" : m;
  });
  s = s.replace(new RegExp("\\b(\\d+(?:\\.\\d+)?)\\s*(?:-|–|—)\\s*(\\d+(?:\\.\\d+)?)\\s*" + UNIT_RE + "\\b\\.?(?=(\\s+[A-Za-z]+)?)", "gi"), (m, a: string, b: string, u: string, next: string | undefined) => {
    const unit = UNIT_OF[u.toLowerCase()];
    if (!unit || Number(a) >= Number(b)) return m;
    // "60–75 minute flight" keeps the adjective form the site wrote; "2-3 hour" alone reads "2 to 3 hours".
    const adjective = !/s$/i.test(u) && !!next && !ADJ_STOP.test(next.trim());
    return a + " to " + b + " " + (adjective ? unit : pluralUnit(unit, Number(b)));
  });
  // "2 hour" alone -> "2 hours"; "2 hour tour" -> "2-hour tour"; "1 hours" -> "1 hour"; "2hrs" -> "2 hours".
  // A singular unit followed by a word was written as an adjective ("20 minute plane ride"), so it keeps that form.
  s = s.replace(new RegExp("(?<![\\d/.])(\\d+(?:\\.\\d+)?)(\\s*[- ]?\\s*)" + UNIT_RE + "\\b\\.?(\\s+([A-Za-z][A-Za-z'’]*))?", "gi"), (m: string, n: string, _sep: string, u: string, tail: string | undefined, next: string | undefined, at: number, whole: string) => {
    const base = UNIT_OF[u.toLowerCase()];
    if (!base) return m;
    // "1 Hour" in a name stays capitalised; "4HR" and "hrs" are abbreviations and come out lower case.
    const unit = /^[A-Z][a-z]{2,}/.test(u) ? base.charAt(0).toUpperCase() + base.slice(1) : base;
    const count = Number(n);
    const singular = !/s$/i.test(u) || /^(?:hrs|mins|wks|mos|yrs)$/i.test(u);
    const writtenSingular = !/s$/i.test(u);
    const inRange = /\bto\s*$/.test(whole.slice(0, at));
    const adjective = !!next && !ADJ_STOP.test(next) && ((writtenSingular && singular) || COMPOUND_NOUN.test(next));
    if (adjective && inRange) return n + " " + (writtenSingular ? unit : pluralUnit(unit, count)) + tail;
    if (adjective) return n + "-" + unit + tail;
    return n + " " + pluralUnit(unit, count) + (tail || "");
  });
  return s;
}

/* ---------- judging a label ---------- */

/** A timetable for one event: a date with check-in, a shotgun start, doors or an end time. Not something a guest books a slot of. */
const DATE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i;
const EVENT_WORD = /\bcheck[- ]?in\b|\bshotgun\b|\bdoors? open\b|\btee[- ]?off\b|\bregistration (?:opens?|at|begins?)\b|\bkick[- ]?off\b|\bends\b|\bawards?\b|\bdinner (?:at|to follow)\b|\bprogram (?:begins|starts)\b/i;
export function isEventSchedule(text: string): boolean {
  if (!text) return false;
  return DATE.test(text) && EVENT_WORD.test(text);
}

/** Page furniture and widget states that the crawl stored as a label. */
const NOT_A_LABEL = /\bloading\b|\bjavascript\b|\bclick\b|\bselect (?:a )?date\b|\badd to cart\b|\bbook now\b|\bsold out\b|\bview details\b|\bread more\b|\blearn more\b|\bsee (?:more|details)\b|\bcall for\b|\bno results\b|\bnot available\b|\bundefined\b|\bnull\b|\bNaN\b|\{\{|\}\}/i;
/** Words a label cannot end on: the rest of the phrase was cut off. "and up" and "each" are whole. */
const DANGLING = /(?:\s+|^)(?:and|or|with|without|the|a|an|of|for|to|in|at|by|from|plus|is|are|was|were|be|includes|including|include|per|on|into|&|\+|if|when|than|then|but|as|our|your|their|its|this|that|about|between|through|via|vs\.?|where|which|who|while|will|can|also|starting|starts|approximately|up to|such as|like|any|all|other|some)$/i;
/** Words after a length that do not make it an adjective: "3 hours total", "1 hour and 10 minutes". */
const ADJ_STOP = /^(?:total|each|long|max|maximum|or|and|to|of|per|with|plus|at|in|on|from|for|a|an|the|by|before|after|prior|notice|advance|only|then|including|includes|approx|approximately|about|rate|rates|of|or|free|included|max|away|out|back|between|we|you|is|are|x)$/i;
/** Lower-case short tokens that are words, units or abbreviations rather than the stub of a cut word. */
const SHORT_OK = /^(?:am|pm|ft|us|go|up|in|on|at|to|by|of|or|an|as|is|it|no|me|we|he|oz|lb|kg|km|mi|hp|cc|st|nd|rd|th|x|a|i|ok|tv|dj|pa|bc|on|ca|fl|ny)$/i;

/** True when the crawl cut this text short: a dangling word, a stub token or a time cut mid-number. */
function looksCut(raw: string): boolean {
  const t = raw.replace(/\s+$/, "");
  if (!t) return false;
  if (DANGLING.test(t)) return true;
  if (/\d:\d$/.test(t)) return true;
  // A 60-character crawl field that stops on a space, or on one or two letters that are not a word.
  if (raw.length >= 55 && /\s$/.test(raw) && !/[.!?)]\s*$/.test(raw)) return true;
  // The stub of a cut word is lower case ("about 4 ho", "skill te"); "ID" and "PM" are whole words.
  const last = t.match(/\s([a-z]{1,2})$/);
  if (t.length >= 50 && last && !SHORT_OK.test(last[1])) return true;
  return false;
}

/**
 * Back to the last clause that was finished: before the final comma, semicolon or dash, or else without the dangling
 * tail. Null when there is no finished clause and more than two words would be left: "All rentals require a" and
 * "Get 2 weeks of Unlimited Classes for" were cut before the part that mattered, while "Tickets are" is still "Tickets".
 */
function closeCut(t: string): string | null {
  const s = t.replace(/\s+$/, "");
  const boundary = Math.max(s.lastIndexOf(", "), s.lastIndexOf("; "), s.lastIndexOf(" – "), s.lastIndexOf(" — "), s.lastIndexOf(" - "));
  if (boundary > 0) {
    const head = s.slice(0, boundary).trim();
    if (head.split(/\s+/).length >= 2 && head.length >= s.length * 0.35) return head;
  }
  // "7 hour trip is", "2 Youth Classes for", "Packages start at": the words stopped where the price was, and the page
  // prints that price beside the label. The phrase before it is whole, unless it is a sentence or a policy.
  const PRICE_TAIL = /\s+(?:(?:starts?|begins?|starting|beginning|priced|costs?|runs?)\s+(?:at|from)|is|are|for|at|from|of|=|costs?|just|only|now)$/i;
  if (PRICE_TAIL.test(s)) {
    let head = s;
    for (let i = 0; i < 3 && PRICE_TAIL.test(head); i++) head = head.replace(PRICE_TAIL, "");
    head = head.trim();
    const sentence = /\b(?:can be|could be|incurs?|policy|up to|minimum|maximum|we also|please|must|will be)\b/i.test(head) || /^(?:the |our )?(?:ticket |the )?(?:price|rate|cost|fee|pricing)s?$/i.test(head) || /\bthe (?:rate|price|cost)$/i.test(head);
    if (!sentence && head && !DANGLING.test(head) && !/\b(?:a|an|the|your|our)$/i.test(head)) return head;
  }
  const dangled = DANGLING.test(s);
  let out = s;
  // A stub token ("activit", "ho", "te") goes first, then any dangling words it leaves.
  if (/\s[a-z]{1,2}$/.test(out) && !SHORT_OK.test(out.slice(out.lastIndexOf(" ") + 1))) out = out.slice(0, out.lastIndexOf(" "));
  else if (s.length >= 55 && !DANGLING.test(out)) out = out.slice(0, Math.max(0, out.lastIndexOf(" ")));
  out = out.replace(/\s*\d{1,2}:\d$/, "");
  for (let i = 0; i < 4 && DANGLING.test(out); i++) out = out.replace(DANGLING, "");
  if (dangled && (out.match(/[A-Za-z0-9]+/g) || []).length > 2) return null;
  // "Memberships start at" is still cut after "at" goes: the price it introduced is missing.
  if (dangled && /\b(?:start|starts|begin|begins|require|requires|include|includes|cost|costs|run|runs|range|ranges|priced)$/i.test(out.trim())) return null;
  return out.trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Remove the service's own name from inside a label: "Castle Bounce House 10×10" under Bounce House reads "Castle 10×10". */
function withoutName(label: string, service: string): string {
  const words = service
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || words.join("").length < 4) return label;
  const pattern = new RegExp("(?<![A-Za-z0-9])" + words.map((w) => esc(w.replace(/s$/i, "")) + "s?").join("[\\s\\-/]+") + "(?![A-Za-z0-9])", "gi");
  // "Private Charter On Lake Minnetonka" under Charters keeps its words: a name followed by a preposition is part of a phrase.
  const rest = label.replace(pattern, (m, at: number, whole: string) => {
    const after = whole.slice(at + m.length);
    const before = whole.slice(0, at);
    // "Private Charter On Lake" and "Price Range Fishing Packages" keep the name: it sits inside a phrase.
    if (/^\s+(?:on|of|for|with|in|at|to|from|by|and|or|&)\b/i.test(after)) return m;
    if (/[A-Za-z]\s*$/.test(before) && /^\s*[/&+]?\s*[A-Za-z]/.test(after)) return m;
    // At the end, only after a word or two with nothing structured before it: "Adult Admission" is "Adult", "Price - Study Package" stays.
    const beforeOwn = before.replace(pattern, " ");
    if (!after.trim() && (/[-–—:|]/.test(beforeOwn) || (beforeOwn.replace(/\bft\b/g, "").match(/[A-Za-z]{2,}/g) || []).length > 2)) return m;
    return " ";
  }).replace(/\s{2,}/g, " ").replace(/^[\s,:;\-–—|]+|[\s,:;\-–—|]+$/g, "").trim();
  // Only where the name is clutter around a short remainder ("Castle 10×10", "Adult", "Double").
  // "Largest fleet of passenger surf boat rentals" under Boat Rentals keeps its words; cutting them leaves "surf".
  const left = (rest.match(/[A-Za-z]{2,}/g) || []).length;
  // "Custom fishing trips available" under Custom Fishing Trips is not "Available": a predicate left alone is no label.
  if (left > 3 || /^(?:available|avail|start|starts|starting|is|are|was|were|include|includes|included|open|offered|required|only|now|from|at|for)\b/i.test(rest)) return label;
  return rest;
}

/** Strip a trailing price the page already prints: "Monthly RV Full Hook Up is $600" at $600, "6 hr 795 US dollars" at $795. */
function withoutEchoedPrice(label: string, price: number | null): string {
  if (price == null) return label;
  const m = label.match(/(?:\s*(?:=|:|-|–|\bis\b|\bat\b|\bfor\b|\bfrom\b|\bstarting (?:at|from)\b|\bonly\b|\bjust\b))*\s*(?:(?:US|CA|C)?\$\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:US|Canadian|CAD|USD)?\s*dollars?)(?:\s*(?:CA|USD|CAD|US))?\s*(?:\+\s*tax(?:es)?|plus tax(?:es)?)?\s*$/i);
  if (!m) return label;
  const amount = Number((m[1] || m[2]).replace(/,/g, ""));
  if (Math.abs(amount - price) > 0.99) return label;
  return label.slice(0, m.index).trim();
}

/** Kinds whose rentals are measured in feet: party rentals, tents, storage, slips and stalls. */
const SIZEY_KIND = new Set(["venue", "themepark", "waterpark"]);
const SIZEY_WORDS = /\b(?:bounce|bouncer|bouncy|inflatable|slides?|combo|moonwalk|obstacle|tents?|canopy|canopies|booths?|stages?|dance floor|storage|units?|slips?|stalls?|docks?|pads?|cabanas?|trailers?|dumpsters?|tarps?|sheds?|garages?|lockers?)\b/i;

export type LabelContext = { service: string; kind: string; price?: number | null };

/**
 * One variant label, plain. Returns "" when nothing a guest could use is left (the page then shows "Standard"),
 * and null when the label is an event timetable rather than a price tier: that row is not bookable.
 */
export function plainLabel(raw: string, ctx: LabelContext): string | null {
  if (!raw) return "";
  if (isEventSchedule(raw)) return null;
  let t = raw.replace(/[\u00a0\u200b\u2060\ufeff]/g, " ").replace(/[\t\r\n]+/g, " ");
  // Emoji, stars and bullets the site used as icons.
  t = t.replace(/(\S)\s+[•·]\s+(?=\S)/g, "$1, ").replace(/[\p{Extended_Pictographic}\u2600-\u27bf\ufe0f\u200d★☆✓✔→•·]/gu, " ");
  const wasCut = looksCut(t);
  t = t.replace(/[\s.…]*[.…]{3,}[\s.…]*$/, "").replace(/\s{2,}/g, " ").trim();
  if (!t || NOT_A_LABEL.test(t)) return "";
  // A prose fragment that starts mid-sentence: "from February to April. Membership is".
  if (/^(?:from|and|or|to|of|with|for|but|which|that|is|are|was|were|then|than|also|so)\b/.test(t) && /[a-z]/.test(t.charAt(0))) return "";
  if (wasCut) {
    const closed = closeCut(t);
    if (closed === null) return "";
    t = closed;
  }
  const titleCased = isTitleCase(t);
  t = withoutEchoedPrice(t, ctx.price ?? null);
  t = expandAbbreviations(t);
  const sizey = SIZEY_KIND.has(ctx.kind) || SIZEY_WORDS.test(ctx.service + " " + t);
  t = tidyNumbers(t, sizey);
  t = t.replace(/^[\s=:;,\-–—/|&+*.]+/, "");
  if (ctx.service) t = withoutName(t, ctx.service);
  // Trailing "=", ":", "-", "(", "/" and dangling words; an opening bracket with nothing after it.
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t
      .replace(/\s*\(\s*$/, "")
      .replace(/[\s.…]*[.…]{3,}[\s.…]*$/, "")
      .replace(/(?<![\d+]|hours?|days?|years?)\s*\+$/, "")
      .replace(/[\s=:;,\-–—/|&*]+$/, "")
      .replace(/^[\s=:;,\-–—/|&+*.]+/, "")
      .trim();
    if (DANGLING.test(t) && t.split(/\s+/).length > 1) t = t.replace(DANGLING, "").trim();
    if (t === before) break;
  }
  // A bracket the crawl opened and never closed: "(includes 2 adults" -> "(includes 2 adults)".
  const open = (t.match(/\(/g) || []).length;
  const close = (t.match(/\)/g) || []).length;
  if (open === close + 1 && /\([^)]*\S$/.test(t)) t += ")";
  if (open < close) t = t.replace(/^([^()]*)\)/, "$1");
  t = t.replace(/\s+([,.;:)])/g, "$1").replace(/\(\s+/g, "(").replace(/\s{2,}/g, " ").trim();
  if (!/[A-Za-z0-9]/.test(t)) return "";
  // One or two letters left over are not a label.
  if (/^[A-Za-z]{1,2}$/.test(t) && !ACRONYM.has(t.toUpperCase())) return "";
  if (DANGLING.test(" " + t)) return "";
  t = isShouted(t) ? sentenceCase(t) : calmCase(t, titleCased);
  return t;
}

/** A service name, plain: the same words and fixes, but a name keeps its Title Case and its own words. */
export function plainName(raw: string, kind: string): string {
  let t = raw.replace(/[\u00a0\u200b\u2060\ufeff]/g, " ").replace(/[\p{Extended_Pictographic}\ufe0f\u200d★☆✓✔→]/gu, " ").replace(/\s{2,}/g, " ").trim();
  const titleCased = isTitleCase(t);
  // "1. Escape Room": a list number, not part of the name.
  t = t.replace(/^\(?\d{1,2}[.)]\s+(?=[A-Za-z])/, "");
  t = expandAbbreviations(t);
  t = tidyNumbers(t, SIZEY_KIND.has(kind) || SIZEY_WORDS.test(t));
  // A Title Case name keeps Title Case for the unit words written out: "Brewery 10 yr Anniversary" -> "10-Year".
  if (titleCased) t = t.replace(/\b(\d+(?:\.\d+)?[- ])(hours?|minutes?|days?|nights?|weeks?|months?|years?)\b/g, (_m, n: string, u: string) => n + u.charAt(0).toUpperCase() + u.slice(1));
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t
      .replace(/\s*\(\s*$/, "")
      .replace(/[\s=:;,\-–—/|&+*]+$/, "")
      .trim();
    if (DANGLING.test(t) && t.split(/\s+/).length > 2) t = t.replace(DANGLING, "").trim();
    if (t === before) break;
  }
  const open = (t.match(/\(/g) || []).length;
  const close = (t.match(/\)/g) || []).length;
  if (open === close + 1 && /\([^)]*\S$/.test(t)) t += ")";
  return t || raw.trim();
}

/* ---------- a whole service ---------- */

/** A label reduced to its shape: "10 × 20 ft" and "13 × 13 ft" are one family, "6 one-hour sessions" and "12 one-hour sessions" another. */
function shapeOf(label: string): string {
  // Plurals fold into one shape too: "1 person" and "4 persons" differ only by the count.
  return label.toLowerCase().replace(/\d+(?:[.,]\d+)?/g, "#").replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, "#").replace(/([a-z]{3,})(?:es|s)\b/g, "$1").replace(/\s+/g, " ").trim();
}
const numbersOf = (label: string) => (label.match(/\d+(?:\.\d+)?/g) || []).map(Number);

/** How many tiers of one family stay open before the rest fold under "More options". */
const FAMILY_VISIBLE = 3;
/** Past this many visible tiers, a service folds whatever is left, whatever its shape. Menus rarely reach it. */
const SERVICE_VISIBLE = 10;

/** A label that is really a description of the service: long, starts with words, no count or length up front. */
function isDescriptive(label: string): boolean {
  const words = label.split(/\s+/).length;
  return words >= 8 && !/^\d/.test(label) && !/^(?:adults?|child(?:ren)?|kids?|seniors?|students?|youth|per|up to|ages?)\b/i.test(label);
}

/**
 * A service as the guest reads it: a plain name, plain tier labels, jargon explained once, and a long run of size or
 * count tiers folded behind the first few. Returns null when no bookable tier is left. Order of `variants` may change
 * (the simplest of a family first); `optionIdx` always points at the same option as before.
 */
export function plainService(svc: RawService, kind: string): PlainService | null {
  const name = plainName(svc.name, kind);
  let desc = svc.desc;
  const variants: PlainVariant[] = [];
  for (const v of svc.variants) {
    const label = plainLabel(v.label === STANDARD ? "" : v.label, { service: name, kind, price: v.price });
    if (label === null) continue;
    variants.push({ ...v, label: label || STANDARD });
  }
  if (!variants.length) return null;
  // One tier whose "label" is a sentence about the service is its description, when the service has none.
  if (variants.length === 1 && !desc && variants[0].label !== STANDARD && isDescriptive(variants[0].label)) {
    desc = /[.!?]$/.test(variants[0].label) ? variants[0].label : variants[0].label + ".";
    variants[0] = { ...variants[0], label: STANDARD };
  }
  // Families of tiers that differ only by a number: simplest first, then fold the tail.
  const families = new Map<string, PlainVariant[]>();
  for (const v of variants) {
    const k = shapeOf(v.label);
    if (!families.has(k)) families.set(k, []);
    families.get(k)!.push(v);
  }
  const ordered: PlainVariant[] = [];
  const placed = new Set<PlainVariant>();
  const folded = new Set<PlainVariant>();
  for (const v of variants) {
    if (placed.has(v)) continue;
    const fam = families.get(shapeOf(v.label))!;
    const numeric = /#/.test(shapeOf(v.label)) && fam.length >= 4 && variants.length > 4;
    const members = numeric
      ? [...fam].sort((a, b) => {
          const na = numbersOf(a.label);
          const nb = numbersOf(b.label);
          for (let i = 0; i < Math.max(na.length, nb.length); i++) if ((na[i] ?? 0) !== (nb[i] ?? 0)) return (na[i] ?? 0) - (nb[i] ?? 0);
          return (a.price ?? Infinity) - (b.price ?? Infinity);
        })
      : [v];
    members.forEach((m, i) => {
      ordered.push(m);
      placed.add(m);
      if (numeric && i >= FAMILY_VISIBLE) folded.add(m);
    });
  }
  // The same tier twice (same words, same price) folds too, and so does anything past the service cap.
  const seen = new Set<string>();
  let visible = 0;
  const out = ordered.map((v) => {
    const key = v.label.toLowerCase() + "|" + v.price + "|" + (v.per || "");
    const dup = seen.has(key);
    seen.add(key);
    const fold = dup || folded.has(v) || visible >= SERVICE_VISIBLE;
    if (!fold) visible++;
    return fold ? { ...v, moreOptions: true as const } : v;
  });
  // Jargon: the name's first, then each tier's words that the name did not already explain. Each term once per service.
  const explain = explainTerms(name, kind);
  const told = new Set(explain.map((e) => e.term));
  const withTerms = out.map((v) => {
    if (v.label === STANDARD) return v;
    const terms = explainTerms(v.label, kind).filter((e) => !told.has(e.term));
    for (const e of terms) told.add(e.term);
    return terms.length ? { ...v, explain: terms } : v;
  });
  return { name, desc, ...(svc.photo ? { photo: svc.photo } : {}), variants: withTerms, ...(explain.length ? { explain } : {}) };
}

/** Every service on a listing. Services left with no bookable tier are dropped; the option rows they pointed at stay. */
export function plainServices(services: RawService[], kind: string): PlainService[] {
  return services.map((s) => plainService(s, kind)).filter((s): s is PlainService => !!s);
}

/**
 * An operator's deals, as a guest wants to read them: at most three, each with a short title that says what you get
 * and when ("Half-price Tuesdays"), the operator's most complete sentence as the detail, the right days and the promo
 * code when there is one.
 *
 * The promo crawl keeps every sentence that names a day and sounds like a deal, so one offer arrives in pieces:
 * a heading ("Half-Price Tuesdays:"), a banner ("HALF PRICE TUESDAY IS BACK!"), a sentence with the terms, and
 * sometimes a customer's review that mentions it. It also keeps weekday price tables, surcharges, deposits and
 * holiday one-offs. This module groups the pieces of one offer, drops what is not an offer, and never writes a
 * discount, a day or a code the operator did not state.
 */

export type RawPromo = { text: string; days: number[]; start?: string; end?: string };
export type Deal = { title: string; detail: string; days: number[]; code?: string; start?: string; end?: string; date?: string };

const DAY_FULL = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_TITLE = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ---------- days ---------- */

/** "Tuesday", "Tues.", "TH", "M": one day token. Letter codes only count inside a range or list with another day. */
const DAY_TOKEN = "(sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sun|mon|tues?|wed|thur?s?|fri|sat|su|sa|th|tu|m|t|w|f)(?:['’]s)?\\.?";
const RANGE = new RegExp("(?<![A-Za-z])" + DAY_TOKEN + "\\s*(?:-|–|—|to|through|thru|until)\\s*" + DAY_TOKEN + "(?![A-Za-z])", "gi");
const LIST = new RegExp("(?<![A-Za-z])" + DAY_TOKEN + "(?:\\s*(?:\\/|&|,|and|or)\\s*" + DAY_TOKEN + ")+(?![A-Za-z])", "gi");
const FULL_DAY = /(?<![A-Za-z])(sun|mon|tues|wednes|thurs|fri|satur)days?(?:['’]s)?(?![A-Za-z])/gi;
const ABBR_DOT = /(?<![A-Za-z])(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\.(?=\s|$|,)/gi;

function dayOf(token: string, allowLetters: boolean): number {
  const t = token.toLowerCase().replace(/['’]s$/, "").replace(/\.$/, "");
  const full = DAY_FULL.findIndex((d) => t === d || t === d + "s");
  if (full >= 0) return full;
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  if (t in map) return map[t];
  if (!allowLetters) return -1;
  const letters: Record<string, number> = { su: 0, m: 1, t: 2, tu: 2, w: 3, th: 4, f: 5, sa: 6 };
  return t in letters ? letters[t] : -1;
}

/**
 * The days a sentence names, with ranges ("M-TH" is Monday to Thursday) and lists ("Tue/Wed/Thu") expanded.
 * Explicit days win over "weekdays" in the same sentence. [] means every day; null means no day is named at all.
 * "Sun" alone is not Sunday ("watch the sun sink"); it needs a dot, a range or a list.
 */
export function daysOf(text: string): number[] | null {
  const out = new Set<number>();
  let rest = text;
  for (const m of text.matchAll(RANGE)) {
    const a = dayOf(m[1], true);
    const b = dayOf(m[2], true);
    // A letter code needs a partner that is also a day, and "t-shirt" style words are not ranges.
    if (a < 0 || b < 0 || (m[1].length === 1 && m[2].length === 1 && !/^[A-Z]$/.test(m[1]))) continue;
    for (let d = a; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === b) break;
    }
    rest = rest.replace(m[0], " ");
  }
  for (const m of rest.matchAll(LIST)) {
    const tokens = m[0].split(/\s*(?:\/|&|,|\band\b|\bor\b)\s*/i).filter(Boolean);
    const ds = tokens.map((x) => dayOf(x.trim(), tokens.some((y) => y.trim().length > 2)));
    if (ds.every((d) => d >= 0) && tokens.some((x) => x.trim().length > 2)) {
      ds.forEach((d) => out.add(d));
      rest = rest.replace(m[0], " ");
    }
  }
  for (const m of rest.matchAll(FULL_DAY)) out.add(dayOf(m[1] + "day", false));
  for (const m of rest.matchAll(ABBR_DOT)) out.add(dayOf(m[1], false));
  if (!out.size) {
    if (/\bmid-?week\b/i.test(text) && /\bweekends?\b/i.test(text)) return null;
    if (/\bweekdays?\b/i.test(text)) return [1, 2, 3, 4, 5];
    if (/\bweekends?\b/i.test(text)) return [0, 6];
    if (/\b(?:daily|every ?day|7 days a week|all week)\b/i.test(text)) return [];
    return null;
  }
  return [...out].filter((d) => d >= 0).sort((a, b) => a - b);
}

/** "on Tuesdays", "on weekdays", ", Monday to Thursday", "on Mondays and Fridays"; "" for every day. */
function dayPhrase(days: number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (!d.length || d.length === 7) return "";
  if (d.join() === "1,2,3,4,5") return " on weekdays";
  if (d.join() === "0,6") return " on weekends";
  if (d.length === 1) return " on " + DAY_TITLE[d[0]] + "s";
  const run = runOf(d);
  if (run && d.length >= 3) return ", " + DAY_TITLE[run[0]] + " to " + DAY_TITLE[run[1]];
  const names = d.map((x) => DAY_TITLE[x] + "s");
  return " on " + (names.length === 2 ? names.join(" and ") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]);
}

/** First and last day of a consecutive run, wrapping past Saturday ("Friday to Sunday"), or null. */
function runOf(d: number[]): [number, number] | null {
  for (let start = 0; start < 7; start++) {
    const seq = Array.from({ length: d.length }, (_, i) => (start + i) % 7);
    if (seq.slice().sort((a, b) => a - b).join() === d.join()) return [seq[0], seq[seq.length - 1]];
  }
  return null;
}

/** "Tuesday", "Weekday", "Weekend", "Monday to Thursday": days as an adjective, for "Tuesday special". */
function dayAdjective(days: number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (!d.length) return "";
  if (d.join() === "1,2,3,4,5") return "Weekday";
  if (d.join() === "0,6") return "Weekend";
  if (d.length === 1) return DAY_TITLE[d[0]];
  const run = runOf(d);
  if (run && d.length >= 3) return DAY_TITLE[run[0]] + " to " + DAY_TITLE[run[1]];
  return d.map((x) => DAY_TITLE[x]).join(" and ");
}

/* ---------- reading one fragment ---------- */

const NUMBER_WORDS: Record<string, number> = { five: 5, ten: 10, fifteen: 15, twenty: 20, "twenty-five": 25, thirty: 30, forty: 40, fifty: 50 };

type Benefit = { key: string; kind: "nth" | "bogo" | "half" | "pct" | "usd" | "free" | "price"; amount?: number; unit?: string; upTo?: boolean; words: string; at: number; end: number; cash?: boolean };

/** The concrete thing a guest gets, strongest first. Null when the sentence promises nothing measurable. */
function benefitOf(t: string): Benefit | null {
  const s = t.replace(/\b(five|ten|fifteen|twenty(?:-five)?|thirty|forty|fifty)\s+percent\b/gi, (_m, w: string) => NUMBER_WORDS[w.toLowerCase()] + "%").replace(/\bpercent\b/gi, "%");
  let m = s.match(/\b(\d+)(?:st|nd|rd|th)\s+(hour|night|ticket|round|game|day|ride|class|session|lesson|jump|person|guest|tour)s?\s+(?:is\s+)?free\b/i);
  if (m) return { key: "nth:" + m[1] + m[2].toLowerCase(), kind: "nth", amount: Number(m[1]), unit: m[2].toLowerCase(), words: m[0], at: m.index!, end: m.index! + m[0].length };
  m = s.match(/\bbogo\b|\bbuy (?:one|1),? get (?:one|1)(?: free)?\b|\b(?:two|2)[- ]for[- ](?:one|1)\b/i);
  if (m) return { key: "bogo", kind: "bogo", words: m[0], at: m.index!, end: m.index! + m[0].length };
  m = s.match(/\bhalf[- ]?(?:price|priced|off)\b|\b50\s*%\s*(?:off|discount)\b|\bhalf (?:the )?(?:price|fare|cost)\b/i);
  if (m) return { key: "half", kind: "half", words: m[0], at: m.index!, end: m.index! + m[0].length };
  m = s.match(/(?:\b(?:save|saving|get|take)\s+)?(\d{1,2}(?:\.\d)?)\s*%\s*(cash\s+)?(?:off|discount)\b|\b(?:save|saving)\s+(\d{1,2})\s*%/i);
  if (m) {
    const n = Math.round(Number(m[1] || m[3]));
    return { key: "pct:" + n, kind: "pct", amount: n, cash: !!m[2], words: m[0], at: m.index!, end: m.index! + m[0].length };
  }
  m = s.match(/(\bup to\s+)?\$\s?(\d+)(?:\.\d\d)?\s*(?:per person|pp|each|per \w+)?\s*(?:off|cheaper|discount|savings?)\b|\bsave\s+(up to\s+)?\$\s?(\d+)/i);
  if (m) {
    const n = Number(m[2] || m[4]);
    return { key: "usd:" + n, kind: "usd", amount: n, upTo: !!(m[1] || m[3]), words: m[0], at: m.index!, end: m.index! + m[0].length };
  }
  m = s.match(/(?<![-\w])free(?![-\w])(?!\s+(?:cancellation|wi-?fi|parking|shipping|of charge|quote|estimate|consultation|app|download|to\b|time\b|flowing|fall|style))/i);
  if (m && !/\b(?:stress|worry|hassle|gluten|smoke|hands|care|duty|sugar|alcohol)[- ]free\b/i.test(s)) return { key: "free", kind: "free", words: m[0], at: m.index!, end: m.index! + m[0].length };
  // A price with a deal word beside it: "Tuesday Special - $199", "reduced rate of $25", "using coupon code MONDAY".
  // One amount only, and not a "starting at" price list.
  const price = s.match(/\$\s?(\d[\d,]*(?:\.\d\d)?)/);
  const amounts = (s.match(/\$\s?\d/g) || []).length;
  const hasCode = /\b(?:promo |coupon |discount )?code\b/i.test(s);
  if (price && /\b(?:special|deal|promo|code|coupon|reduced rate|discounted)\b/i.test(s) && (amounts === 1 || hasCode) && !/\bstarting (?:at|from)\b|\bfrom \$|\bas low as\b/i.test(s)) {
    const n = Number(price[1].replace(/,/g, ""));
    return { key: "price:" + n, kind: "price", amount: n, words: price[0], at: price.index!, end: price.index! + price[0].length };
  }
  return null;
}

/** A customer talking, not the operator: first person singular, "highly recommend", "they gave us". */
const CUSTOMER = /(?<![A-Za-z])I(?:['’](?:m|ve|d|ll))?(?![A-Za-z])|\bmy\b|\bhighly recommend|\bwe had (?:a|the|so)\b|\bthey gave us\b|\bthe (?:boat |tour )?(?:driver|captain|guide|crew) (?:was|were|encouraged)\b|\bour (?:captain|guide) was\b|\bwould (?:definitely )?(?:recommend|come back|go again)\b/;
/** Not an offer: a surcharge, a deposit, a fee, a sweepstakes. */
const NOT_OFFER = /\bsurcharge|\badd(?:itional)? \$\d|\+\s?\d+\s?%|\brate adjustment|\bdeposit\b|\bto secure your\b|\bparking\b|\bchance to win\b|\bwinners?\b|\bdrawing\b|\bgiveaway\b|\bsweepstakes\b|\braffle\b|\bslot play\b|\bholiday rate\b|\bpeak (?:rate|pricing)\b/i;
/** One-off holidays: never a weekly day. */
const HOLIDAY = /\bblack friday\b|\bcyber monday\b|\bchristmas\b|\bxmas\b|\bnew year'?s?\b|\bjuly 4(?:th)?\b|\b4th of july\b|\bfourth of july\b|\bindependence day\b|\bthanksgiving\b|\bmemorial day\b|\blabou?r day\b|\bmother['’]?s day\b|\bfather['’]?s day\b|\bgrandparents['’]? day\b|\bvalentine['’]?s?\b|\beaster\b|\bhalloween\b|\bst\.? patrick['’]?s\b|\bveterans['’]? day\b|\bcanada day\b|\bvictoria day\b|\bboxing day\b|\bpresidents['’]? day\b|\bmlk\b|\bjuneteenth\b|\bcolumbus day\b|\bnights of lights\b|\bholiday (?:special|sale|cruise|deal)s?\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b/i;
/** Terms and limits worth keeping next to the offer: "valid for tandem jumps on Tuesdays only", "must pay cash". */
const CONDITION = /\b(?:valid|only (?:valid|available)|applies|apply|must|not including|excludes?|excluding|with (?:each|a) paid|restrictions?|not combinable|cannot be combined|limit(?:ed)? (?:one|1)|when you book|present (?:a|your)|proof of)\b/i;
/** Days used as words inside an object phrase: "weekday boat rentals" is "boat rentals". */
const DAY_WORDS = /^(?:weekdays?|weekends?|midweek|mid-week|daily|every|(?:sun|mon|tues|wednes|thurs|fri|satur)days?)$/i;
const OBJECT_END = /^(?:rentals?|tours?|rides?|tickets?|cruises?|trips?|jumps?|skydives?|flights?|charters?|admission|lanes?|games?|sessions?|classes?|lessons?|skis?|flyers?|photos?|sails?|passes?|fares?|boats?|kayaks?|paddleboards?|cabins?|nights?|rooms?|packages?|bowling|golf|rounds?|parasails?|watercraft|jet ?skis?|snorkel(?:ing)?|dives?|experiences?|delivery|setup|set-up|pickup|pick-up|downloads?|drinks?|beers?|appetizers?|entry|entries|shoes?|trip|jetskis?|admissions?)$/i;

/** Sentence case for shouted text, first letter up, whitespace and trailing ellipses tidy. Words otherwise as written. */
function tidy(raw: string): string {
  let t = raw
    .replace(/[\p{Extended_Pictographic}️‍★☆✨]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\.{2,}(?=\s|$)|…/g, ".")
    .replace(/\.{2,}(?=[a-z])/gi, ". ")
    .replace(/!{2,}/g, "!")
    .trim()
    .replace(/^[\s\-–—:;,|]+|[\s\-–—:;,|]+$/g, "");
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 6 && (t.match(/[A-Z]/g) || []).length / letters.length > 0.6) {
    t = t
      .toLowerCase()
      .replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
      .replace(/\b(?:am|pm|usa|atv|utv|sup|vip|byob|id)\b/g, (w) => w.toUpperCase())
      .replace(/\b(sun|mon|tues|wednes|thurs|fri|satur)day/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
      .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
  }
  // A sentence after a full stop starts with a capital: "... on the weekends. Price reflects a 3.0% cash discount."
  t = t.replace(/(?<!\b[ap]\.m|\b(?:approx|vs|etc|no|st|min|hrs?|mon|tue|tues|wed|thu|thurs|fri|sat|sun))([.!?]\s+)([a-z])(?=[a-z]*\s)/g, (_m, p: string, c: string) => p + c.toUpperCase());
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A promo code: after "code", in capitals or quotes. "Code: SUMMER26", "code “Rudee”", "code - SUNDAY". */
function codeOf(t: string): string | undefined {
  const m = t.match(/\bcode\s*(?:[:\-–]\s*)?["“'‘]\s*([A-Za-z0-9]{3,20})\s*["”'’]|\b[Cc]ode\s*(?:[:\-–]\s*)?([A-Z0-9]*[A-Z][A-Z0-9]*[0-9A-Z]{2,19})\b|\bcode\s+([A-Z][a-z]+[A-Z0-9][A-Za-z0-9]*)\b/);
  const code = m ? m[1] || m[2] || m[3] : undefined;
  if (!code || /^(?:AT|IN|THE|FOR|AND|OR|TO)$/i.test(code)) return undefined;
  return code;
}

/** A heading rather than a sentence: short, no sentence end, or ending in a colon. */
function isHeadline(t: string): boolean {
  if (/:$/.test(t.trim())) return true;
  const words = t.trim().split(/\s+/).length;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length && (t.match(/[A-Z]/g) || []).length / letters.length > 0.6) return true;
  return words <= 6 && !/[.!]$/.test(t.trim());
}

/** Object of the offer from the words after the benefit: "off cabin and boat rentals" -> "cabin and boat rentals". */
function objectAfter(text: string, b: Benefit): string {
  const after = text.slice(b.end).trim().replace(/^(?:of|on|for)\s+/i, "");
  const words = after.split(/\s+/);
  const picked: string[] = [];
  for (const w of words) {
    const core = w.replace(/[^A-Za-z&'’-]/g, "");
    if (!core || /[,.!;:()]/.test(w.slice(0, -1))) break;
    if (core.split(/[-–]/).every((x) => DAY_WORDS.test(x) || /^(?:sun|mon|tues?|wed|thur?s?|fri|sat)$/i.test(x))) continue;
    if (/^(?:on|every|when|with|for|this|at|during|through|thru|using|by|until|if|before|after|to|in|from|the|and|or|&|only|now|is|are)$/i.test(core) && !(/^(?:and|&)$/i.test(core) && picked.length)) {
      if (picked.length) break;
      if (/^(?:the)$/i.test(core)) continue;
      break;
    }
    picked.push(core);
    if (/[,.!;:)]$/.test(w) || picked.length >= 5) break;
  }
  while (picked.length && !OBJECT_END.test(picked[picked.length - 1])) picked.pop();
  const phrase = picked.join(" ");
  return phrase.split(" ").length <= 4 ? phrase.toLowerCase().replace(/\bjet ?skis?\b/, (w) => w) : "";
}

/* ---------- consolidating ---------- */

type Piece = { text: string; days: number[]; benefit: Benefit | null; code?: string; start?: string; end?: string; holiday: boolean; date?: { month: number; day: number; year?: number } };

function readPiece(p: RawPromo): Piece | null {
  // "(M-TH)" and "(Tues–Thurs)" are days in brackets; lifting the brackets keeps them in the clause they qualify.
  const text = tidy(p.text).replace(/\(([A-Za-z.\s\-–—&\/,]{1,30})\)/g, (m, inner: string) => (inner.replace(new RegExp(DAY_TOKEN, "gi"), "").replace(/[\s.\-–—&\/,]|and|to|through|thru/gi, "") === "" && daysOf(inner) ? inner : m));
  if (!text || text.length < 6) return null;
  if (CUSTOMER.test(p.text) || NOT_OFFER.test(text)) return null;
  const holiday = HOLIDAY.test(text);
  const dm = text.match(DATE_RE);
  const date = dm ? { month: MONTHS.indexOf(dm[1].slice(0, 3).toLowerCase()), day: Number(dm[2]), year: dm[3] ? Number(dm[3]) : undefined } : undefined;
  // One-off holidays keep no weekly days. Otherwise the sentence's own days win over what the crawl guessed.
  const benefit = benefitOf(text);
  // "15% off Monday-Thursday tours, 10% Friday, Saturday": the days of the clause that carries the benefit win.
  let days: number[] = [];
  if (!holiday) {
    const whole = daysOf(text);
    let near: number[] | null = null;
    if (benefit) {
      const from = Math.max(text.lastIndexOf(",", benefit.at), text.lastIndexOf(";", benefit.at), text.lastIndexOf("(", benefit.at)) + 1;
      const stops = [",", ";", "("].map((c) => text.indexOf(c, benefit.end)).filter((i) => i >= 0);
      const to = stops.length ? Math.min(...stops) : text.length;
      near = daysOf(text.slice(from, to));
    }
    days = near && near.length ? near : (whole ?? []);
  }
  return { text, days, benefit, code: codeOf(text), start: p.start, end: p.end, holiday, date };
}

function titleFor(group: Piece[], lead: Piece, days: number[], detailPiece?: Piece): string {
  const b = lead.benefit!;
  const text = lead.text;
  const kidAt = text.search(/\b(?:kids?|children|child)\b/i);
  const adultAt = text.search(/\badults?\b/i);
  const kids = kidAt >= 0 && kidAt <= b.at + 40 && (adultAt < 0 || kidAt < adultAt);
  const friend = /\bbring a friend\b/i.test(text);
  // The object from the shortest piece that names one: headings are written as titles.
  // The object named in the detail sentence first, so the title and the line under it agree; else the shortest piece's.
  const object = [...(detailPiece?.benefit?.key === b.key ? [detailPiece] : []), ...[...group].filter((p) => p.benefit && p.benefit.key === b.key).sort((x, y) => x.text.length - y.text.length)]
    .map((p) => objectAfter(p.text, p.benefit!))
    .find(Boolean) || "";
  const on = dayPhrase(days);
  const forKids = kids ? " for kids" : "";
  const obj = object ? " " + object : "";
  let title: string;
  switch (b.kind) {
    case "nth":
      title = b.amount + ordinal(b.amount!) + " " + b.unit + " free" + (object ? " on " + object : "") + forKids + on;
      break;
    case "bogo":
      title = "Buy one, get one" + (/free/i.test(b.words) ? " free" : "") + (object ? ": " + object : "") + on;
      break;
    case "half": {
      const saysHalf = group.filter((p) => p.benefit?.kind === "half" && /half/i.test(p.benefit.words)).length >= group.filter((p) => p.benefit?.kind === "half" && /50/.test(p.benefit.words)).length;
      const dayTitled = group.some((p) => /half[- ]?price\s+(?:(?:sun|mon|tues|wednes|thurs|fri|satur)days?|week(?:days|ends))\b/i.test(p.text));
      if (saysHalf && (dayTitled || (!object && !kids)) && (days.length === 1 || /^ on week(?:days|ends)$/.test(on))) title = "Half-price " + on.replace(/^ on /, "");
      else if (saysHalf) title = "Half price" + (object ? " on " + object : "") + forKids + on;
      else title = (friend ? "Bring a friend for 50% off" : "50% off" + obj) + forKids + on;
      break;
    }
    case "pct":
      title = (b.upTo ? "Up to " : "") + b.amount + "% " + (b.cash ? "cash discount" : "off") + obj + forKids + on;
      break;
    case "usd":
      title = (b.upTo ? "Up to $" : "$") + b.amount + " off" + obj + forKids + on;
      break;
    case "free": {
      const count = text.slice(Math.max(0, b.at - 4), b.at).match(/(\d+)\s*$/);
      const freeObj = objectAfter(text, b);
      if (freeObj) title = (count ? count[1] + " free " : "Free ") + freeObj + forKids + on;
      else if (kids) title = "Free for kids" + on;
      else title = "";
      break;
    }
    case "price": {
      const amounts = new Set((text.match(/\$\s?\d[\d,]*(?:\.\d\d)?/g) || []).map((x) => x.replace(/[\s,]/g, "")));
      const adj = dayAdjective(days);
      const head = (kids ? "Kids' " + (/^Week/.test(adj) ? adj.toLowerCase() : adj) : adj) + (adj ? " " : "") + "special";
      title = amounts.size > 1 ? head + " price" : head + ": $" + b.amount!.toLocaleString("en-US", { maximumFractionDigits: 2 });
      break;
    }
  }
  if (!title) return "";
  if (lead.holiday) {
    const h = text.match(HOLIDAY)![0];
    title = h.replace(/\b\w/g, (c) => c.toUpperCase()) + ": " + title.charAt(0).toLowerCase() + title.slice(1);
  }
  title = title.replace(/\s{2,}/g, " ").trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] || "th";
}

/** How complete a piece is as the detail line. */
function detailScore(p: Piece, code: string | undefined): number {
  let s = 0;
  if (/[.!]$/.test(p.text) || (!isHeadline(p.text) && p.text.split(/\s+/).length >= 8)) s += 3;
  // A sentence with no benefit of its own is context, and only wins when every offer piece is a bare heading.
  if (!p.benefit) s -= 5;
  if (p.benefit) s += 2;
  if (!isHeadline(p.text)) s += 2;
  if (p.text.length >= 40 && p.text.length <= 220) s += 1;
  if (daysOf(p.text)?.length) s += 1;
  if (code && p.text.toLowerCase().includes(code.toLowerCase())) s += 1;
  if (CONDITION.test(p.text)) s += 1;
  // A sentence the crawl cut mid-way ("... every Tuesday for") is a poor detail.
  if (/\b(?:for|and|or|the|to|of|with|a|an)$/i.test(p.text)) s -= 4;
  return s;
}

const sameDays = (a: number[], b: number[]) => a.join() === b.join();

/**
 * At most `max` deals from one operator's promo fragments. `now` decides whether a dated holiday note is still ahead;
 * a holiday with no date, or a date already past, is dropped.
 */
export function consolidateDeals(promos: RawPromo[], now = new Date(), max = 3): Deal[] {
  const pieces = promos.map(readPiece).filter((p): p is Piece => !!p);
  const offers = pieces.filter((p) => p.benefit);
  const context = pieces.filter((p) => !p.benefit);
  // Group by days and benefit; a shared promo code joins pieces whatever their wording.
  const groups: Piece[][] = [];
  for (const p of offers) {
    const g = groups.find((grp) => grp.some((x) => (x.code && p.code && x.code.toLowerCase() === p.code.toLowerCase()) || (x.benefit!.key === p.benefit!.key && sameDays(x.days, p.days) && x.holiday === p.holiday)));
    if (g) g.push(p);
    else groups.push([p]);
  }
  // A heading or a terms line with no benefit of its own joins the one offer on the same days, or the one sharing its code.
  for (const c of context) {
    const byCode = c.code ? groups.filter((g) => g.some((x) => x.code && x.code.toLowerCase() === c.code!.toLowerCase())) : [];
    const byDays = c.days.length ? groups.filter((g) => sameDays(g[0].days, c.days)) : [];
    const target = byCode.length === 1 ? byCode[0] : byDays.length === 1 && !c.holiday ? byDays[0] : null;
    if (target) target.push(c);
  }
  const deals: (Deal & { weight: number })[] = [];
  for (const g of groups) {
    const offersIn = g.filter((p) => p.benefit);
    const lead = [...offersIn].sort((a, b) => detailScore(b, undefined) - detailScore(a, undefined))[0];
    const code = g.map((p) => p.code).find(Boolean);
    let date: string | undefined;
    if (lead.holiday) {
      const withDate = g.find((p) => p.date && p.date.month >= 0);
      if (!withDate) continue;
      const { month, day, year } = withDate.date!;
      const when = new Date(year ?? now.getFullYear(), month, day, 23, 59);
      if (when.getTime() < now.getTime()) continue;
      date = when.toLocaleDateString("en-US", { month: "long", day: "numeric", ...(year ? { year: "numeric" } : {}) });
    }
    // Days: the lead offer's; a group joined by a code takes the days most of its offers state.
    const days = lead.days;
    // A special price with no day is just a price.
    if (lead.benefit!.kind === "price" && !days.length) continue;
    const ranked = [...g].sort((a, b) => detailScore(b, code) - detailScore(a, code) || Math.min(b.text.length, 220) - Math.min(a.text.length, 220));
    const title = titleFor(g, lead, days, ranked[0]);
    if (!title) continue;
    let detail = ranked[0].text;
    const titleKey = title.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const detailKey = detail.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (isHeadline(detail) && (detailKey.length <= titleKey.length + 12 || detailKey.includes(titleKey))) detail = "";
    const wordsOf = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9$%]+/g) || []);
    const overlap = (a: string, b: string) => {
      const wa = wordsOf(a);
      const wb = wordsOf(b);
      return [...wb].filter((w) => wa.has(w)).length / Math.max(1, Math.min(wa.size, wb.size));
    };
    // One terms line the detail does not already say in other words.
    const terms = g.filter((p) => p !== ranked[0] && CONDITION.test(p.text) && !isHeadline(p.text)).map((p) => p.text).find((t) => overlap(detail, t) < 0.7);
    if (terms && (detail + " " + terms).length <= 280) detail = detail ? detail.replace(/([^.!?])$/, "$1.") + " " + terms : terms;
    if (detail && !/[.!?]$/.test(detail) && !isHeadline(detail)) detail += ".";
    const start = g.map((p) => p.start).find(Boolean);
    const end = g.map((p) => p.end).find(Boolean);
    const strength = { nth: 5, bogo: 5, half: 5, pct: 4, usd: 4, price: 3, free: 3 }[lead.benefit!.kind];
    deals.push({ title, detail, days, ...(code ? { code } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}), ...(date ? { date } : {}), weight: strength * 10 + g.length + (days.length ? 2 : 0) + (detail ? 1 : 0) });
  }
  // Two groups that read the same after all this are one deal.
  const seen = new Set<string>();
  return deals
    .sort((a, b) => b.weight - a.weight)
    .filter((d) => {
      const k = d.title.toLowerCase() + "|" + d.days.join();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max)
    .map(({ weight: _w, ...d }) => d);
}

import { load } from "cheerio";

/**
 * Day-specific deals mined from an operator's own pages, rules only, no model calls.
 * A promo is a sentence that names a day (Tuesday, weekends, daily, Mon-Fri, nights) and carries a deal signal
 * (a dollar amount, percent off, free, half price, 2 for 1, happy hour, locals, students, seniors).
 * Policy lines (closed, cancellation, refund, deposit, waiver) are never promos, and nothing is invented:
 * every promo keeps the sentence as the site wrote it plus the page it came from.
 */

export type Promo = {
  text: string;
  /** 0=Sun..6=Sat. Empty means every day (daily, nightly, "every day"). */
  days: number[];
  /** "HH:MM" 24-hour, when the sentence gives a time window. */
  start?: string;
  end?: string;
  source: string;
};

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_WORD = "(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)s?";
const DAY_RANGE = new RegExp("\\b" + DAY_WORD + "\\.?\\s*(?:-|–|—|to|through|thru|until)\\s*" + DAY_WORD + "\\b", "gi");
const DAY_ONE = new RegExp("\\b" + DAY_WORD + "\\b", "gi");
const EVERY_DAY = /\b(daily|every ?day|everyday|7 days a week|all week|nightly|every night|nights)\b/i;
const WEEKDAYS = /\bweekdays?\b/i;
const WEEKENDS = /\bweekends?\b/i;
const HAS_DAY = new RegExp("\\b" + DAY_WORD + "\\b|\\bweek(?:days?|ends?)\\b|" + EVERY_DAY.source, "i");

const DEAL = /\$\s?\d|\d\s?%\s?off|\bpercent off\b|\bfree\b|\bhalf[- ]price\b|\bhalf off\b|\b2[- ]for[- ]1\b|\btwo[- ]for[- ]one\b|\bbogo\b|\bspecials?\b|\bdeals?\b|\bdiscount(?:s|ed)?\b|\bhappy hour\b|\bpromo(?:s|tion|tions)?\b|\bkids? eat\b|\bladies'? night\b|\bstudents?\b|\bseniors?\b|\blocals\b/i;
const NOT_A_DEAL = /\bclosed\b|\bcancell?ation|\bcancel(?:led|s)?\b|\brefund|\bdeposit|\bwaiver|\bliabilit|\bno[- ]show|\bforfeit|\bterms (and|&) conditions|\bprivacy|\bcookie|\bclick here|\bread more|\blearn more|\bsubscribe|\bnewsletter|\bsign up\b|\bfollow us|\bcopyright|\ball rights reserved|\btoll[- ]free|\bfree (parking|wi-?fi|shipping|of charge|quote|estimate|consultation)|\bgluten[- ]free|\bsmoke[- ]free|\bhands[- ]free|\bfree (?:to )?(?:download|app)|\bjob|\bcareer|\bhiring|\bapply (now|today)|\bgift ?card|\bmembership|\bseason pass|\bblog\b|\bposted (on|by)\b|\bhours? of operation\b|\bcall\b[^.]*\b(for|to)\b|\brecommend|\bimportant:|\bspecial (person|someone|occasion|events?|day|place|way|guests?|thanks)|\bwinners?\b|\bdrawings?\b|\bslot play|\bcasino|\bbring a friend\b/i;
// One-off events are not recurring deals: a calendar date, a year, "first Thursday of the month", a sponsor line, a festival.
const ONE_OFF = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\b|\b20\d\d\b|\b(first|second|third|fourth|last|1st|2nd|3rd|4th)\s+(full\s+)?(sun|mon|tue|wed|thu|fri|sat|weekend)|\bsponsor|\bentertainment\b|\bcelebrat|\bartisan|\bhistorian|\bfestival|\bparade|\bconcert|\bfireworks|\bchoirs?\b|\binfo(?:rmation)?\s*$/i;
const JUNK = /[{}<>\[\]|]|https?:\/\/|www\.|@|\.(com|ca|net|org)\b|\bfunction\b|\bvar\b|©/i;

const AMPM = "(am|pm|a\\.m\\.|p\\.m\\.|noon|midnight)";
const RANGE = new RegExp("\\b(\\d{1,2})(?::(\\d{2}))?\\s*" + AMPM + "?\\s*(?:-|–|—|to|until|till|thru|through)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*" + AMPM + "?", "i");
const FROM = new RegExp("\\b(?:from|after|starting(?: at)?|starts(?: at)?|at)\\s+(\\d{1,2})(?::(\\d{2}))?\\s*" + AMPM, "i");
const UNTIL = new RegExp("\\b(?:until|till|before|ends(?: at)?)\\s+(\\d{1,2})(?::(\\d{2}))?\\s*" + AMPM, "i");

function dayIndex(word: string): number {
  return DAY_NAMES.indexOf(word.slice(0, 3).toLowerCase());
}

/** Days named in a sentence, ranges expanded. Empty for "daily", "every night" and such. Null when no day word at all. */
export function daysIn(text: string): number[] | null {
  if (!HAS_DAY.test(text)) return null;
  const out = new Set<number>();
  let rest = text;
  for (const m of text.matchAll(DAY_RANGE)) {
    const a = dayIndex(m[1]);
    const b = dayIndex(m[2]);
    if (a < 0 || b < 0) continue;
    for (let d = a; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === b) break;
    }
    rest = rest.replace(m[0], " ");
  }
  for (const m of rest.matchAll(DAY_ONE)) {
    const d = dayIndex(m[1]);
    if (d >= 0) out.add(d);
  }
  if (WEEKDAYS.test(text)) [1, 2, 3, 4, 5].forEach((d) => out.add(d));
  if (WEEKENDS.test(text)) [0, 6].forEach((d) => out.add(d));
  if (!out.size && EVERY_DAY.test(text)) return [];
  if (!out.size) return null;
  return [...out].sort((a, b) => a - b);
}

function toMinutes(h: number, m: number, ap: string | undefined): number | null {
  const a = (ap || "").replace(/\./g, "").toLowerCase();
  if (h < 0 || h > 12 || m > 59) return null;
  if (a === "noon") return 12 * 60;
  if (a === "midnight") return 0;
  let hh = h;
  if (a === "pm" && hh < 12) hh += 12;
  if (a === "am" && hh === 12) hh = 0;
  return hh * 60 + m;
}

function hhmm(min: number): string {
  return String(Math.floor(min / 60) % 24).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}

/** "4-6pm" -> 16:00 to 18:00, "10am-12pm" -> 10:00 to 12:00, "from 7pm" -> start only. Needs an am/pm, so "ages 4-6" is not a time. */
export function timeWindow(text: string): { start?: string; end?: string } {
  const r = RANGE.exec(text);
  if (r && (r[3] || r[6])) {
    const endAp = r[6] || r[3];
    const end = toMinutes(Number(r[4]), Number(r[5] || 0), endAp);
    let start = toMinutes(Number(r[1]), Number(r[2] || 0), r[3] || endAp);
    if (start != null && end != null && start >= end && !r[3]) {
      // "11-1pm": the start is before noon.
      const alt = toMinutes(Number(r[1]), Number(r[2] || 0), /pm/i.test(endAp || "") ? "am" : "pm");
      if (alt != null && alt < end) start = alt;
    }
    if (start != null && end != null && start < end) return { start: hhmm(start), end: hhmm(end) };
  }
  const out: { start?: string; end?: string } = {};
  const f = FROM.exec(text);
  if (f) {
    const s = toMinutes(Number(f[1]), Number(f[2] || 0), f[3]);
    if (s != null) out.start = hhmm(s);
  }
  const u = UNTIL.exec(text);
  if (u) {
    const e = toMinutes(Number(u[1]), Number(u[2] || 0), u[3]);
    if (e != null) out.end = hhmm(e);
  }
  return out;
}

function cleanSentence(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|nbsp|#160|quot|#39|apos);/gi, (m) => ({ "&amp;": "&", "&nbsp;": " ", "&#160;": " ", "&quot;": '"', "&#39;": "'", "&apos;": "'" })[m.toLowerCase()] || " ")
    .replace(/[*_#`>]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:[-–•·*]|\(?\d{1,2}[.)])\s+/, "")
    .replace(/\s+([,.!;:])/g, "$1")
    .replace(/^[^A-Za-z0-9$"'(]+|[\s:;,-]+$/g, "")
    .trim();
}

/** Split page text into candidate sentences: newlines, bullets and sentence ends all break. */
function sentences(text: string): string[] {
  return text
    .split(/\n+|\s+[|•·]\s+|(?<=[.!?])\s+(?=[A-Z$0-9"'(])/)
    .map(cleanSentence)
    .filter((s) => s.length >= 12);
}

/** Every day-specific deal the page states, as written, deduped by text. */
export function minePromos(text: string, pageUrl: string): Promo[] {
  const out: Promo[] = [];
  const seen = new Set<string>();
  for (const s of sentences(text)) {
    if (s.length > 160) continue;
    if (JUNK.test(s) || NOT_A_DEAL.test(s) || ONE_OFF.test(s)) continue;
    if (!DEAL.test(s)) continue;
    const days = daysIn(s);
    if (days === null) continue;
    // A price list line with a day in it is not a promo unless the day is what the deal hangs on.
    if (/^\$?\d+(\.\d+)?\s*$/.test(s)) continue;
    const key = s.toLowerCase().replace(/[^a-z0-9$%]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const win = timeWindow(s);
    out.push({ text: s, days, ...win, source: pageUrl });
  }
  return out;
}

const PAGE_WORD = /\b(deals?|specials?|promos?|promotions?|offers?|discounts?|savings?|events?|calendar|happy[- ]hour|nights?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekly|weekday|weekend|pricing|prices|rates|admission)\b/i;
const SKIP = /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|zip)$|\/(wp-json|feed|tag|category|author|cart|checkout|login|account|privacy|terms|blog\/page)\b/i;

/** Internal links that look like a deals, specials, events or pricing page. At most four, home page order. */
export function promoPages(html: string, baseUrl: string): string[] {
  const $ = load(html);
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    if (out.length >= 4) return;
    try {
      const u = new URL($(el).attr("href") || "", baseUrl);
      if (u.origin !== origin) return;
      if (u.pathname === "/" || SKIP.test(u.pathname)) return;
      const probe = u.pathname.replace(/[-_/.]+/g, " ") + " " + $(el).text().replace(/\s+/g, " ");
      if (!PAGE_WORD.test(probe)) return;
      const key = u.origin + u.pathname;
      if (!out.includes(key)) out.push(key);
    } catch {
      /* ignore */
    }
  });
  return out.slice(0, 4);
}

/** Visible text of a page with block boundaries kept as newlines, nav and footer removed. */
export function pageText(html: string): string {
  const $ = load(html);
  $("script, style, noscript, svg, iframe, nav, footer, template").remove();
  $("br").replaceWith("\n");
  $("p, li, h1, h2, h3, h4, h5, h6, div, td, th, dt, dd, tr, section, article, blockquote, header").each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  return $("body").text().replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").slice(0, 60000);
}

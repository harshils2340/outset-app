/**
 * Customer reviews: one model, one set of quality rules.
 *
 * Reviews reach a listing from the operator's own website and booking pages only: schema.org Review markup,
 * testimonial sections, and review widgets the operator embeds that print the review text into the page. A
 * widget that names the platform it shows ("Google review", a TripAdvisor badge) sets `source` to that platform,
 * but nothing here follows a widget to the platform or reads Google, Yelp, TripAdvisor or Facebook directly.
 *
 * Every field is what the page said. A rating only appears when the page states one, a date only when the page
 * prints a calendar date, an author only when the page names one. When a field is doubtful it is null, never a
 * guess. This file needs no database, so the cloud crawl (`enrich/sitescrape.ts`) and the sync (`quotes.ts`)
 * both use it.
 */

export type ReviewSource =
  | "site"
  | "google"
  | "tripadvisor"
  | "yelp"
  | "facebook"
  | "fareharbor"
  | "peek"
  | "xola"
  | "viator"
  | "airbnb"
  | "getyourguide"
  | "expedia"
  | "trustpilot";

export type Review = {
  author: string | null;
  /** 1 to 5, only when the page states it. */
  rating: number | null;
  text: string;
  /** ISO "YYYY-MM-DD" or "YYYY-MM", only when the page prints a calendar date. */
  date: string | null;
  source: ReviewSource;
  /** The operator's page the review was read on. */
  sourceUrl: string;
};

export const MAX_REVIEWS = 12;

const PLATFORMS: [RegExp, ReviewSource][] = [
  [/trip ?advisor/i, "tripadvisor"],
  [/\byelp\b/i, "yelp"],
  [/facebook|\bfb\b/i, "facebook"],
  [/fare ?harbor/i, "fareharbor"],
  [/\bviator\b/i, "viator"],
  [/get ?your ?guide/i, "getyourguide"],
  [/\bairbnb\b/i, "airbnb"],
  [/\bexpedia\b/i, "expedia"],
  [/trustpilot/i, "trustpilot"],
  [/\bxola\b/i, "xola"],
  [/\bpeek\b/i, "peek"],
  [/google/i, "google"],
];

/** The platform a label, class name, logo file or link names, if any. */
export function sourceFromLabel(s: string | null | undefined): ReviewSource | null {
  if (!s) return null;
  for (const [re, src] of PLATFORMS) if (re.test(s)) return src;
  return null;
}

// ---------------------------------------------------------------- text

const STAR_GLYPHS = /[\u2605\u2606\u2729\u272a\u2b50\u2b51\uf005\uf006\uf123\ue000-\uf8ff]/g;
const CHROME = [
  /\b(?:read|see|show|view) (?:more|less|full review|the full review)\b\.?/gi,
  /\bsee more\s*see less\b/gi,
  /\b(?:posted|reviewed|written) (?:on|via|at) (?:google|tripadvisor|trip advisor|yelp|facebook)\b/gi,
  /\b(?:google|tripadvisor|yelp|facebook) review\b/gi,
  /\bverified (?:review|reviewer|buyer|customer|guest)\b/gi,
  /\b(?:trip type|date of experience|date of visit|travell?ed as a)\s*:\s*[a-z0-9 ,]{0,30}?(?=[A-Z]|$)/g,
  /\b\d(?:\.\d)?\s*(?:out of|\/)\s*5(?:\s*stars?)?\b/gi,
  /\b(?:rated|rating)\s*:?\s*\d(?:\.\d)?\b/gi,
];
const HEADING = /^(?:what (?:people|our (?:guests|customers|clients|riders|divers|students)) (?:are |have been )?say(?:ing)?|testimonials?|guest reviews?|customer reviews?|reviews?|kind words)\s*[:\-–—]?\s*/i;
/** Where a business's reply to a review begins. Everything from here on is the business talking. */
const REPLY_START =
  /(?:\b(?:response|reply|comment) (?:from|by) (?:the )?(?:owner|business|management|host|team|staff)\b|\bowner(?:'s)? (?:response|reply)\b|\bmanagement response\b|\bbusiness response\b)/i;
/** A text that opens like a reply to a reviewer rather than a review. */
const REPLY_OPENING =
  /^(?:(?:hi|hello|dear|hey) [A-Z][\w.'-]*(?: [A-Z][\w.'-]*)?[,!.]?\s+)?(?:thank(?:s| you)(?: so much| very much)?,? (?:[A-Z][a-z]+,? )?for (?:your (?:review|feedback|kind|business|support|comments?|visit|patience)|the (?:kind words|review|great review|feedback|shout ?out|5[- ]star)|taking the time|choosing (?:us|[A-Z])|sharing your|leaving (?:us|a|this)|visiting us|joining us|coming (?:out )?to see us)|we(?:'re| are) (?:so )?(?:glad|happy|sorry|thrilled|delighted) (?:you|to hear)|we appreciate (?:your|you))/i;

/** The business describing itself or selling: rejected even when a guest-sounding sentence sits beside it. */
const MARKETING = [
  /\bwe (?:offer|provide|specialize|specialise|pride ourselves|strive|guarantee|invite you|welcome (?:you|all|guests)|cater to|are (?:proud to|(?:dedicated|committed) to (?:providing|delivering|making|ensuring|excellence|safety|your|our|the best)|a (?:family[- ]owned|locally owned|small business)|an? (?:award[- ]winning|full[- ]service|premier))|have been (?:serving|providing|in business))\b/i,
  /\blicensed (?:and|&) insured\b/i,
  /\b(?:established|founded) in \d{4}\b/i,
  /\bgift (?:cards?|certificates?) (?:are )?available\b/i,
  /\b(?:click here|subscribe|newsletter|reserve your (?:spot|seat)|contact us today|call us today)\b/i,
  /\b(?:limited|few) (?:spots|seats) (?:left|available|remaining)\b/i,
  /\bwe (?:do )?have (?:a )?(?:boats?|spots?|seats?|openings?|availability) (?:open|available|left)\b/i,
  /\bhope (?:everyone|you all) (?:has|have)\b/i,
  /https?:\/\/|www\.|@[a-z0-9-]+\.[a-z]{2,}|\(\d{3}\)\s?\d{3}|\b\d{3}[-.]\d{3}[-.]\d{4}\b/i,
  /^welcome to\b/i,
  /\bplease (?:pay|note|allow|be advised)\b/i,
  /\b(?:accept|use of|uses|we use) cookies\b|\b(?:javascript|privacy policy|all rights reserved|copyright)\b/i,
];
/** Phrases a guest also writes ("book online, it was easy", "our crew of six"): rejected only when nothing else reads like a guest. */
const MARKETING_SOFT = [
  /\bour (?:team|staff|company|crew|captains|guides) (?:is|are|will|has|have|of)\b/i,
  /\bbook (?:now|today|online|with us|your (?:tour|trip|charter|adventure|experience|session|class|party|jump|flight|ride))\b/i,
  /\b(?:call|contact|email|text) us\b/i,
  /\b(?:join|visit) us\b(?! again)/i,
  /\bfamily[- ](?:owned|operated)\b/i,
  /\bsign up\b/i,
  /\$\s?\d[\d,.]*\s*(?:\/|per|an?)\s*(?:hour|hr|person|guest|day|night|week|boat|ski)\b/i,
];
/** A person telling what happened to them. */
const GUEST_VOICE =
  /\b(?:i|we|my (?:wife|husband|family|kids|son|daughter|friends?|boyfriend|girlfriend|group|dad|mom|partner|grandsons?|granddaughters?))\b[^.!?]{0,40}\b(?:had|went|took|booked|rented|enjoyed|loved|saw|caught|did|tried|came|visited|felt|got|chose|called|fish|flew|jumped|highly)\b|\b(?:blown away|exceeded (?:my|our|all)|had a blast|loved every|by far the best|so much fun|a lot of fun|highly recommend|would recommend|we recommend|will (?:definitely )?(?:be back|return|come back)|can'?t wait to|best (?:day|time|trip|experience|tour)|worth every)\b|\b(?:was|were) (?:amazing|awesome|great|fantastic|excellent|wonderful|incredible|outstanding|superb|so (?:fun|helpful|friendly|patient|knowledgeable))\b/i;

/** The marketing phrase a text matches, for audits; null when it reads like a guest. */
export function marketingHit(text: string): string | null {
  const hard = MARKETING.find((r) => r.test(text));
  if (hard) return text.match(hard)?.[0] ?? hard.source;
  const soft = MARKETING_SOFT.find((r) => r.test(text));
  if (soft && !GUEST_VOICE.test(text)) return text.match(soft)?.[0] ?? soft.source;
  return null;
}

export function isMarketing(text: string): boolean {
  return marketingHit(text) != null;
}

/** Does this read like a person describing what happened to them? For loosely structured pages only. */
export function soundsLikeReview(text: string): boolean {
  return /\b(?:i|i'm|i've|my|me|we|we're|we've|our|us)\b/i.test(text) || (/!/.test(text) && POSITIVE.test(text)) || /\b(?:recommend|thank you|thanks)\b/i.test(text);
}

const POSITIVE =
  /\b(?:amazing|awesome|fantastic|excellent|wonderful|incredible|outstanding|superb|phenomenal|terrific|best|perfect|loved|love it|blast|unforgettable|highly recommend|would recommend|recommend (?:it|them|this)|great (?:time|experience|day|trip|tour)|so much fun|10\/10|five stars|5 stars|beautiful|exceptional|memorable|knowledgeable|professional|friendly)\b/gi;
const NEGATION_OK =
  /\b(?:(?:did not|didn't|won't|will not|wouldn't|never|not) (?:be )?disappoint(?:ed|s)?|no complaints|nothing (?:bad|negative)|can(?:'t|not) say enough|not (?:a )?(?:single )?(?:problem|issue|complaint))\b/gi;
const NEGATIVE =
  /\b(?:terrible|horrible|awful|worst|rude|unprofessional|never again|waste of (?:money|time)|disappoint(?:ed|ing|ment)|refund|scam|rip ?off|avoid|dirty|unsafe|would not recommend|wouldn't recommend|do not recommend|don't recommend|not recommend|cancel(?:l)?ed on us|no show|poor(?:ly)?|overpriced|not worth|not (?:good|great|fun|happy))\b/gi;

function count(re: RegExp, s: string): number {
  return (s.match(re) || []).length;
}

/** A rating the words disagree with is a parse error until proven otherwise: null, not a guess. */
export function ratingFitsText(rating: number | null, text: string): number | null {
  if (rating == null) return null;
  const t = text.replace(NEGATION_OK, " ");
  const pos = count(POSITIVE, t);
  const neg = count(NEGATIVE, t);
  if (rating <= 2 && pos >= 2 && neg === 0) return null;
  if (rating >= 4 && neg >= 2 && pos === 0) return null;
  return rating;
}

/** Strip page chrome off the reviewer's words. Returns the words, or "" when nothing of the review is left. */
export function cleanReviewText(raw: string): string {
  let t = raw.replace(/\u00a0/g, " ").replace(STAR_GLYPHS, " ");
  const reply = t.search(REPLY_START);
  if (reply >= 0) t = t.slice(0, reply);
  for (const re of CHROME) t = t.replace(re, " ");
  t = t.replace(/\s+/g, " ").trim().replace(HEADING, "");
  t = t.replace(/^[\s"“”'‘’«»]+|[\s"“”'‘’«»]+$/g, "").trim();
  // A widget that cut the text ("…the scenery absolutely be...") keeps the whole sentences before the cut.
  if (/(?:\.\.\.|…)$/.test(t)) {
    const cut = Math.max(t.lastIndexOf(". ", t.length - 4), t.lastIndexOf("! ", t.length - 4), t.lastIndexOf("? ", t.length - 4));
    t = cut >= 60 ? t.slice(0, cut + 1) : t.replace(/\s*(?:\.\.\.|…)$/, "").replace(/\s+\S*$/, "") + "…";
  }
  // Over 700 characters: whole sentences up to that point. Over 2,500 it was page copy, not a review.
  if (t.length > 2500) return "";
  if (t.length > 700) {
    const head = t.slice(0, 700);
    const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
    t = end > 200 ? head.slice(0, end + 1) : head.replace(/\s+\S*$/, "") + "…";
  }
  return t;
}

// ---------------------------------------------------------------- fields

const NOT_A_NAME = /\b(?:anonymous|a guest|guest review|verified|customer|google|tripadvisor|yelp|facebook|review(?:er|s)?|testimonials?|recommend|amazing|great|best|love|thank|five star|posted|read more|happy client)\b/i;

/** "- Wendy B. • Tripadvisor review" -> { author: "Wendy B.", source: "tripadvisor" }. */
export function cleanAuthor(raw: string | null | undefined): { author: string | null; source: ReviewSource | null } {
  if (!raw) return { author: null, source: null };
  const s = raw.replace(STAR_GLYPHS, " ").replace(/\s+/g, " ").replace(/^(?:[-–—~]+|posted by|reviewed by|by)\s*/i, "").trim();
  const parts = s.split(/\s*(?:[|•·]|\s[-–—]\s|,\s*(?=(?:via )?(?:google|trip ?advisor|yelp|facebook)))\s*/i).map((p) => p.trim()).filter(Boolean);
  let source: ReviewSource | null = null;
  const names: string[] = [];
  for (const p of parts) {
    const src = sourceFromLabel(p);
    if (src && /^(?:via |on |from )?(?:google|trip ?advisor|yelp|facebook|fare ?harbor|viator|airbnb|expedia|trustpilot|get ?your ?guide)(?: reviews?| user| guest)?$/i.test(p)) source = src;
    else names.push(p);
  }
  let author = (names[0] || "").replace(/[,:;]+$/, "").trim();
  if (!author || author.length > 60 || author.split(/\s+/).length > 5 || /[!?]$|\.\s|\d{3}/.test(author) || NOT_A_NAME.test(author) || !/[A-Za-z]/.test(author)) author = "";
  return { author: author || null, source };
}

/** 1 to 5 from a stated value, scaled only when the page states its own scale ("9 out of 10"). */
export function parseRating(value: unknown, best?: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const b = Number(best);
  const scaled = Number.isFinite(b) && b > 0 && b !== 5 ? (n / b) * 5 : n;
  if (scaled < 1 || scaled > 5) return null;
  return Math.round(scaled * 10) / 10;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function monthOf(word: string): number {
  const i = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  return i < 0 ? 0 : i + 1;
}

function isoIfReal(y: number, m: number, d: number | null, now = new Date()): string | null {
  if (y < 100) y += 2000;
  if (y < 2000 || m < 1 || m > 12) return null;
  if (d != null && (d < 1 || d > 31)) return null;
  const iso = d != null ? `${y}-${pad(m)}-${pad(d)}` : `${y}-${pad(m)}`;
  // A review from the future is a misread.
  if (new Date(d != null ? iso : iso + "-01").getTime() > now.getTime() + 86400000) return null;
  return iso;
}

/** A calendar date the page printed, as ISO. "2 months ago" and "via Google" are not dates. */
export function parseReviewDate(raw: string | null | undefined, now = new Date()): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ][\d:.+\-Z]*)?$/);
  if (m) return isoIfReal(+m[1], +m[2], m[3] ? +m[3] : null, now);
  const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
  m = s.match(new RegExp("\\b" + MON + "\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b", "i"));
  if (m) return isoIfReal(+m[3], monthOf(m[1]), +m[2], now);
  m = s.match(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MON + ",?\\s+(\\d{2}|\\d{4})\\b", "i"));
  if (m) return isoIfReal(+m[3], monthOf(m[2]), +m[1], now);
  m = s.match(new RegExp("\\b" + MON + ",?\\s+(\\d{4})\\b", "i"));
  if (m) return isoIfReal(+m[2], monthOf(m[1]), null, now);
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    // 07/05/2018 could be July 5 or 7 May. Only an unambiguous one becomes a date.
    if (a > 12 && b <= 12) return isoIfReal(+m[3], b, a, now);
    if (b > 12 && a <= 12) return isoIfReal(+m[3], a, b, now);
    if (a === b) return isoIfReal(+m[3], a, b, now);
    return null;
  }
  return null;
}

// ---------------------------------------------------------------- one review, many reviews

export type RawReview = {
  author?: string | null;
  rating?: unknown;
  bestRating?: unknown;
  text: string;
  date?: string | null;
  source?: ReviewSource | string | null;
  sourceUrl: string;
  /** Loosely structured (a bare blockquote, a paragraph pair): must also read like a person's experience. */
  loose?: boolean;
};

/** Apply every rule to one review. Null when it is not a review a guest should read. */
export function normalizeReview(raw: RawReview, now = new Date()): Review | null {
  if (!raw || typeof raw.text !== "string") return null;
  const { author: cleanName, source: authorSource } = cleanAuthor(raw.author);
  let author = cleanName;
  let text = cleanReviewText(raw.text);
  // A signature before the words: '- Lisa, Birthday Celebration "Best birthday surprise ever!…'.
  const lead = text.match(/^[-–—~]\s*([A-Z][^"“,]{0,40})(?:,[^"“]{0,40})?\s*["“]/);
  if (lead) {
    if (!author) author = cleanAuthor(lead[1]).author;
    text = text.slice(lead[0].length).replace(/["”]\s*$/, "").trim();
  }
  // A signature at the end of the words ("… we'll be back! - Jane D.") is the author, not the review.
  const sig = text.match(/\s+[-–—~]\s*([A-Z][\w.'’-]*(?:\s+[A-Z][\w.'’-]*){0,3})\s*$/);
  if (sig) {
    if (!author) author = cleanAuthor(sig[1]).author;
    text = text.slice(0, sig.index).trim();
  }
  // The name glued onto the front by a widget ("Seth Luna Good prices…").
  if (author && text.toLowerCase().startsWith(author.toLowerCase() + " ")) text = text.slice(author.length).trim();
  text = text.replace(/^[\s"“”'‘’:,-]+|[\s"“”'‘’]+$/g, "").trim();
  if (text.length < 30) return null;
  // A job title or caption ("Mayor, City of Victoria, September 2022"): short, no sentence, mostly capitalised words.
  const words = text.split(/\s+/);
  if (words.length < 12 && !/[.!?]/.test(text) && words.filter((w) => /^[A-Z0-9]/.test(w)).length / words.length > 0.5) return null;
  if (REPLY_OPENING.test(text)) return null;
  if (isMarketing(text)) return null;
  if (raw.loose && !soundsLikeReview(text)) return null;
  // A heading repeated as the "author" is site copy.
  if (author && text.toLowerCase().startsWith(author.toLowerCase())) return null;
  const rating = ratingFitsText(parseRating(raw.rating, raw.bestRating), text);
  const declared = typeof raw.source === "string" ? (raw.source === "site" || raw.source === "schema" ? "site" : sourceFromLabel(raw.source)) : null;
  const source: ReviewSource = declared && declared !== "site" ? declared : authorSource || "site";
  return { author, rating, text, date: parseReviewDate(raw.date, now), source, sourceUrl: raw.sourceUrl };
}

/** The same review on two pages, or once as JSON-LD and once as HTML, shares its opening words. */
export function reviewKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
}

function score(r: Review, now: Date): number {
  let s = 0;
  if (r.author) s += 3;
  if (r.rating != null) s += 2;
  if (r.date) {
    const age = (now.getTime() - new Date(r.date.length === 7 ? r.date + "-01" : r.date).getTime()) / (365 * 86400000);
    s += age <= 2 ? 3 : age <= 5 ? 2 : 1;
  }
  if (r.text.length >= 80 && r.text.length <= 450) s += 1;
  return s;
}

/** Dedupe, then keep the best `max`: named, rated and recent first. Never fills a field the review lacked. */
export function selectReviews(list: (Review | null)[], max = MAX_REVIEWS, now = new Date()): Review[] {
  const byKey = new Map<string, Review>();
  const order: string[] = [];
  for (const r of list) {
    if (!r) continue;
    const k = reviewKey(r.text);
    // One review cut short on one page and whole on another: the shorter opening is the key.
    const twin = byKey.has(k) ? k : order.find((o) => o.length >= 40 && k.length >= 40 && (o.startsWith(k) || k.startsWith(o)));
    if (!twin) {
      byKey.set(k, { ...r });
      order.push(k);
      continue;
    }
    const cur = byKey.get(twin)!;
    const sameAuthor = !cur.author || !r.author || cur.author.toLowerCase() === r.author.toLowerCase();
    const richer = score(r, now) > score(cur, now) || (score(r, now) === score(cur, now) && r.text.length > cur.text.length);
    const keep = richer ? { ...r } : cur;
    const other = richer ? cur : r;
    if (sameAuthor) {
      keep.author ??= other.author;
      keep.rating ??= other.rating;
      keep.date ??= other.date;
      if (keep.source === "site" && other.source !== "site") keep.source = other.source;
    }
    byKey.set(twin, keep);
  }
  return order
    .map((k, i) => ({ r: byKey.get(k)!, i }))
    .sort((a, b) => score(b.r, now) - score(a.r, now) || a.i - b.i)
    .slice(0, max)
    .map((x) => x.r);
}

/**
 * A stored `review` fact in either shape: the new model, or the loose `{ a, r, t, d, s }` the first review
 * pass wrote (where the platform was glued to the name as "Liz S. | Yelp").
 */
export function parseReviewFact(value: string, sourceUrl: string | null = null, now = new Date()): Review | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  if (typeof o.text === "string") {
    return normalizeReview({ author: o.author as string | null, rating: o.rating, text: o.text, date: o.date as string | null, source: o.source as string, sourceUrl: String(o.sourceUrl || sourceUrl || "") }, now);
  }
  if (typeof o.t === "string") {
    return normalizeReview({ author: o.a as string | null, rating: o.r, text: o.t, date: o.d as string | null, source: o.s as string, sourceUrl: String(sourceUrl || "") }, now);
  }
  return null;
}

// ---------------------------------------------------------------- aggregate

export type AggregateRating = { rating: number; count: number; source: ReviewSource; sourceUrl: string };

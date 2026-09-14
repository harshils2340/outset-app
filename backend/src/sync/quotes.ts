import { normalizeReview, parseReviewFact, selectReviews, MAX_REVIEWS, type Review, type ReviewSource } from "./reviews.ts";

/**
 * Reviews as a listing publishes them (`quotes` on the detail file).
 *
 * Review widgets flatten their markup into one string, so a crawled review reads
 * "Seth Luna2 months agoGood prices…" or "Adam Stephenson16:59 05 Jul 18Best charter…". Split the name and
 * the date back off the words first, then every rule in `reviews.ts` applies: chrome and business replies
 * stripped, marketing copy and short fragments rejected, a rating the words contradict set to null, duplicates
 * merged, at most twelve kept. Reads both stored shapes: the model in `reviews.ts` and the loose `{ a, r, t, d, s }`.
 */

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const RELATIVE = /^(?:\d{1,3}|an?|one)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\s*/i;
const DATE_PREFIXES: RegExp[] = [
  // Google widget timestamps: "16:59 05 Jul 18"
  new RegExp("^\\d{1,2}:\\d{2}\\s+(\\d{1,2}\\s+" + MONTH + "\\s+\\d{2,4})\\s*", "i"),
  // "05 Jul 2018", "July 5, 2018", "Jul 2018"
  new RegExp("^(\\d{1,2}\\s+" + MONTH + "\\s+\\d{2,4})\\s*", "i"),
  new RegExp("^(" + MONTH + "\\s+(?:\\d{1,2},?\\s+)?\\d{4})\\s*", "i"),
  // "07/05/2018", "2018-07-05"
  /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*/,
  /^(\d{4}-\d{2}-\d{2})\s*/,
];

/** What a guest's review card reads. `date` is ISO ("2024-07-05" or "2024-07"); `source` names the platform shown on the operator's page, or "site". */
export type Quote = { author?: string; rating?: number; text: string; date?: string; source?: ReviewSource };

type LooseQuote = { author?: string | null; rating?: number | null; text: string; date?: string | null; source?: string | null; sourceUrl?: string | null };

/** Take a glued-on name and a leading timestamp off the words. Relative dates ("2 months ago") are dropped, not kept. */
function unglue(q: LooseQuote): LooseQuote {
  let text = q.text.replace(/\s+/g, " ").trim();
  let author = q.author || null;
  let date = q.date || null;
  if (author && text.toLowerCase().startsWith(author.toLowerCase())) text = text.slice(author.length).trimStart();
  // No name came through, but the widget still glued one on: "Danielle B.1 year agoOur experience…".
  const glued = !author && text.match(/^([A-Z][A-Za-z.'’\- ]{0,38}[A-Za-z.])(?=\d{1,3}\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|\d{1,2}:\d{2}\s+\d{1,2}\s+[A-Z][a-z]{2})/);
  if (glued) {
    author = glued[1].trim();
    text = text.slice(glued[1].length);
  }
  const rel = text.match(RELATIVE);
  if (rel) text = text.slice(rel[0].length);
  else {
    for (const re of DATE_PREFIXES) {
      const m = text.match(re);
      if (m) {
        date ??= m[1];
        text = text.slice(m[0].length);
        break;
      }
    }
  }
  // An old pass stored the platform where the date belongs: "via Google".
  let source = q.source || null;
  if (date && /^via\s+/i.test(date)) {
    if (!source || source === "site" || source === "schema") source = date.replace(/^via\s+/i, "");
    date = null;
  }
  return { ...q, author, text, date, source };
}

function toQuote(r: Review): Quote {
  return { ...(r.author ? { author: r.author } : {}), ...(r.rating != null ? { rating: r.rating } : {}), text: r.text, ...(r.date ? { date: r.date } : {}), source: r.source };
}

/** One review in either shape, cleaned. Null when it is not a review a guest should read. */
export function cleanQuote(q: LooseQuote | Review): Quote | null {
  const u = unglue(q as LooseQuote);
  const r = normalizeReview({ author: u.author, rating: u.rating, text: u.text, date: u.date, source: u.source, sourceUrl: u.sourceUrl || "" });
  return r ? toQuote(r) : null;
}

/** Every stored `review` fact value for one listing, to the published list: cleaned, deduped, best twelve. */
export function quotesFromFacts(values: (string | { value: string; sourceUrl?: string | null })[]): Quote[] {
  const reviews = values.map((v) => {
    const value = typeof v === "string" ? v : v.value;
    const url = typeof v === "string" ? null : v.sourceUrl || null;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
    // Old shape: unglue before the rules, since that pass stored widget text as it came.
    if (o && typeof o.t === "string") {
      const u = unglue({ author: o.a as string | null, rating: o.r as number | null, text: o.t, date: o.d as string | null, source: o.s as string | null });
      return normalizeReview({ author: u.author, rating: u.rating, text: u.text, date: u.date, source: u.source, sourceUrl: url || "" });
    }
    return parseReviewFact(value, url);
  });
  return selectReviews(reviews, MAX_REVIEWS).map(toQuote);
}

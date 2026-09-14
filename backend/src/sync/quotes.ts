/**
 * Review widgets flatten their markup into one string, so a crawled review reads
 * "Seth Luna2 months agoGood prices…" or "Adam Stephenson16:59 05 Jul 18Best charter…". Split the name and
 * the date back off the words, strip icon-font stars, and drop what is left too short or cut mid-sentence.
 */

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_PREFIXES: RegExp[] = [
  // "2 months ago", "a year ago", "an hour ago"
  /^(?:\d{1,3}|an?|one)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\s*/i,
  // Google widget timestamps: "16:59 05 Jul 18"
  new RegExp("^\\d{1,2}:\\d{2}\\s+\\d{1,2}\\s+" + MONTH + "\\s+\\d{2,4}\\s*", "i"),
  // "05 Jul 2018", "July 5, 2018", "Jul 2018"
  new RegExp("^\\d{1,2}\\s+" + MONTH + "\\s+\\d{2,4}\\s*", "i"),
  new RegExp("^" + MONTH + "\\s+(?:\\d{1,2},?\\s+)?\\d{4}\\s*", "i"),
  // "07/05/2018", "2018-07-05"
  /^\d{1,2}\/\d{1,2}\/\d{2,4}\s*/,
  /^\d{4}-\d{2}-\d{2}\s*/,
];

const ICON_GLYPHS = /[-★☆✩✪⭐]/g;
const HEADINGS = /^(?:what (?:people|our (?:guests|customers|clients)) (?:are|have been) saying|testimonials?|reviews?|customer reviews)\s*[:\-–—]?\s*/i;

export type Quote = { author?: string; rating?: number; text: string; date?: string };

export function cleanQuote(q: Quote): Quote | null {
  let text = q.text.replace(ICON_GLYPHS, " ").replace(/\s+/g, " ").trim();
  let date = q.date;
  text = text.replace(HEADINGS, "");
  let author = q.author?.replace(ICON_GLYPHS, "").trim() || undefined;
  if (author && text.toLowerCase().startsWith(author.toLowerCase())) text = text.slice(author.length).trimStart();
  // No name came through, but the widget still glued one on: "Danielle B.1 year agoOur experience…".
  const glued = !author && text.match(/^([A-Z][A-Za-z.'’\- ]{0,38}[A-Za-z.])(?=\d{1,3}\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)/);
  if (glued) {
    author = glued[1].trim();
    text = text.slice(glued[1].length);
  }
  for (const re of DATE_PREFIXES) {
    const m = text.match(re);
    if (m) {
      if (!date) date = m[0].trim();
      text = text.slice(m[0].length);
      break;
    }
  }
  // A quoted testimonial keeps its words, not the marks around them.
  text = text.replace(/^["“”']+|["“”']+$/g, "").replace(/\s*(?:\.\.\.|…)?\s*(?:read more|more)$/i, "").trim();
  // "Had a great time! We really enjoyed" was cut by the widget: keep the whole sentences before the cut.
  const tail = text.match(/[.!?)]\s+([^.!?]+)$/);
  if (tail && tail[1].trim().split(/\s+/).length <= 4) text = text.slice(0, text.length - tail[1].length).trim();
  else if (/(?:\.\.\.|…)$/.test(text)) {
    const cut = text.search(/[.!?][^.!?]*(?:\.\.\.|…)$/);
    if (cut > 0) text = text.slice(0, cut + 1);
  }
  // A heading repeated as the "author" ("Flight Training School Flight Training School…") is site copy, not a review.
  if (author && text.toLowerCase().startsWith(author.toLowerCase())) return null;
  // "16:59 05 Jul 18" reads as a log line; a guest wants "Jul 2018".
  const stamp = date?.match(/^\d{1,2}:\d{2}\s+\d{1,2}\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})$/);
  if (stamp) date = stamp[1] + " " + (stamp[2].length === 2 ? "20" + stamp[2] : stamp[2]);
  if (text.length < 30) return null;
  return { author, rating: q.rating, text, date };
}

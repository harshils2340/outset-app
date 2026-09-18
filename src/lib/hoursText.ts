import { isTradingHoursLine } from "./openNow";

/**
 * The hour lines a guest reads, from whatever the shop's site published.
 *
 * Two surfaces print this block, the desktop listing's "Where you'll be" and the phone sheet's contact rows,
 * and a third, "Plan your visit" on a walk-in listing, printed the synced contact record with no tidying at
 * all. Across the 14,812 listings that show an Hours block, 126 published OpenStreetMap's own syntax
 * ("Mo-Tu 10:00-18:00; We off; Su off; PH off") and a guest read it as written, 226 printed the quote marks
 * around "by appointment", 361 opened on punctuation the crawl brought with it (") (6am-4pm", "& Location
 * 8am-8pm", a calendar emoji), 29 carried a zero-width space, one of them inside "Monday t​o Friday", and
 * 21 ran a day onto the end of the time before it ("Sun - Thur: 11am - 11pmFri - Sat: 11am - 1am").
 *
 * Case is left alone. A shop that shouts its hours is still stating its hours, the same way a shouted review
 * is still a review.
 */

const DAY_CODE: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun", PH: "Public holidays" };
const DAY_SPEC = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:\\s*-\\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?";
const OSM_CLAUSE = new RegExp("^(" + DAY_SPEC + "(?:\\s*,\\s*" + DAY_SPEC + ")*)(?![A-Za-z])\\s*(.*)$");
const OSM_SPAN = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;
/** A day name the crawl ran onto the end of the time before it, with no space in between. */
const GLUED_DAY = /(\d(?:\s?[ap]\.?m\.?)?)(Mon|Tues|Tue|Wednes|Wed|Thurs|Thur|Thu|Fri|Satur|Sat|Sun)(day)?\b/g;
/** Zero-width joiners, spaces and marks, a byte order mark, and the control characters a bad decode leaves. */
const INVISIBLE = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "​-‏  ﻿]", "g");

function hour12(h: number, m: string): string {
  const hh = Number(h) % 24;
  return ((hh % 12) || 12) + ":" + m + " " + (hh >= 12 ? "PM" : "AM");
}

/**
 * One OpenStreetMap rule per line, in words. Only a line whose every clause opens with day codes and whose
 * rest is a 24 hour span, "off" or a quoted note: "We work daily from 10 am to 9 pm" opens with a day code
 * and is a sentence, so it is left exactly as the shop wrote it.
 */
function osmLines(line: string): string[] | null {
  if (!/\b(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/.test(line)) return null;
  // A comma separates two rules once the rule before it has stated its hours ("Mo-Fr 05:45-19:00, Sa
  // 07:00-12:00"); before that it separates two days of one rule ("Fr,Sa 12:00-19:00").
  const clauses = line
    .split(/\s*(?:;|\|\|)\s*/)
    .flatMap((c) => c.split(/(?<=\d{1,2}:\d{2}|\boff)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/i))
    .map((c) => c.trim())
    .filter(Boolean);
  const out: string[] = [];
  let rules = 0;
  let skipped = 0;
  // "Mo-Su || by appointment": the days are stated in one clause and what happens on them in the next.
  let pending = "";
  for (const clause of clauses) {
    const m = OSM_CLAUSE.exec(clause);
    const days = m ? m[1].split(/\s*,\s*/).map((d) => d.split(/\s*-\s*/).map((x) => DAY_CODE[x] || x).join("-")).join(", ") : pending;
    const rest = (m ? m[2] : clause).trim().replace(/^["'‘“]+|["'’”]+$/g, "").trim();
    if (!rest) {
      pending = days;
      continue;
    }
    pending = "";
    const span = OSM_SPAN.exec(rest);
    const prefix = days ? days + " " : "";
    if (span) {
      out.push(prefix + hour12(Number(span[1]), span[2]) + " - " + hour12(Number(span[3]), span[4]));
      rules += 1;
    } else if (/^(off|closed)$/i.test(rest)) {
      out.push(prefix + "Closed");
      rules += 1;
    } else if (m || days) {
      out.push(prefix + rest);
    } else if (!/\b(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/.test(rest)) {
      // A note on the end of the rules with no days of its own: "|| by appointment".
      out.push(rest);
    } else skipped += 1;
  }
  // A clause the syntax does not cover ("May Mo[-1] - Oct Mo[2]") is dropped, the way the week parser drops
  // it, but only once another clause has been read as a real rule: that is what keeps an ordinary English
  // sentence starting "We" or "Sat" from being taken for this syntax at all.
  if (!rules) return clauses.length > 1 && !skipped && out.length ? out : null;
  return out.length ? out : null;
}

/** "of OperationsMon - Fri8:00 am" is a heading and a day glued to a time by the crawl: "Mon - Fri 8:00 am". */
export function tidyHours(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(/^\s*(?:hours\s+)?of\s+operations?:?\s*/i, "")
    .replace(/^hours:?\s+/i, "")
    // Whatever the crawl swept up in front of the first word: a bullet, a stray bracket, an ampersand, an emoji.
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/["“”]/g, "")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The published hour lines as a guest should read them. One line in can be two out when it names two days. */
export function displayHours(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    if (!raw || !isTradingHoursLine(raw)) continue;
    const osm = osmLines(raw.replace(INVISIBLE, "").trim());
    // "||" is the syntax's own separator and never a shop's own punctuation, so it starts a new line. A
    // semicolon is left alone: plenty of shops separate a real sentence with one, and a line that names its
    // days once ("Monday to Sunday 9am-7pm; holidays vary") means something different once it is cut in two.
    const plain = raw.replace(GLUED_DAY, "$1\n$2$3").split(/\n|\s*\|\|\s*/);
    for (const part of osm || plain) {
      const line = tidyHours(part);
      if (line && !out.includes(line)) out.push(line);
    }
  }
  return out;
}

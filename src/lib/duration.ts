/**
 * How long a booking runs, read from the words an operator's own menu uses.
 *
 * There are three readers of this one fact and they must agree: the listing page and the booking sheet print
 * it under the title, a claimed shop's published patch carries it to every guest, and Otto answers "how long
 * is it?" from it. What they all have to get past first is that a menu line states plenty of other spans:
 * how much notice a cancellation needs, how far ahead a tee time opens, how long a deposit is due in. None of
 * those is how long the thing runs, and reading one as a length told a campground's guests the trip was
 * "About 72 hours" because the shop's own words were "Cancellations prior to 72 hours".
 */

/** A line that is about money back or a missed booking states no length at all. */
const REFUND = /\b(?:cancel\w*|refund\w*|reschedul\w*|deposit|no[- ]?shows?)\b/i;
/** The words that turn a span into a notice period: "7 days in advance", "10 days notice", "2 hours before close". */
const AHEAD = /\b(?:advance|ahead|notice|prior|beforehand|before)\b/i;
/** A span as a menu line writes one: "90 min", "1.5 hours", "2-3 hours", "5 to 14 days". */
const SPAN = String.raw`\d+(?:\.\d+)?\s*(?:-|–|to)?\s*\d*(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?|days?|weeks?|months?)`;

/**
 * The same text with every span a notice rule governs taken out, so a reader downstream cannot mistake one
 * for a length. A line wholly about cancellation or a deposit loses all of it.
 *
 * Only the span the notice words actually govern goes: "3-hour boat tour starting about 2 hours before
 * sunset" keeps its three hours. "Priority" and "advanced" are not notice words, so a "4-hour watercraft
 * experience with priority scheduling" keeps its four.
 */
export function withoutNoticeWindows(text: string): string {
  const t = String(text || "");
  if (REFUND.test(t)) return "";
  return t.replace(new RegExp(SPAN + String.raw`(?=[^.;]{0,16}?` + AHEAD.source + ")", "gi"), " ");
}

/** True when the line states a span only some notice rule cares about. */
export function isNoticeWindow(text: string): boolean {
  const t = String(text || "");
  return (REFUND.test(t) || AHEAD.test(t)) && !new RegExp(SPAN, "i").test(withoutNoticeWindows(t));
}

/**
 * The first length the menu states, as the operator wrote it: "2 hours", "90 min", "1 to 4 hours".
 *
 * A booking is minutes to a day or two. Anything longer is a policy window or a course that leaked into the
 * menu text, so a yoga studio's "Repeat 8 Limbs 200-Hour Graduate" and a campground's 72 hour cancellation
 * window print nothing rather than a length nobody could book.
 */
export function durationFrom(texts: string[]): string | null {
  for (const raw of texts) {
    const t = withoutNoticeWindows(raw);
    const m = t.match(/\b(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+)?\s*(hours?|hrs?|minutes?|mins?|days?)\b/i);
    if (!m) continue;
    const n = Number(m[2] || m[1]);
    const isMin = /min/i.test(m[3]);
    const isDay = /day/i.test(m[3]);
    if ((isMin && n > 600) || (!isMin && !isDay && n > 14) || (isDay && n > 7)) continue;
    const unit = isMin ? "min" : isDay ? (n === 1 ? "day" : "days") : n === 1 ? "hour" : "hours";
    return (m[2] ? m[1] + " to " + m[2] : m[1]) + " " + unit;
  }
  return null;
}

/**
 * A length as a person would say it out loud, read once so a card, a listing page, a phone sheet, Otto and
 * the static `/l/` page all say the same thing about the same shop.
 *
 * Two shapes get rewritten. "60 min" is an hour and "90 min" an hour and a half, so cards side by side state
 * lengths the same way. And a span of a day or more is said in days: a partner's API gives a multi-day
 * product its length in minutes and the row that stores it was written in hours, so 218 shipped listings
 * told a guest a two day tour of Niagara Falls runs "48 hours", a nine day CityPASS "216 hours", and an
 * e-bike a guest may keep for a month "24 hours to 744 hours". One says "24 hours to 8760 hours", which is
 * a year. Nothing under a day is touched, and no number is invented: a span that is not a whole number of
 * days keeps one decimal, the way "1.5 hours" already does.
 */
export function sayLength(text: string): string {
  const t = String(text || "").trim();
  const asMin = t.match(/^(\d+)\s*(?:m|mins?|minutes?)\.?$/i);
  if (asMin) {
    const n = Number(asMin[1]);
    if (n >= 60 && n % 30 === 0) return n / 60 + (n === 60 ? " hour" : " hours");
    return n + " min";
  }
  const hours = t.replace(/^1 hours$/i, "1 hour").replace(/^(\d+(?:\.\d+)?)\s*hrs?$/i, (_x, n: string) => n + (Number(n) === 1 ? " hour" : " hours"));
  return hours.replace(/\b(\d+(?:\.\d+)?)\s*hours?\b/gi, (whole, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 24) return whole;
    const d = Math.round((n / 24) * 10) / 10;
    return d + (d === 1 ? " day" : " days");
  });
}

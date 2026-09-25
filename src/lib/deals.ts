/**
 * The rules a deal is read by, shared by the sync that publishes one and the app surfaces that draw one.
 *
 * The months an offer says it runs in.
 *
 * The promo crawl keeps the shop's own sentence, and plenty of those sentences date themselves: "$5 off regular
 * priced tickets every Monday Morning for the 9:30 cruise only during the months of July and August", "50% off
 * bay cruises every Monday this summer", "20% off every Wednesday from May 1 through September 1". Read as a
 * weekly rule and nothing else, every one of those is still on the listing page in October, which is a discount
 * a guest turns up expecting and does not get.
 *
 * Only what the sentence states is read. A sentence naming no month and no season returns null, the offer runs
 * all year, and that is what most of them do. A stated window is read as the season rather than as one year, so
 * a winter offer is off in September and back in December, the way the shop runs it.
 *
 * One rule, read by the sync that publishes a deal (`backend/src/sync/dealText.ts`) and again by the three app
 * surfaces that draw one, so a listing already shipped stops showing an offer whose months have passed without
 * waiting for the next sync.
 */

const MONTH =
  "\\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b";
const SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Meteorological seasons, which is how a shop in the US or Canada writes "this summer". */
const SEASON: Record<string, number[]> = {
  spring: [2, 3, 4],
  summer: [5, 6, 7],
  fall: [8, 9, 10],
  autumn: [8, 9, 10],
  winter: [11, 0, 1],
};

/** "May 1 through September 1", "December - February", "Nov thru Mar". Two named months with a range word between. */
const RANGE = new RegExp(MONTH + "\\.?(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?\\s*(?:-|\\u2013|\\u2014|to|through|thru|until|till)\\s*" + MONTH, "i");
/** "during the months of July and August", "in June and July": two or more months the sentence lists as the window. */
const LIST = new RegExp("\\b(?:months? of|in|during|throughout)\\s+(?:the\\s+)?" + MONTH + "(?:\\s*(?:,|and|&|/)\\s*(?:the\\s+)?" + MONTH + ")+", "i");
/** "during the month of July", the one wording that dates an offer with a single month and cannot be read another way. */
const ONE = new RegExp("\\bmonth of\\s+" + MONTH, "i");
/** "this summer", "all winter", "summer only". A bare season is a name ("Summer Splash") and is not read as a window. */
const SEASON_RE = /\b(?:this|all)\s+(spring|summer|fall|autumn|winter)\b|\b(spring|summer|fall|autumn|winter)[- ]only\b/i;

const monthOf = (token: string): number => SHORT.indexOf(token.slice(0, 3).toLowerCase());

/** Every month from `a` to `b` inclusive, wrapping past December so "December to February" is three months. */
function span(a: number, b: number): number[] {
  const out: number[] = [];
  for (let m = a; ; m = (m + 1) % 12) {
    out.push(m);
    if (m === b) break;
  }
  return out.sort((x, y) => x - y);
}

/** The months a sentence states its offer runs in, or null when it states none. */
export function monthsStated(text: string): number[] | null {
  if (!text) return null;
  const range = text.match(RANGE);
  if (range) {
    const a = monthOf(range[1]);
    const b = monthOf(range[2]);
    if (a >= 0 && b >= 0) return span(a, b);
  }
  const list = text.match(LIST);
  if (list) {
    const months = [...list[0].matchAll(new RegExp(MONTH, "gi"))].map((m) => monthOf(m[1])).filter((m) => m >= 0);
    if (months.length >= 2) return [...new Set(months)].sort((a, b) => a - b);
  }
  const one = text.match(ONE);
  if (one && monthOf(one[1]) >= 0) return [monthOf(one[1])];
  const season = text.match(SEASON_RE);
  if (season) return SEASON[(season[1] || season[2]).toLowerCase()];
  return null;
}

/**
 * Whether an offer written across these lines is on in `month` (0 is January). True when none of them names a
 * window, which is the ordinary case; when some do, the offer runs in the months they name between them.
 */
export function runsInMonth(texts: (string | undefined)[], month: number): boolean {
  const stated = texts.map((t) => monthsStated(t || "")).filter((m): m is number[] => !!m);
  return !stated.length || stated.some((m) => m.includes(month));
}

/**
 * The deal title a lite record carries after its day list ("2|Half-price Tuesdays"). The sync cuts it on a whole
 * word and marks what it cut with "…", so there is nothing to shorten here. Cutting again by length guessed at a
 * cap the sync does not use and shortened three of the twelve shipped badges that had arrived whole, one of them
 * from "$25 off your rental on Mondays and Tuesdays" to "$25 off your rental on Mondays…".
 */
export function liteDealTitle(deal?: string): string | null {
  if (!deal || !deal.includes("|")) return null;
  return deal.slice(deal.indexOf("|") + 1).trim() || null;
}


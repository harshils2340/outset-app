/**
 * Which reader answers for a booking link.
 *
 * Four places had to agree on this and none of them imported from any other: `plan.ts` decided the route
 * twice (once off the shortlist query, once after `resolve.ts` found a link on the shop's own site), `plan.ts`
 * picked the reader a third time in a chain of `test()` calls, and `resolve.ts` kept its own `READABLE` for
 * the flag it writes down. Four copies of one list is four chances to update three of them.
 *
 * That is not hypothetical. `vendors.ts` records, in its own comment, that "half of Xola lives on `xola.app`,
 * not `xola.com`" and widened its detection to `xola.(com|app)`. The four copies were not widened, so all 27
 * of the shipped `x2-checkout.xola.app` and `checkout.xola.app` links, every one of which `xolaRef` parses
 * perfectly, were routed to the browser agent and the guest was told there was no feed to read. Square had
 * the same gap the other way round: `squareRef` reads `square.site/book/<LOC>/<slug>`, the Appointments
 * profile page, and the four copies never sent one to it.
 *
 * So the list lives here once, and the vendor it names is what both the route and the dispatch read.
 */

/** The vendors a reader exists for today. `bookeo` is deliberately absent: see `readers/bookeo.ts`. */
export type ReaderVendor =
  | "fareharbor"
  | "resova"
  | "peek"
  | "checkfront"
  | "xola"
  | "rezdy"
  | "tripworks"
  | "square"
  | "acuity"
  | "foreup";

/**
 * Ordered, and the order is load-bearing in one place: Acuity's Squarespace host is
 * `app.squarespacescheduling.com`, which contains the word "square", so the Square rule has to be specific
 * enough not to claim it. It is, because every Square booking URL carries `/appointments` or `/book/`.
 *
 * Each pattern is the union of the shapes that vendor's own `*Ref` parser accepts, because a link the parser
 * can read and the router will not send it is a shop we could have quoted and did not.
 */
const RULES: [ReaderVendor, RegExp][] = [
  ["square", /book\.squareup\.com|squareup\.com\/appointments|square\.site\/(?:appointments\/)?book\//i],
  ["acuity", /acuityscheduling|squarespace-?scheduling|\.as\.me/i],
  ["tripworks", /tripworks\./i],
  // `xola.app` is half of them: `x2-checkout.xola.app/flows/mvp?button=...` and `checkout.xola.app/#buttons/...`.
  ["xola", /xola\.(?:com|app)/i],
  ["rezdy", /rezdy\.com/i],
  ["checkfront", /checkfront\.(?:com|site)/i],
  ["peek", /peek\.com/i],
  ["resova", /resova/i],
  ["fareharbor", /fareharbor/i],
  ["foreup", /foreupsoftware\.com/i],
];

/**
 * How many times this list has gotten smarter. `resolve.ts` writes it beside every "no reader for this shop"
 * result, so a shop resolved before Checkfront's account-embed detection landed (adventurerooms.ca: its own
 * `/booknow/` page was written down instead of the `adventureroomscanada.checkfront.com/reserve/` iframe it
 * embeds, because nothing extracted that embed yet) gets looked at again instead of staying wrong forever. A
 * shop already found readable is never re-checked — only a past miss is worth another look — so bump this by
 * one whenever `RULES` or `SQL_LIKES` above, or `vendors.ts`'s detection, gets wider.
 */
export const READER_GENERATION = 3;

/** The reader for this booking link, or null when no reader knows it. */
export function readerFor(url: string | null | undefined): ReaderVendor | null {
  if (!url) return null;
  for (const [vendor, re] of RULES) if (re.test(url)) return vendor;
  return null;
}

/** True when a reader exists for this link, so the concierge can quote a time rather than only a price. */
export function isReadable(url: string | null | undefined): boolean {
  return readerFor(url) != null;
}

/**
 * The same list as a SQLite `LIKE` predicate, for the three places that have to order rows before any regex
 * can see them.
 *
 * Two of those are the sub-select that picks *which* booking link to use when a shop has more than one, and
 * it named only FareHarbor, Resova and Peek: a shop with a Xola link and a hand-built page got the hand-built
 * page, and then read as a shop with no feed. The third is the shortlist's own ordering, which put a
 * quotable shop above an unquotable one and knew about four fewer vendors than the readers did.
 *
 * `LIKE` is case-insensitive for ASCII in SQLite, and `%` is its wildcard, so `square.site/%book/` covers
 * both the profile page and the appointments path under it.
 */
const SQL_LIKES = [
  "%fareharbor%",
  "%resova%",
  "%peek.com%",
  "%checkfront%",
  "%xola.%",
  "%rezdy.com%",
  "%tripworks.%",
  "%book.squareup.com%",
  "%squareup.com/appointments%",
  "%square.site/%book/%",
  "%acuityscheduling%",
  "%squarespacescheduling%",
  "%squarespace-scheduling%",
  "%.as.me%",
  "%foreupsoftware.com%",
];

/** `true` for a link no reader knows, so `ORDER BY unreadableSql(col)` puts the quotable shops first. */
export function unreadableSql(col: string): string {
  return SQL_LIKES.map((p) => `${col} NOT LIKE '${p}'`).join(" AND ");
}

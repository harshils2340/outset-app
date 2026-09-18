/**
 * The street line a guest reads under "Where you'll be", and the query behind "Get directions".
 *
 * `street` is whatever the crawl found in the operator's schema.org address or contact block, and on 758 of the
 * 46,516 listings that publish one it is not a street. 467 repeat the town the next line already names, so the
 * page reads "Sarasota, Sarasota, FL". 186 hold a town and a state, sometimes a different town from the city
 * beside them, so the line reads "Agawam, MA, Boston, MA" and the map link goes looking for both. 105 are a
 * house number with no road on the end of it: "3615, Wharton, TX", and one museum's whole address is "420, OH".
 * Six have the shop's phone number glued in front of the road name, "866-252-6840 Scenic Drive".
 *
 * None of those is an address anyone can walk to, and every one of them is also the text the Maps link searches
 * for. Dropping the line leaves the town and the state, which is what the rest of the page says anyway.
 *
 * The sync refuses these as it writes the catalog and this refuses the ones already in it, which keep their
 * street until a sync runs on Render.
 */

/** Words that make a line an address inside a town rather than the name of one. */
const STREET_WORD =
  /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|hwy|highway|ln|lane|way|ct|court|pkwy|parkway|cir|circle|trail|trl|terrace|ter|place|pl|route|rte|rt|suite|ste|unit|apt|floor|fl|box|pier|slip|dock|mile|marker|county|cr|fm|sr|us)\b|#\s*\d|\d/i;

/**
 * A phone number the crawl read as the start of the road name. Its own punctuation is what marks it: a space
 * between the groups would eat the house number off "144192 2253 Drive E", which is a real address.
 */
const LEADING_PHONE = /^(?:\+?1[.-]?)?(?:\(\d{3}\)\s?|\d{3}[.-])\d{3}[.-]\d{4}\s+(?=\D)/;

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The street as a page should print it, or "" when the stored street is not one. */
export function streetOf(c: { street?: string | null; city?: string | null; region?: string | null }): string {
  const street = String(c.street || "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    // "301 Montee Outaouais, , C.P. 190," left an empty field between two commas.
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/[\s,]+$/, "")
    .trim()
    .replace(LEADING_PHONE, "")
    .trim();
  if (!street) return "";
  // A house number with no road on it places nobody.
  if (!/[a-z]/i.test(street)) return "";
  const city = String(c.city || "").trim();
  const region = String(c.region || "").trim();
  if (city && (plain(street) === plain(city) || plain(street) === plain(city + region))) return "";
  // "Agawam, MA" is a town and its state, which the line under it already says, or contradicts.
  if (/^[^\d]+,\s*[A-Za-z]{2}\.?$/.test(street) && !STREET_WORD.test(street)) return "";
  return street;
}

/**
 * A postcode a letter could be addressed with. Thirty listings publish something else in the field: two codes
 * joined by a semicolon, a whole street address, half a code ("Canada N0G"), and four rows where the crawl kept
 * the tail of a word, so a Baja tour's address ends in "xico" and a California one in "lifornia".
 */
const POSTCODE = /\b(\d{5}(?:-\d{4})?|[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d)\b/;

export function postalOf(postal: string | null | undefined): string {
  const m = POSTCODE.exec(String(postal || "").trim());
  return m ? m[1] : "";
}

/** The street, town, state and postcode as one line, or null when the operator published none of them. */
export function addressOf(c: { street?: string | null; city?: string | null; region?: string | null; postal?: string | null }): string | null {
  const parts = [streetOf(c), [c.city, c.region].filter(Boolean).join(", "), postalOf(c.postal)].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

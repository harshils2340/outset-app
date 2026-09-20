/**
 * Which rows on an operator's menu are a thing a guest can actually book.
 *
 * The crawl reads a shop's menu off their own pages, so along with the services it picks up the headings those
 * pages carry. A museum's "Past Exhibitions" link becomes a menu row, and because the crawler attaches whatever
 * price sat on that page, it becomes a priced one: the shipped catalog offers "Past Exhibitions" on 333 listings
 * and charges for it on 118 of them, up to $3,000 at o-aahmsnj-org. That row opens the booking box, takes a date
 * and a party, and confirms a guest into an exhibition that closed. An FAQ heading does the same on 17 more
 * ("What is sunset seating?", "Do you offer parasailing?"), and a sentence the crawler cut in half puts "Tickets
 * are" and "Admission is" on the menu of 93 shops. 405 rows in all, across 350 listings.
 *
 * The rule is the same one the rest of this codebase keeps: a row is shown only when it really is a service, and
 * nothing is filled in to replace one that is not. A gallery whose only row named the past is left with no menu,
 * which is what two thirds of the catalog already ships as, and its page still carries the shop's hours, phone
 * and site so a guest can ring.
 *
 * `backend/src/sync/contacts.ts` calls this so the next sync stops writing these rows, and `catalog.ts` calls it
 * on every record the app loads so the 59,162 detail files already shipped are right without waiting for one.
 */

/**
 * The shop's own archive: "Past Exhibitions", "Previous Exhibits", "Exhibition Archive". Never a bookable row,
 * whatever price sits beside it, because that price belongs to something else on the page and we cannot know
 * what. "Past Life Regression" is a service and stays: only a past *showing* of something reads as an archive.
 */
export const ARCHIVE_ROW =
  /^(?:past|previous|former)[\s&]+(?:[\w&'-]+[\s&]+)?(?:exhibit|exhibition|programme|program|event|show|season|class|race|horse)s?\b|\barchives?$|^archived\b/i;

/**
 * A question the page answers about itself: "What is an escape room?", "Are pets allowed on your pontoon?". Only
 * an opening that is plainly interrogative counts, so an escape room called "Who Stole Mona?" and a heading over
 * a real price list ("Ready to go fishing?") are left alone.
 */
export const FAQ_ROW =
  /^(?:what|why|how|who|where|when|which)\s+(?:is|are|was|were|do|does|did|can|could|will|would|should|much|many|long|high|deep|far|big|old|tall|fast)\b.*\?$|^(?:do|does|did|is|are|was|were|can|could|will|would|should|am)\s+(?:i|we|you|they|it|he|she|there|all|any|my|your|our|pets|kids|children|the)\b.*\?$/i;

/**
 * The tail of a sentence the crawl cut in half: "Tickets are", "Admission is", "Boxing For". The word is dropped
 * and the row kept, because the thing in front of it is the service and its price is the shop's own. "Drop In"
 * and "Session A" are not on the list, so they are untouched.
 */
const DANGLING_WORD = /[\s;,:-]+(?:are|is|was|were|and|or|the|of|for|to|with|from|that|this|our|your)$/i;

/**
 * Punctuation the page carried that the service did not. A nav arrow on either end ("< Exhibitions",
 * "Program Punch Card Flyer>>") is the site's own chrome; a price list's dot leaders ("1 passenger ………………")
 * are the space between the name and the price; a zero width space is nothing at all. 67 shipped rows lead or
 * trail an arrow, 19 add-ons end in leaders and 18 begin with an invisible character.
 *
 * A leading arrow only goes when a letter follows it, because "< 299 photos" and "(> 6 Hours)" mean less and
 * more, and a trailing one only when it is doubled, for the same reason.
 */
const NAV_ARROW_HEAD = /^\s*[<>]+\s*(?=[A-Za-z])/;
const NAV_ARROW_TAIL = /(?:\s+[<>]+|[<>]{2,})\s*$/;
const DOT_LEADERS = /[\s.·•…]{3,}$/;
/**
 * Zero width and bidi marks, and the private use area, where an icon font keeps its glyphs: nine rows lead with
 * a Font Awesome codepoint the crawl swept up with the label, and it draws as an empty box on anyone else's
 * machine (" Season Pass upgrade").
 */
const INVISIBLE = /[​-‏‪-‮⁠﻿-]/g;

/**
 * A phone number is not the name of a service a guest books here: "Lake George Boat Tour (518) 801-7208" and
 * "campground (606-663-3650)" are two of the 8 that carry one. A separator or brackets are required, so a row
 * named for its own numbers ("Cabin 101 2 Night Stay") keeps them.
 */
const ROW_PHONE = /\s*(?:\+?1[\s.-])?(?:\(\d{3}\)\s*|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/g;

/** A row name as a guest should read it, with a half-cut sentence's trailing word taken off. */
export function tidyRowName(raw: string): string {
  const name = raw.replace(INVISIBLE, "").trim();
  let cut = name
    .replace(ROW_PHONE, " ")
    .replace(NAV_ARROW_HEAD, "")
    .replace(NAV_ARROW_TAIL, "")
    .replace(DOT_LEADERS, "")
    // Whatever the strips left holding an empty bracket, a doubled separator or a doubled space.
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/([~|·])(?:\s*\1)+/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/([([])\s+|\s+([)\]])/g, "$1$2")
    .trim();
  cut = cut.replace(DANGLING_WORD, "").trim();
  return cut.length >= 2 ? cut : name;
}

/**
 * Whether this row names something a guest can book. An archive never does. A question does only when the shop
 * priced it: at o-escapegameknoxville-net every tier under "What is an escape room?" is a real room at a real
 * price ("4 people, $30"), and dropping those would take the shop's whole menu with them, while an unpriced
 * question offers nothing at all.
 */
export function bookableRow(name: string, price: number | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  if (ARCHIVE_ROW.test(n)) return false;
  if (FAQ_ROW.test(n) && (price == null || price <= 0)) return false;
  return true;
}

type Row = { name: string; price: number | null };
type Tier = { price: number | null; optionIdx: number };
type Grouped = { name: string; variants: Tier[] };

/**
 * One listing's menu as a guest should see it: rows that are not services dropped, half-cut names tidied, and
 * every `optionIdx` re-pointed at the option it named before. `options` and `services` are one fact held in two
 * lists (see `hydrateItem`), so filtering either on its own would leave a tier pointing at the wrong trip or
 * past the end of the list.
 */
export function bookableMenu<T extends { options?: Row[]; services?: Grouped[]; addons?: { name: string }[] }>(item: T): T {
  const options = item.options || [];
  const services = item.services || [];
  // Add-ons are picked in the same booking box and carry the same page cruft: 37 of them lead with an
  // invisible character or trail a price list's dot leaders.
  const addons = item.addons || [];
  const keep: number[] = [];
  for (let i = 0; i < options.length; i++) if (bookableRow(options[i].name, options[i].price)) keep.push(i);
  const renamed = (rows: { name: string }[]) => rows.some((r) => tidyRowName(r.name) !== r.name);
  // Most of the catalog is already clean, and this runs over every record the app loads, so leave those alone.
  if (keep.length === options.length && !renamed(options) && !renamed(services) && !renamed(addons)) return item;

  const moved = new Map(keep.map((from, to) => [from, to]));
  const nextOptions = keep.map((i) => ({ ...options[i], name: tidyRowName(options[i].name) }));
  const nextServices = services
    .map((s) => ({ ...s, name: tidyRowName(s.name), variants: s.variants.filter((v) => moved.has(v.optionIdx)).map((v) => ({ ...v, optionIdx: moved.get(v.optionIdx)! })) }))
    // A service whose every tier named an archive goes with them; the picker builds its rows from the tiers.
    .filter((s) => s.variants.length > 0 && bookableRow(s.name, s.variants.find((v) => v.price != null && v.price > 0)?.price ?? null));

  return {
    ...item,
    options: nextOptions,
    ...(item.services ? { services: nextServices } : {}),
    ...(item.addons ? { addons: addons.map((a) => ({ ...a, name: tidyRowName(a.name) })) } : {}),
  };
}

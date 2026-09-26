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
 * A year of a place, not a slot at it: "Memberships", "Season Passes", "2026 Outdoor Season Memberships",
 * "Gift Cards". A guest cannot turn up at two o'clock on Saturday for an annual membership, and an operator
 * cannot accept a party of four for one, so it is not a row the booking box may offer and not a price a card
 * may quote.
 *
 * The sync already said so about services (`contacts.ts` drops the same words from the menu it publishes) and
 * said nothing about options, which is where a booking box with no services to show gets its rows: 285 shipped
 * listings offer one, 220 of them a row named plainly "Memberships", and on 74 it is the only row they have, so
 * the sheet preselects it and asks for a date. 102 price their card from one, and the page those cards open
 * lists no such service at all: Goulbourn Museum says "From $10" for an individual annual membership and
 * Air Classics Museum of Aviation "From $15", while both menus are empty.
 *
 * A row that names a single visit as well keeps its place, because that visit's price is the shop's own and
 * real: "Admission & Memberships" at o-cityofrevelstoke-com is $5 for a teen and $8 for an adult in the pool,
 * "Memberships & Court Time" at o-rivertrailstennis-net is $49 for a weekday court, and "Open Studio Time &
 * Memberships" at o-theglassbarboston-com is a $35 session. 18 rows are kept this way and 527 dropped.
 */
export const STANDING_ROW = /\b(?:memberships?|season\s+passe?s?|gift\s+cards?|gift\s+certificates?)\b/i;
/** A single visit, which a guest does book, so a row naming one as well as a membership stays. */
const SINGLE_VISIT = /\b(?:admissions?|entry|tickets?|day\s+passe?s?|guest\s+passe?s?|drop.?ins?|court\s+time|open\s+studio|studio\s+time|single\s+session)\b/i;

export function standingRow(name: string): boolean {
  const n = (name || "").trim();
  return STANDING_ROW.test(n) && !SINGLE_VISIT.test(n);
}

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

/**
 * A bracket the price was taken out of. An add-on is read off the page as "<words> $<price>", so a shop that
 * printed the money inside brackets leaves the opening one behind: "Digital photo package ($249)" is stored as
 * "Digital photo package (" and "S'mores kit (additional $5)" as "S'mores kit (additional". 120 shipped rows
 * end on one, and it is the row's real name in front of it.
 *
 * The bracket goes with at most one short word behind it, and only when nothing closes it, so a row that
 * brackets something of its own keeps it ("Four (4) 50-minute Private Pilates Lessons").
 */
const OPEN_TAIL = /\s*[([{]\s*[A-Za-z]{0,12}\s*$/;
const unclosed = (s: string) => (s.match(/[([{]/g) || []).length > (s.match(/[)\]}]/g) || []).length;
const closeOpenBracket = (s: string) => (unclosed(s) ? s.replace(OPEN_TAIL, "").trim() : s);

/** A row name as a guest should read it, with a half-cut sentence's trailing word taken off. */
export function tidyRowName(raw: string): string {
  const name = raw.replace(INVISIBLE, "").trim();
  let cut = closeOpenBracket(name)
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
 * Whether this row names something a guest can book. An archive never does, and neither does a year of the
 * place. A question does only when the shop priced it: at o-escapegameknoxville-net every tier under "What is
 * an escape room?" is a real room at a real price ("4 people, $30"), and dropping those would take the shop's
 * whole menu with them, while an unpriced question offers nothing at all.
 */
export function bookableRow(name: string, price: number | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  if (ARCHIVE_ROW.test(n)) return false;
  if (standingRow(n)) return false;
  if (FAQ_ROW.test(n) && (price == null || price <= 0)) return false;
  return true;
}

/**
 * The front of a sentence the price was cut out of, which is what an add-on row is when it is not one.
 *
 * Add-ons are not read off a menu the way services are. The crawl keeps any line on the shop's own page that
 * ends in money and splits it at the dollar sign, so every sentence about a charge becomes a row a guest can
 * tick: "Gazebo sites are an additional $5" stores as "Gazebo sites are an additional", "Lost or damaged bikes
 * will incur a cost of $1,000" as "Lost or damaged bikes will incur a cost of", and "This internship includes a
 * stipend of $3,000" the same way. 358 of the 3,825 shipped add-ons, one in eight, are one of those, and the
 * booking box drew each as a tickbox beside its own price: a guest could add "Lost or damaged bikes will incur
 * a cost of" to their bill for $1,000.
 *
 * A row that stops on the word before the money is not the name of a thing, and there is nothing honest to
 * rename it to (its front half is a penalty, an order minimum or a job advert as often as an extra), so it is
 * dropped, the same as the archive rows above. Only add-ons are read this way: a service row's own trailing
 * word is handled by `DANGLING_WORD`, which keeps the row, and there are 3 of these among 76,279 options.
 *
 * "Session A", "Package A" and "Dock A" are labels, not a cut article, so a capital A only counts in a
 * sentence long enough to be one and never straight after "&" ("Live Guided House Tour w/ Q & A").
 */
const CUT_TAIL = /(?:^|[\s*•·–\-([{])(?:additional|are|is|was|were|of|to|and|or|be|each|with|per|at|from|for|by|than|into)$/i;
const CUT_ARTICLE = /\s(?:a|an|the)$/;

export function bookableAddon(name: string): boolean {
  const n = closeOpenBracket((name || "").replace(INVISIBLE, "").trim());
  if (n.length < 2) return false;
  if (CUT_TAIL.test(n) || CUT_ARTICLE.test(n)) return false;
  const words = n.split(/\s+/);
  const last = words[words.length - 1];
  return !(words.length >= 5 && /^(?:A|An|The)$/.test(last) && words[words.length - 2] !== "&");
}

type Row = { name: string; price: number | null };
type Tier = { price: number | null; optionIdx: number };
type Grouped = { name: string; variants: Tier[] };

/**
 * One listing's menu as a guest should see it: rows that are not services dropped, add-ons that are a sentence
 * about money rather than a thing dropped with them, half-cut names tidied, and every `optionIdx` re-pointed at
 * the option it named before. `options` and `services` are one fact held in two lists (see `hydrateItem`), so
 * filtering either on its own would leave a tier pointing at the wrong trip or past the end of the list.
 */
export function bookableMenu<T extends { options?: Row[]; services?: Grouped[]; addons?: { name: string }[] }>(item: T): T {
  const options = item.options || [];
  const services = item.services || [];
  // Add-ons are picked in the same booking box and carry the same page cruft: 37 of them lead with an
  // invisible character or trail a price list's dot leaders.
  const addons = item.addons || [];
  const keep: number[] = [];
  for (let i = 0; i < options.length; i++) if (bookableRow(options[i].name, options[i].price)) keep.push(i);
  const keptAddons = addons.filter((a) => bookableAddon(a.name));
  const renamed = (rows: { name: string }[]) => rows.some((r) => tidyRowName(r.name) !== r.name);
  // Most of the catalog is already clean, and this runs over every record the app loads, so leave those alone.
  if (keep.length === options.length && keptAddons.length === addons.length && !renamed(options) && !renamed(services) && !renamed(addons)) return item;

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
    ...(item.addons ? { addons: keptAddons.map((a) => ({ ...a, name: tidyRowName(a.name) })) } : {}),
  };
}

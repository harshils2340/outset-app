import { CONTACTS } from "../data/contacts";
import { UNCLAIMED } from "../data/unclaimed";
import type { OperatorContact, Unclaimed, UnclaimedOption } from "../data/types";
import { regionOfArea } from "../data/regions";
import type { GeoPoint } from "./geo";
import { groupCap } from "./groupSize";
import { bookableMenu } from "./menuRow";
import { addressOf, streetOf } from "./address";
import { ownWords } from "./ownWords";
import { dialPhone, displayPhone } from "./phone";
import { isPublicHttpUrl } from "./urlSafety";

/** The crawler's own `src` field, always meant to be the operator's domain, as an https URL, or "" when it is
 *  not a safe one to link to. A leading "//" is refused outright rather than resolved: prepending "https://"
 *  in front of it would silently turn it into a working link to a host that was never the operator's own. */
export function siteUrl(src: string): string {
  const s = src.trim();
  if (s.startsWith("//")) return "";
  const candidate = /^https?:\/\//i.test(s) ? s : "https://" + s;
  return isPublicHttpUrl(candidate) ? candidate : "";
}

/* ---------- catalog registry ---------- */

let base: Unclaimed[] = UNCLAIMED;
let catalog: Unclaimed[] = UNCLAIMED;
let byId = new Map<string, Unclaimed>(UNCLAIMED.map((u) => [u.id, u]));
let alias = new Map<string, string>();
let overlay = new Map<string, Unclaimed>();
let contacts: Record<string, OperatorContact> = { ...CONTACTS };

/** Edits made by claimed operators in their dashboard, layered over the scraped record. */
const overrides = new Map<string, Partial<Unclaimed>>();
/** Operators who switched their listing off. Still resolvable by id, hidden from every list. */
const unpublished = new Set<string>();

/**
 * An operator's own menu is the whole truth about their prices, including when it is empty.
 *
 * A crawled record carries a `from` the crawler read off the site, and `fromPrice` falls back to it whenever no
 * option is priced. That is right while nobody owns the listing. Once an operator publishes a menu it is wrong:
 * a shop that hid or deleted every service went on advertising the crawled "From $199" on every card, rail,
 * search row, compare table and wishlist tile, counted as priced in the price filter, sorted by that price, and
 * had Otto answer "From $199" for a listing whose own page offers nothing to book. Same rule the booking API
 * applies in `priceBooking`: once the patch owns `options`, nothing else prices the listing.
 */
function mergeOverride(u: Unclaimed, patch: Partial<Unclaimed>): Unclaimed {
  const merged = { ...u, ...patch };
  if (!("options" in patch)) return merged;
  const priced = (patch.options || []).map((o) => o.price).filter((n): n is number => n != null && n > 0);
  return { ...merged, from: priced.length ? Math.min(...priced) : undefined };
}

function rebuild(): void {
  // A hand-verified seed keeps its own id and points at its crawled twin through `detail`. Claim links,
  // landing pages and the API all speak the twin's id, so both have to lead to the same record.
  alias = new Map();
  for (const u of base) if (u.detail && u.detail !== u.id) alias.set(u.detail, u.id);
  const key = (u: Unclaimed) => (overrides.has(u.id) ? u.id : u.detail && overrides.has(u.detail) ? u.detail : null);
  // An unpublished listing keeps its record so its own link resolves, and carries `offline` so the page says it is
  // hidden and takes no booking; before this the page opened and booked as if nothing had changed.
  const patched = overrides.size || unpublished.size ? base.map((u) => { const k = key(u); const off = unpublished.has(u.id) || (!!u.detail && unpublished.has(u.detail)); return k || off ? { ...(k ? mergeOverride(u, overrides.get(k)!) : u), ...(off ? { offline: true } : {}) } : u; }) : base;
  byId = new Map(patched.map((u) => [u.id, u]));
  // Test listings are unlisted: every list, rail and search skips them, and their own link still opens them.
  const hidden = (u: Unclaimed) => !!u.unlisted || unpublished.has(u.id) || (!!u.detail && unpublished.has(u.detail));
  catalog = patched.filter((u) => !hidden(u));
}

/** The id this catalog stores a record under, given either that id or its crawled twin's. */
export function resolveCatalogId(id: string): string {
  return byId.has(id) ? id : alias.get(id) || id;
}

/**
 * Layer an operator's dashboard edits over their catalog record. Pass null to drop the override.
 * published=false pulls the listing from rails and search while keeping it reachable by id.
 */
export function setOperatorOverride(rawId: string, patch: Partial<Unclaimed> | null, published: boolean): void {
  const id = rawId;
  if (patch) overrides.set(id, patch);
  else overrides.delete(id);
  if (published) unpublished.delete(id);
  else unpublished.add(id);
  rebuild();
}

/** Every bookable operator known to the app: hand-verified seeds plus the generated catalog once it loads. */
export function getCatalog(): Unclaimed[] {
  return catalog;
}

/**
 * The operator's host, as every record and every contact row is keyed by it: no scheme, no `www.`, no path.
 *
 * Exported because the concierge answers with a domain and nothing else to identify a business by, so
 * `concierge.ts` has to normalise the two sides the same way this file does to find the listing. A second copy
 * of these two replaces is a second place for "www." to survive.
 */
export function domainOf(src: string): string {
  return src.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
}

/**
 * A crawled record as every surface should read it, applied once where records arrive rather than in each of
 * the pages, sheets, rails, search and answers that read them.
 *
 * Two things the crawl brings back are not what they look like. A menu row can be the page's own heading
 * rather than a service, and it is bookable and priced like any other row (`menuRow.ts`). A description can be
 * the theme's Latin filler or a PDF read as text, which says the shop is not real (`ownWords.ts`). Both are
 * fixed here so the card, the listing page, the booking box, the operator's own description box and Otto never
 * disagree about what this shop published.
 */
function asPublished(raw: Unclaimed): Unclaimed {
  const item = bookableMenu(raw);
  const blurb = ownWords(item.blurb);
  const descs = (item.services || []).map((s) => ownWords(s.desc));
  if (blurb === (item.blurb || "") && descs.every((d, i) => d === ((item.services || [])[i].desc || ""))) return item;
  return {
    ...item,
    ...(blurb === (item.blurb || "") ? {} : { blurb }),
    ...(item.services ? { services: item.services.map((s, i) => ({ ...s, desc: descs[i] || null })) } : {}),
  };
}

/** Merge generated operators in. Seeds keep priority: same domain or id in the seed list is skipped. */
export function mergeCatalog(items: Unclaimed[], extraContacts: Record<string, OperatorContact>): number {
  const seenDomain = new Set(UNCLAIMED.map((u) => domainOf(u.src)));
  const seenId = new Set(UNCLAIMED.map((u) => u.id));
  const had = new Map(base.map((u) => [u.id, u]));
  const added: Unclaimed[] = [];
  for (const raw of items) {
    const it = asPublished(raw);
    const d = domainOf(it.src);
    if (seenId.has(it.id) || (d && !d.startsWith("osm-") && seenDomain.has(d))) continue;
    seenId.add(it.id);
    if (d) seenDomain.add(d);
    // A listing already fetched in full (a shared link opened it before the catalog came) keeps its photos and
    // menu; the catalog's slim copy of the same record must not take its place.
    const cur = had.get(it.id);
    added.push(cur && !cur.lite ? cur : it);
  }
  // A listing that arrived on its own before the catalog stays even when this catalog does not list it, or the
  // page showing it would blink out and back.
  for (const cur of base) {
    if (cur.lite || seenId.has(cur.id)) continue;
    seenId.add(cur.id);
    added.push(cur);
  }
  // Hand-verified seeds keep their facts but borrow everything the crawl found that they lack: photos, videos,
  // grouped services, descriptions, social handles, pins.
  const remoteByDomain = new Map<string, Unclaimed>();
  for (const raw of items) {
    const it = asPublished(raw);
    const d = domainOf(it.src);
    if (d) remoteByDomain.set(d, it);
  }
  const seeds = UNCLAIMED.map((seed) => {
    const r = remoteByDomain.get(domainOf(seed.src) || "");
    if (!r) return seed;
    const out: Unclaimed = { ...seed };
    const borrow = ["cover", "photos", "video", "videoEmbed", "services", "addons", "blurb", "tags", "lat", "lon", "ytVideos", "tiktok", "instagram", "rating", "reviews"] as const;
    for (const k of borrow) {
      const cur = out[k] as unknown;
      const empty = cur == null || (Array.isArray(cur) && cur.length === 0);
      if (empty && r[k] != null) (out as Record<string, unknown>)[k] = r[k];
    }
    if (!out.options.length && r.options.length) out.options = r.options;
    // The crawl's detail file has the services, photos and facts. Fetch it under the generated id when opened.
    out.detail = r.id;
    out.lite = true;
    return out;
  });
  base = [...seeds, ...added];
  contacts = { ...extraContacts, ...CONTACTS };
  rebuild();
  return added.length;
}

export function experienceById(id: string | null): Unclaimed | null {
  if (!id) return null;
  const direct = byId.get(id);
  if (direct) return direct;
  // Generated ids from emails and landing pages can point at a hand-verified seed that kept its own id.
  // rebuild() already maps every twin id to its seed, so this is the map it built rather than a walk over
  // 59,000 records. The walk ran on every miss, and a miss is the common case: any id that is not in the
  // catalog at all scanned the whole thing to return nothing, on every hash change and at boot.
  const seed = alias.get(id);
  return (seed ? byId.get(seed) : undefined) ?? overlay.get(id) ?? null;
}

/** A Maps hit that is not in the catalog yet, so opening the card still has a page. */
export function rememberOverlay(u: Unclaimed): void {
  overlay.set(u.id, u);
}

/**
 * The listings behind a list of ids, in the order given, and how many ids came to nothing.
 *
 * Three tabs are a list of ids kept in localStorage: Wishlists, Trips and Inbox. The ids outlive the page and
 * the catalog does not, because it is fetched after the first paint and most operators are only in the full
 * file, not the lite shard the rails paint from. So an id that resolves to nothing is two different things,
 * one the catalog has not reached yet and one that is genuinely gone, and a tab that cannot tell them apart
 * gets it wrong on every cold start.
 */
export function listingsByIds(ids: readonly string[]): { items: Unclaimed[]; missing: number } {
  const items: Unclaimed[] = [];
  for (const id of ids) {
    const u = experienceById(id);
    if (u) items.push(u);
  }
  return { items, missing: ids.length - items.length };
}

/**
 * Whether a list of ids is still arriving rather than empty: nothing has resolved, something is outstanding,
 * and the catalog has not finished loading. Wishlists reads it to avoid telling a guest holding twelve saves
 * to "create your first wishlist"; Trips and Inbox read it because without it they rendered neither their rows
 * nor their empty state, just the heading over a blank page.
 */
export function stillArriving(missing: number, resolved: number, catalogComplete: boolean): boolean {
  return resolved === 0 && missing > 0 && !catalogComplete;
}

/**
 * The saved listings a wishlist can show, in the order they were hearted, and how many ids came to nothing.
 *
 * A listing the operator switched off keeps its record and carries `offline`, so it stays in the list and
 * says so, rather than sitting there as a bookable card for a page that takes no bookings.
 */
export function savedListings(saved: readonly string[]): { items: Unclaimed[]; missing: number } {
  return listingsByIds(saved);
}

/**
 * Whether this listing is taking bookings at all. `offline` is the dashboard's Published switch off, which
 * pulls the page from every rail and search but leaves its own link working; `accepting: false` is the
 * Accepting switch off, which leaves it listed and refuses new bookings. Both reach a guest through the
 * operator's published patch, and the booking API refuses both, so every surface that offers a time has to
 * read them or it offers a booking the API will turn away.
 */
export function bookingPaused(item: Unclaimed): boolean {
  return !!item.offline || item.accepting === false;
}

export function fromPrice(item: Unclaimed): number | null {
  // A zero is a price the crawler could not read, not a free trip, so it must not become "From $0".
  const priced = item.options.map((o) => o.price).filter((n): n is number => n != null && n > 0);
  if (!priced.length) return item.from ?? null;
  return Math.min(...priced);
}

/** Swap a lite record for its full detail record. Overrides and publish state stay as they were. */
export function hydrateItem(raw: Unclaimed, targetId?: string): void {
  // The detail file is where a listing's menu and its description really live, so this is the read that decides
  // what the booking box offers and what the page says. Same rule as `mergeCatalog` above.
  const full = asPublished(raw);
  const id = resolveCatalogId(targetId || full.id);
  const idx = base.findIndex((u) => u.id === id);
  if (idx === -1) return;
  const cur = base[idx];
  const handVerified = cur.id !== full.id;
  base = base.slice();
  if (!handVerified) {
    base[idx] = { ...full, lite: false };
  } else {
    // Seeds keep every fact a person checked; the crawl fills only what the seed left empty.
    // `detail` stays: it is how a claim link, a landing page or the API reaches this record by the twin's
    // id. Clearing it once the crawl data merged made those ids stop resolving the moment a page loaded.
    const merged: Unclaimed = { ...full, ...cur, id: cur.id, lite: false, detail: cur.detail };
    for (const k of Object.keys(full) as (keyof Unclaimed)[]) {
      const v = cur[k] as unknown;
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) (merged as Record<string, unknown>)[k] = full[k];
    }
    /**
     * `options` and `services` are one fact, not two. Every service variant carries an `optionIdx` that is a
     * position in `options`, so taking the list from the seed and the variants from the crawl points those
     * positions at a different list. Seeds carry options and never services, so the loop above did exactly
     * that: a seed with four options got the crawl's services describing eight, and the reserve card then
     * offered rows whose index landed on the wrong option or past the end. Clicking "2.5 hours, $220" could
     * select nothing at all, or book a different trip than the one named on the row.
     *
     * So they move together. The seed's own options win when it has them, as every hand checked fact does,
     * and the crawl's services are dropped with them rather than re-pointed; the picker then builds its rows
     * from `options` alone, which is consistent. Only when the seed has no options do both come from the crawl.
     */
    const seedOptions = Array.isArray(cur.options) && cur.options.length > 0;
    merged.options = seedOptions ? cur.options : full.options;
    merged.services = seedOptions ? (cur.services?.length ? cur.services : undefined) : full.services;
    base[idx] = merged;
  }
  rebuild();
}

export function initials(title: string): string {
  const parts = title.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((w) => w[0]).join("") || "OS").toUpperCase();
}

export function optionLabel(o: UnclaimedOption): string {
  return o.detail ? o.name + " · " + o.detail : o.name;
}

/** A unit that names a person, so the price is multiplied by the party: "/person", "/adult", "/rider". */
export const PERSON_UNIT = /^(?:person|people|adult|child|children|kid|senior|youth|student|guest|rider|passenger|jumper|seat|head|pax)s?$/;

/**
 * A unit that names the whole booking, one vehicle, one room or a length of time, so the price is charged once
 * however many go: "/group", "/trip", "/boat", "/night", "/hr", "/30 min".
 */
export const FLAT_UNIT =
  /^(?:\d+\s*)?(?:half[\s-])?(?:hr|hrs|hour|hours|min|mins|minute|minutes|day|days|night|nights|week|weeks|month|months|season|boat|vessel|yacht|pontoon|ski|jet ?ski|kart|kayak|canoe|paddleboard|board|bike|vehicle|car|cart|room|cabin|suite|site|lane|table|court|bay|group|party|trip|charter|tour|rental|booking|slot|session|game|round)s?$/;

/**
 * Experiences are priced per person unless the operator's unit says the price covers a thing:
 * a boat, a ski, a kart, a room, a lane, a group, or a block of time on a rental.
 */
export function perPerson(o: UnclaimedOption): boolean {
  // An operator who set this told us outright, so nothing is guessed. Only a scraped price falls through to the
  // words below, which is why the unit can be anything they like without a made-up unit costing a guest money.
  if (typeof o.perGuest === "boolean") return o.perGuest;
  const unit = (o.per || "").toLowerCase().replace(/^\//, "").trim();
  const text = ((o.name || "") + " " + (o.detail || "")).toLowerCase();
  // A stated unit settles it, and it is read before the words, because the words carry the party a service
  // holds as often as the party it is priced for: "Event space for up to 200 guests" at "$18,500 / group" was
  // read as a price per guest, so the booking box quoted a party of four $74,000 and the card was charged it.
  // A capacity, a ratio ("2:1 guest to guide") and a seat count all said "per person" the same way, on 1,726
  // priced options across 808 operators. Only a unit naming a person multiplies the bill now.
  if (PERSON_UNIT.test(unit)) return true;
  if (FLAT_UNIT.test(unit)) return false;
  if (/person|adult|child|kid|senior|youth|guest|rider|passenger|jumper|seat/.test(unit + " " + text)) return true;
  if (/\b(rental|per hour|hourly|half day|full day|all day|\d+\s*(hr|hour|hours|min|minutes))\b/.test(text) && /rental|boat|ski|pontoon|kayak|paddle|bike|kart/.test(text + " " + unit)) return false;
  return true;
}

/**
 * The largest party this listing itself says it can take, or null when nothing says.
 *
 * Two things can say. A claimed operator sets it per service in their dashboard ("Max guests per slot"), and
 * that is the shop speaking today, so it wins. Otherwise the shop's own website already stated one, and the
 * listing page prints it as a key fact: "Up to 6 guests" off "Boat accommodates up to 6 passengers".
 *
 * The picker ignored that line, so on 1,217 shipped listings the same screen said "Up to 6 guests" in its facts
 * and offered twenty in its stepper, 471 of them priced per person: a six seat helicopter quoted a party of
 * twenty $9,074.80, and a charter whose own menu row reads "up to maximum party size of 6" took a request for
 * twenty. Nothing downstream catches it either, because an unclaimed listing has no capacity for the server to
 * check against. The picker is the only guard there is, so it reads the line the page is already printing.
 *
 * Only a stated ceiling under the fallback binds. A shop that says it takes 3,000 is telling us it has room,
 * not that the picker should offer sixty, and widening it is a product call rather than this fix.
 */
export const GUESTS_UNKNOWN = 20;
export const GUESTS_CEILING = 60;
export function guestCapFor(item: Unclaimed, optionIdx: number | null): number | null {
  const svc = optionIdx == null ? undefined : (item.services || []).find((x) => x.variants.some((v) => v.optionIdx === optionIdx));
  const set = svc?.maxGuests;
  if (set && set > 0) return Math.min(GUESTS_CEILING, set);
  const stated = groupCap(item.groupInfo);
  return stated != null && stated > 0 && stated < GUESTS_UNKNOWN ? stated : null;
}

/** The largest party the guest picker offers, which is that ceiling when there is one and a generous fallback
 *  when the listing states nothing at all. */
export function maxGuestsFor(item: Unclaimed, optionIdx: number | null): number {
  return guestCapFor(item, optionIdx) ?? GUESTS_UNKNOWN;
}

export function publicRating(item: Unclaimed): { rating: number; reviews: number } | null {
  if (item.rating == null || item.reviews == null || item.reviews < 1) return null;
  return { rating: item.rating, reviews: item.reviews };
}

/**
 * The bar a listing clears to be called top rated (a guest favourite on the phone): the operator's own published
 * rating, from enough reviews for it to mean anything. One bar in one place, because the desktop card's pill, the
 * phone card's badge, the listing page's laurel and the phone sheet's have to agree. They did not: the desktop
 * card alone asked for 50 reviews where everything else asks for 100, so 758 listings shipped a card promising
 * "Top rated" that opened a page saying nothing of the sort.
 */
export const TOP_RATED_RATING = 4.8;
export const TOP_RATED_REVIEWS = 100;
export function topRated(item: Unclaimed): boolean {
  const score = publicRating(item);
  return !!score && score.rating >= TOP_RATED_RATING && score.reviews >= TOP_RATED_REVIEWS;
}

/** Synced public contact facts for an experience, matched by the operator's domain. */
export function contactFor(item: Unclaimed): OperatorContact | null {
  if (item.contact) return item.contact;
  const c = contacts[domainOf(item.src)] ?? null;
  if (!c) return null;
  // A chain domain is not a location. Escapology Waterloo must not inherit the Tampa shop's street.
  const listing = (item.area || "").toLowerCase();
  const shop = [c.city, c.region].filter(Boolean).join(" ").toLowerCase();
  if (listing && shop) {
    const town = listing.split(",")[0].trim();
    if (town && !shop.includes(town) && !listing.includes((c.city || "").toLowerCase())) return null;
  }
  return c;
}

export function fmtPhone(raw: string): string {
  return displayPhone(raw);
}

/** The call link, or null when what the operator published is not a number a guest can ring: see `phone.ts`. */
export function telHref(raw: string): string | null {
  const dial = dialPhone(raw);
  return dial ? "tel:" + dial : null;
}

export function addressLine(c: OperatorContact): string | null {
  return addressOf(c);
}

/**
 * The place line on a feed card: the listing's own area, with the metro's name added when the area does not
 * already carry it.
 *
 * An operator whose town the crawl never found publishes its state as the whole area ("FL"), which is 4,736
 * rows in the catalog and fourteen of them inside a metro. Appending the metro to that read "FL, Orlando",
 * back to front. The town goes in front of the state, the way every other card reads.
 */
export function cardPlace(area: string, metroName: string | undefined): string {
  const a = (area || "").trim();
  if (!metroName || a.includes(metroName)) return a;
  if (a.length === 2 && regionOfArea(a)) return metroName + ", " + a.toUpperCase();
  return a.includes(",") ? a : a + ", " + metroName;
}

export function mapsHref(c: OperatorContact, fallbackName: string): string {
  const q = addressLine(c) || fallbackName;
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}

export function mapsQuery(item: Unclaimed, c: OperatorContact | null): string {
  if (c && streetOf(c)) {
    const line = addressLine(c);
    if (line) return line;
  }
  const city = c ? [c.city, c.region].filter(Boolean).join(", ") : "";
  if (city) return item.title + ", " + city;
  return item.title + ", " + item.area;
}

export function mapsDirHref(dest: string, origin?: GeoPoint | null): string {
  let url =
    "https://www.google.com/maps/dir/?api=1&destination=" +
    encodeURIComponent(dest) +
    "&travelmode=driving";
  if (origin) url += "&origin=" + origin.lat + "," + origin.lng;
  return url;
}

export function placeLabel(item: Unclaimed, c: OperatorContact | null): string {
  if (c) {
    const line = addressLine(c);
    if (line) return line;
    const city = [c.city, c.region].filter(Boolean).join(", ");
    if (city) return city;
  }
  return item.area;
}

const WHO_RE =
  /\b(ages?|years old|\d+\+|junior|child(?:ren)?|kids?|adult required|adult & junior|minors?|weight|\blbs?\b|\bkg\b|passenger capacity)\b/i;
const WAIVER_RE =
  /\b(waiver|liabilit|deposit|license|closed-toe|shoes required|no alcohol|helmets?|non-refundable|forfeit)\b/i;

export type FactLine = { text: string; posted: boolean };

export type ListingFacts = {
  about: string[];
  who: FactLine[];
  waiver: FactLine[];
  note: string | null;
};

function guestLine(raw: string): string {
  const cleaned = raw
    .replace(/\s*[-–—,]\s*we'?ll (ask|confirm|get)[^.]*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;]+$/g, "");
  if (!cleaned) return raw.trim();
  return /[.!?]$/.test(cleaned) ? cleaned : cleaned + ".";
}

function pushUnique(list: FactLine[], text: string, posted: boolean) {
  const key = text.toLowerCase();
  if (list.some((x) => x.text.toLowerCase() === key)) return;
  list.push({ text, posted });
}

function classify(line: string): "who" | "waiver" | "both" | "about" {
  const who = WHO_RE.test(line);
  const waiver = WAIVER_RE.test(line);
  if (who && waiver) return "both";
  if (who) return "who";
  if (waiver) return "waiver";
  return "about";
}

/** Split published specs, notes and gaps into experience / who / waiver. Never invents rules. */
export function listingFacts(item: Unclaimed): ListingFacts {
  const about: string[] = [];
  const who: FactLine[] = [];
  const waiver: FactLine[] = [];
  let note: string | null = null;

  for (const s of item.specs) {
    const kind = classify(s);
    if (kind === "who" || kind === "both") pushUnique(who, guestLine(s), true);
    if (kind === "waiver" || kind === "both") pushUnique(waiver, guestLine(s), true);
    if (kind === "about") about.push(s);
  }

  if (item.extraNote) {
    // Policy notes arrive as several sentences joined with " · ". Each one gets its own bullet.
    const bits = item.extraNote.split(/\s+·\s+/).map((b) => b.trim()).filter(Boolean);
    const leftovers: string[] = [];
    for (const bit of bits) {
      const kind = classify(bit);
      if (kind === "about") leftovers.push(bit);
      else {
        if (kind === "who" || kind === "both") pushUnique(who, guestLine(bit), true);
        if (kind === "waiver" || kind === "both") pushUnique(waiver, guestLine(bit), true);
      }
    }
    if (leftovers.length) note = leftovers.join(" ");
  }

  for (const bit of item.gap.split(/[.!?]+\s+/)) {
    const line = bit.trim();
    if (!line) continue;
    const kind = classify(line);
    if (kind === "about") continue;
    const text = guestLine(line);
    const posted = !/not (posted|copied|listed|broken out)|aren'?t (posted|published)/i.test(line);
    if (kind === "who" || kind === "both") pushUnique(who, text, posted);
    if (kind === "waiver" || kind === "both") pushUnique(waiver, text, posted);
  }

  for (const o of item.options) {
    const blob = (o.name + " " + o.detail).trim();
    if (!/\b(child(?:ren)?|junior|kids?|ages?\s*\d|adult required|adult & junior)/i.test(blob)) continue;
    const text = guestLine(o.detail ? o.name + ": " + o.detail : o.name);
    pushUnique(who, text, true);
  }

  if (!who.length) {
    pushUnique(who, "Age, weight and kid rules are not posted on their site.", false);
  }
  if (!waiver.length) {
    pushUnique(waiver, "Waiver and check-in rules are not posted on their site.", false);
  }

  return { about, who, waiver, note };
}

/** Guests should never have to know the jargon. Expand it where it shows. */
const GLOSSARY: [RegExp, string][] = [
  [/\bSUPs?\b/g, "Stand-up paddleboard"], [/\bPWCs?\b/g, "Personal watercraft"], [/\bATVs?\b/g, "Four-wheeler (ATV)"],
  [/\bUTVs?\b/g, "Side-by-side (UTV)"], [/\bAFF\b/g, "Accelerated Freefall (learn to skydive)"], [/\bHP\b/g, "horsepower"],
  [/\bJet ?Ski\b/gi, "Jet ski"],
  [/\bIFR\b/g, "instrument-rated"], [/\bUSCG\b/g, "Coast Guard"], [/\bPFDs?\b/g, "life jacket"], [/\bBYOB\b/g, "bring your own drinks"],
];

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201c", rdquo: "\u201d", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026" };
/** Older detail files still carry "&amp;" and "&#039;" from site markup. */
export function decodeEntities(text: string): string {
  const once = (t: string) =>
    t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m;
      }
      return ENT[code.toLowerCase()] ?? m;
    });
  return once(once(text));
}

/**
 * Acronyms an operator means in capitals. Everything else shouting in caps is their SEO voice, not ours.
 */
const KEEP_CAPS = new Set([
  "ATV", "UTV", "PWC", "SUP", "RV", "VIP", "BYOB", "GPS", "USA", "USCG", "PADI", "SSI", "TV", "DJ", "HD", "LED",
  "FAQ", "ID", "AM", "PM", "4X4", "UFC", "MMA", "NFL", "NBA", "MLB", "NHL", "BBQ", "AC", "ADA", "CPR",
]);

/**
 * Operators write their own pages, and a lot of them shout: "CLEARWATER JET SKI RENTAL AT CLEARWATER
 * BEACH". Rendered as-is that reads like a billboard, not a listing. Any capitalised word of five letters
 * or more becomes title case, so real acronyms (ATV, PADI, FL and the other two-letter states) survive
 * untouched while the shouting stops.
 */
const SHOUT_SMALL = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

function unshout(word: string): string {
  if (KEEP_CAPS.has(word)) return word;
  return word.charAt(0) + word.slice(1).toLowerCase();
}

function deShout(text: string): string {
  // A run of capitalised words is a headline shout: "RENT BY THE HOUR". Title case it and drop the
  // joining words, unless every word in the run is a real acronym.
  let out = text.replace(/[A-Z][A-Z0-9'&.\-]*(?:\s+[A-Z][A-Z0-9'&.\-]*)+/g, (run) => {
    const words = run.split(/\s+/);
    if (words.every((w) => KEEP_CAPS.has(w))) return run;
    return words
      .map((w, i) => {
        if (KEEP_CAPS.has(w)) return w;
        const lower = w.toLowerCase();
        return i > 0 && SHOUT_SMALL.has(lower) ? lower : unshout(w);
      })
      .join(" ");
  });
  // A single long shout on its own, like "CLEARWATER Jet ski". Two and three letter words are left be,
  // so state codes and short acronyms survive.
  out = out.replace(/[A-Z][A-Z0-9'&.\-]{4,}/g, unshout);
  return out;
}

export function plainWords(text: string): string {
  let out = decodeEntities(text);
  for (const [re, word] of GLOSSARY) out = out.replace(re, word);
  return deShout(out).replace(/\s+/g, " ").trim();
}

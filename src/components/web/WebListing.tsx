import { warmCheckout } from "../../lib/stripeJs";
import "../../styles/air-listing.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import { apiConfig, fetchAvailability, fetchOpenSlots, hasApi, type LiveAvailability } from "../../lib/api";
import { GUIDES } from "../../data/guides";
import { ICONS } from "../../data/icons";
import { metroById } from "../../data/metros";
import { countryOfArea, countryOfRegion, regionOfArea } from "../../data/regions";
import { SLOT_TIMES } from "../../data/slots";
import type { Unclaimed } from "../../data/types";
import { addressLine, bookingPaused, contactFor, fmtPhone, fromPrice, getCatalog, guestCapFor, listingFacts, mapsHref, maxGuestsFor, perPerson, plainWords, publicRating, telHref, topRated as isTopRated } from "../../lib/catalog";
import { DAYS, fmtDate, fmtReviews, fmtTime, money, priceWith, reviewsLine } from "../../lib/format";
import { srcSet, thumb } from "../../lib/images";
import { embedAutoplay, isGif, listingMedia, photoCandidates, probePhotos, type Media } from "../../lib/media";
import { bringLine, cleanDesc, durationLabel, faqText, groupCap as readGroupCap, minAge, splitPolicies } from "../../lib/listingDerive";
import { freeCancelBadge } from "../../lib/cancellation";
import { bookableStart, clockIn, hourLines, itemOpenState, itemWeek, zoneFor } from "../../lib/openNow";
import { displayHours } from "../../lib/hoursText";
import { noStartTimesNote, startTimesOn } from "../../lib/startTimes";
import { DAY_SHORT, assistantOn, clock12, dayLabel, todaysDeals } from "../../lib/companyAgent";
import { fmtDistance } from "../../lib/geo";
import { kmBetween, nearestLocation, venueLabel } from "../../lib/places";
import { addonPrice, hasPrice, priceUnclaimed, serviceFeeLabel } from "../../lib/pricing";
import { ottoCanPay, useWallet } from "../../lib/wallet";
import { shownReviews, type ShownReview } from "../../lib/reviews";
import { listingUrl } from "../../lib/site";
import { adminWebsite, isAdmin, subscribeAdmin } from "../../lib/admin";
import { dateKey, startOfToday } from "../../lib/dates";
import { fewSeats, liveChipsByDate, type TimeChip } from "../../lib/liveTimes";
import { safeHttpUrl } from "../../lib/urlSafety";
import { startingParty } from "../explore/prefs";
import { useApp } from "../../state/AppProvider";
import { Photo } from "../art/Photo";
import { Mark } from "../layout/Mark";
import { useModal } from "../layout/useModal";
import { Markup } from "../Markup";

/**
 * Desktop listing page, laid out as an Airbnb listing: title row with Share and Save, the 1 + 4 photo grid, a 58/33
 * split with the details on the left and a sticky reserve card on the right, then reviews, location, the business,
 * things to know and a rail of similar listings across the full width. Outset carries sections Airbnb does not
 * (services and options, deals, FAQ, hours, the operator's videos) and each sits in the same visual language.
 * Every section shows only what the operator's own site states. Nothing is invented to fill a gap, and empty
 * sections stay hidden.
 */

const KIND: Record<string, string> = {
  skydive: "a tandem skydive", heli: "a helicopter tour", balloon: "a balloon flight", kart: "karting", escape: "an escape room",
  axe: "axe throwing", paintball: "paintball", horse: "a trail ride", jetski: "a jet ski session", pontoon: "a pontoon day",
  fishing: "a fishing charter", parasail: "parasailing", cruise: "a sunset cruise", kayak: "a paddle",
  bowling: "bowling", minigolf: "mini golf", arcade: "an arcade session", trampoline: "a trampoline park", lasertag: "laser tag", icerink: "ice skating", waterpark: "a water park day", themepark: "a theme park day", zoo: "a zoo visit", aquarium: "an aquarium visit", karaoke: "a karaoke room", climbing: "a climbing session", range: "a range session", archery: "archery", golf: "a round of golf", zipline: "a zipline", ski: "a day on the mountain", bike: "a bike rental", snowmobile: "a snowmobile ride", rafting: "a rafting trip", scuba: "a dive", surf: "a surf lesson", paragliding: "a tandem paraglide", gliding: "a glider flight", brewery: "a brewery visit", winery: "a wine tasting", distillery: "a distillery tour", cooking: "a cooking class", spa: "a spa visit", yoga: "a yoga class", dance: "a dance class", pottery: "a pottery class", tour: "a tour", rage: "a rage room session", theatre: "a show", museum: "a museum visit", garden: "a garden visit", camping: "a night under the stars", tennis: "a court booking", swim: "a swim", martialarts: "a class", gymnastics: "a gymnastics session", fitness: "a class", venue: "a venue booking", sailing: "a sail", discgolf: "a round", billiards: "a table", motorsport: "a ride", sauna: "a sauna session",
};

/** What the business is, in the words Airbnb uses for "Entire rental unit": the subtitle's first half. */
export const TYPE_NAME: Record<string, string> = {
  skydive: "Skydiving", heli: "Helicopter tour", balloon: "Hot air balloon ride", kart: "Go-kart track", escape: "Escape room", axe: "Axe throwing",
  paintball: "Paintball park", horse: "Trail riding", jetski: "Jet ski rental", pontoon: "Pontoon boat rental", fishing: "Fishing charter",
  parasail: "Parasailing", cruise: "Boat cruise", kayak: "Kayak and paddleboard rental", bowling: "Bowling alley", minigolf: "Mini golf",
  arcade: "Arcade", trampoline: "Trampoline park", lasertag: "Laser tag", icerink: "Ice rink", waterpark: "Water park", themepark: "Theme park",
  zoo: "Zoo", aquarium: "Aquarium", karaoke: "Karaoke", climbing: "Climbing gym", range: "Shooting range", archery: "Archery range",
  golf: "Golf course", zipline: "Zipline", ski: "Ski area", bike: "Bike rental", snowmobile: "Snowmobile tour", rafting: "Rafting trip",
  scuba: "Scuba diving", surf: "Surf lessons", paragliding: "Paragliding", gliding: "Glider flights", brewery: "Brewery", winery: "Winery",
  distillery: "Distillery", cooking: "Cooking class", spa: "Spa", yoga: "Yoga studio", dance: "Dance studio", pottery: "Pottery studio",
  tour: "Tour", rage: "Rage room", theatre: "Theatre", museum: "Museum", garden: "Garden", camping: "Campground", tennis: "Tennis courts",
  swim: "Swimming", martialarts: "Martial arts", gymnastics: "Gymnastics", fitness: "Fitness classes", venue: "Event venue", sailing: "Sailing",
  discgolf: "Disc golf", billiards: "Billiards hall", motorsport: "Motorsport experience", sauna: "Sauna",
};

const REGION: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, DC",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
  NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};

type OptRow = { idx: number; label: string; sub?: string; price: number | null; per?: string; kind: string };
type OptGroup = { name: string; rows: OptRow[] };

/** "dolphin tour" reads "Dolphin tour"; a closing bracket the crawl cut off is put back; "Fishing page" is Fishing. */
function tidyOpt(text: string): string {
  let t = lengthWords(tidyName(text)).replace(/\s+(?:page|tab|menu|section)$/i, "").trim();
  const open = (t.match(/\(/g) || []).length;
  const close = (t.match(/\)/g) || []).length;
  if (open > close) t += ")";
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Who a ticket is for, so the picker can offer Private / Per person / Kids filters the operator never labelled. */
function optKind(text: string): string {
  if (/\bprivate\b|just your group|whole boat|charter\b/i.test(text)) return "Private";
  if (/\b(child|children|kids?|youth|junior|under \d+|\d+\s*(?:yrs?|years?) and (?:under|younger))\b/i.test(text)) return "Kids";
  if (/\b(adult|senior|per person|by the seat|seat|shared)\b/i.test(text)) return "Per person";
  return "";
}

/**
 * What the booking picker lists: the operator's services with their price tiers, or, for a flat menu, options
 * grouped by the section they were listed under. Rows sort by price inside a group so tiers read in order.
 */
function bookingGroups(item: Unclaimed): OptGroup[] {
  const groups = new Map<string, OptGroup>();
  const skip = new Set<number>();
  const add = (name: string, row: OptRow) => {
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, rows: [] });
    const g = groups.get(key)!;
    if (!g.rows.some((r) => r.label.toLowerCase() === row.label.toLowerCase() && r.price === row.price)) g.rows.push(row);
  };
  if (item.services?.length) {
    for (const svc of item.services) for (const v of svc.variants) {
      const o = item.options[v.optionIdx];
      if (isQuestion(svc.name) && !svc.variants.some((x) => x.price != null)) { skip.add(v.optionIdx); continue; }
      add(isQuestion(svc.name) ? "Other options" : tidyOpt(svc.name), { idx: v.optionIdx, label: tidyOpt(v.label || svc.name), sub: o?.detail && o.detail !== v.label ? tidyLine(o.detail) : undefined, price: v.price, per: v.per, kind: optKind(svc.name + " " + v.label) });
    }
  }
  item.options.forEach((o, idx) => {
    if (skip.has(idx) || (isQuestion(o.name) && !o.detail && o.price == null)) return;
    if ([...groups.values()].some((g) => g.rows.some((r) => r.idx === idx))) return;
    const name = tidyOpt(o.name);
    // "How Do I Book A Cruise?" is a page heading the crawl read as a section, not a group of tickets.
    const heading = /\?$/.test(name) && !!o.detail;
    if (heading) return add("Other options", { idx, label: tidyOpt(o.detail), price: o.price, per: o.per, kind: optKind(o.detail) });
    const hasSection = item.options.filter((x) => tidyOpt(x.name) === name).length > 1 && !!o.detail;
    if (hasSection) add(name, { idx, label: tidyOpt(o.detail), price: o.price, per: o.per, kind: optKind(o.name + " " + o.detail) });
    else add("Other options", { idx, label: name, sub: o.detail ? tidyLine(o.detail) : undefined, price: o.price, per: o.per, kind: optKind(o.name + " " + o.detail) });
  });
  // A section with one entry is not a section: fold those into one list so the picker is not a wall of headings.
  let out = [...groups.values()];
  const singles = out.filter((g) => g.rows.length === 1);
  if (singles.length && out.length > 1) {
    out = out.filter((g) => g.rows.length > 1);
    const rest = out.find((g) => g.name === "Other options") || { name: "Other options", rows: [] as OptRow[] };
    for (const g of singles) rest.rows.push(g.name === "Other options" ? g.rows[0] : { ...g.rows[0], label: g.name === g.rows[0].label ? g.name : g.name, sub: g.rows[0].label !== g.name ? g.rows[0].label : g.rows[0].sub });
    if (!out.includes(rest)) out.push(rest);
  }
  for (const g of out) g.rows.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  // A lone "Other options" group is just the menu; call it that only when real sections sit beside it.
  if (out.length === 1 && out[0].name === "Other options") out[0].name = "Options";
  return out.sort((a, b) => (a.name === "Other options" ? 1 : b.name === "Other options" ? -1 : 0));
}

const optKinds = (groups: OptGroup[]) => ["Per person", "Kids", "Private"].filter((k) => groups.some((g) => g.rows.some((r) => r.kind === k)));

/** "Clearwater Beach, FL" becomes "Clearwater Beach, Florida". */
function placeName(area: string): string {
  const m = area.match(/^(.*),\s*([A-Z]{2})$/);
  if (!m || !REGION[m[2]]) return area;
  return m[1] + ", " + REGION[m[2]];
}

/* ---------- display tidying for scraped text. Formatting only: nothing here adds a fact. ---------- */

/** "Spray Watersports'" and "Hubbard's Marina's": a name that ends in s takes the apostrophe alone. */
export function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? name.trim() + "’" : name.trim() + "’s";
}

/** Space before punctuation, "( x )", doubled spaces, a leading bullet, list number or Q&A label: the crawl's leftovers. */
export function tidyLine(text: string): string {
  let t = plainWords(faqText(text))
    .replace(/^\s*(?:[•·*\-–—:;,|>]+|\d{1,2}\s*[-.)]\s+)\s*/, "")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s{2,}/g, " ")
    .trim();
  // A line still set in capitals reads as shouting: sentence case it, keeping short acronyms.
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7) {
    t = t.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase()).replace(/\b(am|pm|atv|utv|vip|faq|id|usa|fl)\b/g, (w) => w.toUpperCase());
  }
  // "Cancellations Cancellation requests received..." carries the page heading glued to the sentence.
  const lead = t.match(/^([A-Za-z]+)\s+([A-Za-z]+)\b/);
  if (lead && lead[1].toLowerCase().replace(/s$/, "") === lead[2].toLowerCase().replace(/s$/, "")) t = t.slice(lead[1].length).trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/**
 * What the operator says about arriving, or "" when they say nothing. A sign-off like "See you soon!" is not
 * arrival information. This is the only arrival line a guest is ever shown: Outset has no rule of its own.
 */
export function arrivalNote(item: { checkin?: string }): string {
  if (!item.checkin || /^(see you|thank|welcome|we look forward|have fun|enjoy)\b/i.test(item.checkin.trim())) return "";
  return tidyLine(item.checkin);
}

const TITLE_SMALL = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with", "per", "vs"]);
/** "Island Jet ski Tour" is a title with one word left lowercase: finish the title case the operator started. */
export function tidyName(text: string): string {
  const t = tidyLine(text).replace(/\b(\d+(?:\.\d+)?)[\s-]?(Hr|hr|HR)s?\b/g, (_m, n: string, h: string) => n + " " + (h === "hr" ? "hour" : "Hour"));
  const words = t.split(" ");
  const big = words.filter((w, i) => /^[A-Za-z]/.test(w) && (i === 0 || !TITLE_SMALL.has(w.toLowerCase())));
  const capped = big.filter((w) => /^[A-Z]/.test(w)).length;
  if (big.length < 3 || capped / big.length < 0.6 || capped === big.length) return t;
  return words.map((w, i) => (i > 0 && TITLE_SMALL.has(w.toLowerCase()) ? w : w.replace(/^([a-z])/, (c) => c.toUpperCase()))).join(" ");
}

/**
 * A service the crawl named after an FAQ heading ("How Do I Book A Cruise?", "Will I See Dolphins?"). With prices it
 * is still the ticket menu, shown as Tickets without the FAQ answer as its description; without prices it is dropped.
 */
export const isQuestion = (name: string) => /\?\s*$/.test(name.trim());
export function bookableServices<T extends { name: string; desc?: string | null; variants: { price: number | null }[] }>(services: T[] | undefined): T[] {
  return (services || []).filter((svc) => !isQuestion(svc.name) || svc.variants.some((v) => v.price != null)).map((svc) => (isQuestion(svc.name) ? { ...svc, name: "Tickets", desc: null } : svc));
}

/* ---------- plain services, deals and the founder-only website link, shared with the phone sheet and cards ---------- */

/** True while this browser has the admin view on (lib/admin.ts). Always false for guests and on the server. */
export function useAdmin(): boolean {
  return useSyncExternalStore(subscribeAdmin, isAdmin, () => false);
}

/**
 * The operator's website, for Harshil comparing a listing with the real site. Renders nothing unless admin is on, so a
 * guest never sees it. A click opens the site in a new tab and never reaches the card or listing underneath.
 */
export function AdminSiteLink({ item, variant = "text", className = "" }: { item: Pick<Unclaimed, "src" | "contact">; variant?: "text" | "icon"; className?: string }) {
  const admin = useAdmin();
  const href = admin ? adminWebsite(item) : null;
  if (!href) return null;
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <a
      className={"adminsite" + (variant === "icon" ? " icon" : "") + (className ? " " + className : "")}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={"Founder view: open " + href.replace(/^https:\/\/|\/$/g, "")}
      aria-label={"Founder view: open the operator's website, " + href.replace(/^https:\/\/|\/$/g, "")}
      onClick={stop}
      onPointerDown={stop}
      onKeyDown={stop}
    >
      {variant === "icon" ? <Markup html={I.globe} /> : <>Website <span aria-hidden="true">↗</span></>}
    </a>
  );
}

type Explain = { term: string; meaning: string };

/** "What this means" under a service name: the jargon term in medium weight, its meaning in grey. Two at most. */
export function ExplainLine({ explain, className }: { explain?: Explain[]; className: string }) {
  const list = (explain || []).filter((e) => e.term && e.meaning).slice(0, 2);
  if (!list.length) return null;
  return (
    <p className={className}>
      <span className="vh">What this means: </span>
      {list.map((e, i) => (
        <span key={e.term} className="explainitem">
          {i ? <span className="vh"> </span> : null}
          <b>{e.term}:</b> {e.meaning}
        </span>
      ))}
    </p>
  );
}

/** A variant's own explained terms, as one small grey line. */
export function variantNote(explain?: Explain[], label = ""): string {
  // A tier called just "Full hookup" needs only the meaning under it, not the term again.
  const same = (term: string) => term.trim().toLowerCase() === label.trim().toLowerCase();
  return (explain || []).filter((e) => e.term && e.meaning).slice(0, 2).map((e) => (same(e.term) ? e.meaning : e.term + ": " + e.meaning)).join(" ");
}

/** A service priced once with no tier words of its own: the page prints only the price and length, not "Standard". */
export function isStandardOnly(svc: { variants: { label: string }[] }): boolean {
  return svc.variants.length === 1 && svc.variants[0].label.trim().toLowerCase() === "standard";
}

/** Tiers shown straight away, and those folded under "More options". The picked tier always stays visible. */
export function splitVariants<V extends { optionIdx: number; moreOptions?: true }>(variants: V[], picked: number | null, open: boolean): { shown: V[]; hidden: number } {
  const folded = variants.filter((v) => v.moreOptions);
  if (open || !folded.length) return { shown: variants, hidden: 0 };
  const shown = variants.filter((v) => !v.moreOptions || v.optionIdx === picked);
  return { shown, hidden: variants.length - shown.length };
}

/** A length the option row states for a single-tier service: "2 hours", "90 min". Null when it states something else. */
export function optionLength(item: Unclaimed, optionIdx: number): string | null {
  const o = item.options[optionIdx];
  const text = [o?.detail, o?.name].find((t) => t && /^\s*(?:about\s+)?\d+(?:\.\d+)?(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?\s*(?:hours?|hrs?|minutes?|mins?|days?|nights?)\.?\s*$/i.test(t));
  return text ? tidyLength(text) : null;
}

export type DealShown = { title: string; detail: string; code: string | null; when: string | null; date: string | null; days: number[] };

/** One deal as a card shows it. Older detail files carry only `text`; it becomes the title then. */
export function dealShown(p: { text: string; days: number[]; start?: string; end?: string; title?: string; detail?: string; code?: string; date?: string }): DealShown {
  const title = tidyLine(p.title || p.text);
  const detailRaw = p.title ? (p.detail || "").trim() : "";
  const detail = detailRaw && detailRaw.toLowerCase() !== title.toLowerCase() ? detailRaw : "";
  const when = p.start || p.end ? (p.start ? clock12(p.start) : "Opening") + " to " + (p.end ? clock12(p.end) : "close") : null;
  return { title, detail, code: p.code || null, when, date: p.date || null, days: p.date ? [] : p.days };
}

/** The deal title a lite record carries after its day list ("2|Half-price Tuesdays"). A title the sync cut mid-word ends on "…". */
export function liteDealTitle(deal?: string): string | null {
  if (!deal || !deal.includes("|")) return null;
  let t = deal.slice(deal.indexOf("|") + 1).trim();
  if (!t) return null;
  // Lite titles are capped at 40 characters; a word cut there loses its tail rather than showing "on Sund".
  if (t.length >= 40) t = t.replace(/[\s,;:]+\S*$/, "").replace(/[\s,;:]+(?:on|and|to|the|a|of|for|with)$/i, "") + "…";
  return t;
}

/** A variant label that is only a length: "1.5 hour" reads "1.5 hours", "1 hours" reads "1 hour". */
export function tidyLength(text: string): string {
  return lengthWords(tidyLine(text));
}
function lengthWords(text: string): string {
  return text.replace(/^(\d+(?:\.\d+)?)\s*(hour|hr|minute|min|day|night|week)s?\.?$/i, (_m, n: string, u: string) => {
    const unit = ({ hr: "hour", min: "minute" } as Record<string, string>)[u.toLowerCase()] || u.toLowerCase();
    return n + " " + unit + (Number(n) === 1 ? "" : "s");
  });
}

/** "60 min" reads "1 hour" and "90 min" "1.5 hours", so cards side by side state lengths the same way. */
export function tidyDuration(text: string): string {
  const t = text.trim();
  const m = t.match(/^(\d+)\s*(?:m|mins?|minutes?)\.?$/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 60 && n % 30 === 0) return n / 60 + (n === 60 ? " hour" : " hours");
    return n + " min";
  }
  return t.replace(/^1 hours$/i, "1 hour").replace(/^(\d+(?:\.\d+)?)\s*hrs?$/i, (_x, n: string) => n + (Number(n) === 1 ? " hour" : " hours"));
}

/** "84457 Overseas Hwy, Islamorada, FL, 33036" loses the comma before the ZIP. */
export function tidyAddress(text: string): string {
  return text.replace(/,\s*(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d)$/, " $1");
}

/** "Free cancellation up to 48 hours before" ends on a preposition; say before what. */
export function tidyCancel(text: string): string {
  return text.replace(/\bbefore\.?$/i, "before your start time");
}

/**
 * What's included, split the way a guest reads it. A short "Fuel (not included)" is struck through as Airbnb does
 * with a missing amenity; a whole sentence ("Gratuity is not included in the ticket price") keeps its own words,
 * because cutting "not included" out of the middle turns it into the opposite claim.
 */
const NOT_INCLUDED = /\bnot included\b|\bexcluded\b|\bnot provided\b|\bdoes(?: not|n[’']t) include\b/i;
export function splitIncluded(lines: string[]): { yes: string[]; no: { text: string; strike: boolean }[] } {
  const yes: string[] = [];
  const no: { text: string; strike: boolean }[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = tidyLine(raw).replace(/^not included:\s*/i, "").replace(/^./, (c) => c.toUpperCase());
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    if (/\bbring your own\b/i.test(line)) continue;
    if (!NOT_INCLUDED.test(line)) { yes.push(line); continue; }
    const short = line.replace(/\s*[-–:(,]*\s*(?:is |are )?(?:not included|excluded|not provided)\)?\.?\s*$/i, "").trim();
    const clean = short !== line && !!short && short.split(/\s+/).length <= 4 && !/[:;]/.test(short) && !/\b(?:in|also|are|is|the|of|and|a|to|that|for|with)$/i.test(short);
    if (clean && !NOT_INCLUDED.test(short)) no.push({ text: short.charAt(0).toUpperCase() + short.slice(1), strike: true });
    else no.push({ text: line, strike: false });
  }
  // "Gratuity" struck through beside "Gratuity is not included in the ticket price" says the same thing twice.
  const out = no.filter((n) => !n.strike || !no.some((m) => !m.strike && m.text.toLowerCase().startsWith(n.text.toLowerCase() + " ")));
  return { yes, no: out };
}

/* ---------- reviews ---------- */

// The review reading itself lives in `src/lib/reviews.ts`, where a test can load it; this file draws the card.

/* Line icons in Airbnb's weight: 24px, 1.6 stroke, round joins. */
const svg = (d: string, extra = "") => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const I = {
  share: svg('<path d="M12 3v12"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  heart: svg('<path d="M12 20.5s-8-4.9-8-10.6A4.4 4.4 0 0 1 8.4 5.5c1.6 0 2.8.8 3.6 2 .8-1.2 2-2 3.6-2A4.4 4.4 0 0 1 20 9.9c0 5.7-8 10.6-8 10.6z"/>'),
  heartOn: svg('<path d="M12 20.5s-8-4.9-8-10.6A4.4 4.4 0 0 1 8.4 5.5c1.6 0 2.8.8 3.6 2 .8-1.2 2-2 3.6-2A4.4 4.4 0 0 1 20 9.9c0 5.7-8 10.6-8 10.6z" fill="currentColor"/>'),
  grid: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/><circle cx="13" cy="3" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/><circle cx="3" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/><circle cx="13" cy="13" r="1.5"/></svg>',
  chevLeft: svg('<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>', ' style="stroke-width:2.2"'),
  chevRight: svg('<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>', ' style="stroke-width:2.2"'),
  chevDown: svg('<path d="m6 9.5 6 6 6-6"/>', ' style="stroke-width:2"'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', ' style="stroke-width:2.2"'),
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5-4.9-4.6 6.6-.8z"/></svg>',
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  bolt: svg('<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>'),
  door: svg('<path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21"/><path d="M3 21h18"/><circle cx="15" cy="12.5" r=".9" fill="currentColor"/>'),
  pin: svg('<path d="M12 21s7-6.2 7-11.2a7 7 0 1 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.6"/>'),
  tag: svg('<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.4"/>'),
  message: svg('<path d="M20.5 15a2 2 0 0 1-2 2H8l-4.5 4V5.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>'),
  medal: svg('<circle cx="12" cy="14.5" r="5.5"/><path d="M8.5 10 6 3h4l2 4 2-4h4l-2.5 7"/>'),
  shield: svg('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>'),
  fuel: svg('<path d="M4.5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h13"/><path d="M7 8h5"/><path d="M14.5 10h2a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8.5L18 6"/>'),
  camera: svg('<path d="M3.5 8.5a2 2 0 0 1 2-2h2.3L9.3 4h5.4l1.5 2.5h2.3a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.6"/>'),
  glass: svg('<path d="M7 3h10l-.8 6.2a4.2 4.2 0 0 1-8.4 0z"/><path d="M12 13.5V21M8.5 21h7"/>'),
  food: svg('<path d="M7 3v7a2 2 0 0 0 4 0V3M9 12v9"/><path d="M16.5 21V3c-2 1.2-3 3.6-3 6.5V14h3"/>'),
  person: svg('<circle cx="12" cy="7.5" r="3.8"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
  group: svg('<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.8a3.4 3.4 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>'),
  car: svg('<path d="M4 16.5V12l2-5.2A2 2 0 0 1 7.9 5.5h8.2a2 2 0 0 1 1.9 1.3L20 12v4.5"/><path d="M3 16.5h18V19h-3v-2.5M6 19H3"/><path d="M4 12h16"/><circle cx="7.5" cy="14.3" r=".6" fill="currentColor"/><circle cx="16.5" cy="14.3" r=".6" fill="currentColor"/>'),
  gear: svg('<path d="M14.5 6.5a4 4 0 0 0-5.2 5.2L3.5 17.5a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.2-5.2l-2.5 2.5-2.3-.5-.5-2.3z"/>'),
  ticket: svg('<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/>'),
  wifi: svg('<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a4.8 4.8 0 0 1 6.4 0"/><circle cx="12" cy="19.2" r=".9" fill="currentColor"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  towel: svg('<path d="M6 3h12v18H6z"/><path d="M6 15h12M9 18h6"/>'),
  sparkle: svg('<path d="M12 3.5c.5 4.3 2.3 6.4 6.5 7-4.2.6-6 2.7-6.5 7-.5-4.3-2.3-6.4-6.5-7 4.2-.6 6-2.7 6.5-7z"/><path d="M19 3v3M17.5 4.5h3"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>'),
  phone: svg('<path d="M21 16.4v2.9a2 2 0 0 1-2.2 2 19.5 19.5 0 0 1-8.5-3 19.2 19.2 0 0 1-5.9-5.9 19.5 19.5 0 0 1-3-8.5A2 2 0 0 1 3.4 1.8h2.9a2 2 0 0 1 2 1.7l.5 3.1a2 2 0 0 1-.6 1.8L7 9.6a15.5 15.5 0 0 0 6 6l1.2-1.2a2 2 0 0 1 1.8-.6l3.1.5a2 2 0 0 1 1.9 2.1z"/>'),
  laurelL: '<svg viewBox="0 0 20 32" fill="currentColor" aria-hidden="true"><path d="M15.7 30.8c-4.6-1.8-8.5-5.3-10.6-9.9a17 17 0 0 1-1.3-11C4.4 6.6 6 3.6 8.3 1.3l1.2 1a15.6 15.6 0 0 0-4.1 8.1 15.6 15.6 0 0 0 1.1 9.7c1.9 4.2 5.5 7.4 9.7 9.1z"/><path d="M4.5 9.3C2.6 8.4 1.5 6.3 1.6 4.2c2 .8 3.3 2.6 3.4 4.8zM3.9 14.6c-2.1-.4-3.6-2.2-3.9-4.3 2.1.3 3.7 1.9 4.2 3.9zM4.8 19.8C2.7 19.8 1 18.3.3 16.3c2.1-.1 4 1.3 4.7 3.3zM7.2 24.5c-2.1.3-4.1-.8-5.1-2.6 2.1-.4 4.2.5 5.3 2.3zM10.6 28.4c-2 .8-4.2.2-5.6-1.3 2-.8 4.2-.3 5.6 1.2z"/></svg>',
};

/** The amenity icon for an included line, picked by what the line talks about. */
function amenityIcon(text: string): string {
  const t = text.toLowerCase();
  if (/life ?jacket|vest|helmet|safety|harness|insur|first aid|brief/.test(t)) return I.shield;
  if (/fuel|gas\b|gasoline/.test(t)) return I.fuel;
  if (/photo|camera|video|gopro|picture/.test(t)) return I.camera;
  if (/guide|instructor|captain|staff|coach|lesson|teacher|host|educator|crew/.test(t)) return I.person;
  if (/food|snack|lunch|dinner|breakfast|meal|cheese|pizza|bbq|appetizer/.test(t)) return I.food;
  if (/wine|beer|drink|beverage|water|soda|tasting|glass|cocktail|coffee|champagne/.test(t)) return I.glass;
  if (/parking|shuttle|transport|pickup|pick-up|drop-off/.test(t)) return I.car;
  if (/ticket|admission|entry|pass\b|access/.test(t)) return I.ticket;
  if (/wi-?fi|internet/.test(t)) return I.wifi;
  if (/towel|shower|locker|restroom|changing/.test(t)) return I.towel;
  if (/sunscreen|shade|umbrella|sun\b/.test(t)) return I.sun;
  if (/equipment|gear|rental|rod|tackle|board|paddle|kayak|bike|ski|boot|club|ball|bait/.test(t)) return I.gear;
  if (/hour|minute|time/.test(t)) return I.clock;
  return I.sparkle;
}

/* ---------- small pieces ---------- */

function Card({ u, onOpen }: { u: Unclaimed; onOpen: (id: string) => void }) {
  const from = fromPrice(u);
  const score = publicRating(u);
  return (
    <button type="button" className="alcard" onClick={() => onOpen(u.id)}>
      <div className="alcardart">
        <Photo src={u.cover} video={u.video} kind={u.art} id={"s" + u.id} alt={u.title} />
      </div>
      <div className="alcardbody">
        <span className="alcardtop">
          <b title={u.title}>{u.title}</b>
          {score ? <span className="alcardrate"><Markup html={I.star} /> {score.rating.toFixed(1)}</span> : null}
            </span>
        <small>{u.area}</small>
        {u.dur ? <small>{tidyDuration(u.dur)}</small> : freeCancelBadge(u) ? <small>Free cancellation</small> : null}
        <span className="alcardprice">{from != null ? <>From <b>{money(from)}</b></> : "Request to book"}</span>
      </div>
    </button>
  );
}

/** TikTok's creator embed needs its script once per page; it upgrades every tiktok-embed blockquote it finds. */
function TikTokScript() {
  useEffect(() => {
    const id = "tiktok-embed-js";
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) existing.remove();
    const s = document.createElement("script");
    s.id = id;
    s.async = true;
    s.src = "https://www.tiktok.com/embed.js";
    document.body.appendChild(s);
  }, []);
  return null;
}

/**
 * One tile of the hero. The first slot plays the operator's clip or embed when there is one, otherwise the cover.
 * A tile that fails to load, or turns out to be a tiny logo, reports itself broken and the grid re-picks its layout
 * around the media that is actually there; nothing on this page ever falls back to placeholder art.
 */
function HeroTile({ m, item, i, onBroken }: { m: Media; item: Unclaimed; i: number; onBroken: () => void }) {
  if (m.kind === "embed") {
    return <iframe className="alembed" src={embedAutoplay(m.src)} title={item.title + " video"} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="strict-origin-when-cross-origin" />;
  }
  if (m.kind === "clip") {
    return <Photo src={m.poster} video={m.src} kind={item.art} id={"wl" + item.id} alt={item.title} size="hero" fallback={false} onBroken={onBroken} />;
  }
  // Photo tries the proxy, then the operator's original, before giving up, and reports a logo-sized file as broken.
  return <Photo src={m.src} kind={item.art} id={"wl" + item.id + i} alt={i === 0 ? item.title : item.title + " photo " + (i + 1)} size={i === 0 ? "hero" : "wide"} fallback={false} onBroken={onBroken} />;
}

const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

/** The lightbox slide: a full-size photo, the clip with controls, or the embed as a player. */
function GallerySlide({ m, item, index }: { m: Media; item: Unclaimed; index: number }) {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  if (m.kind === "embed") {
    return <iframe className="algalleryembed" src={m.src} title={item.title + " video"} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="strict-origin-when-cross-origin" onClick={stop} />;
  }
  const clipSrc = m.kind === "clip" ? safeHttpUrl(m.src) : undefined;
  if (m.kind === "clip" && clipSrc && !isGif(clipSrc)) {
    return <video className="algalleryimg" src={clipSrc} poster={thumb(m.poster, "full")} controls autoPlay muted loop playsInline onClick={stop} aria-label={item.title + " video"} />;
  }
  return <img className="algalleryimg" src={m.kind === "clip" ? clipSrc : thumb(m.src, "full")} alt={item.title + " photo " + (index + 1)} decoding="async" fetchPriority="high" referrerPolicy="no-referrer" onClick={stop} />;
}

/** Airbnb's modal: a white panel over a dimmed page, the close button top left, the body scrolling on its own. */
function Modal({ label, onClose, children, wide = false }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement | null>(null);
  // Focus in and back, Tab kept inside, and the listing behind held still. It used to lock `body` alone, which
  // locks nothing here, and its Close button is the last thing in the document, so the first Tab out of it
  // wrapped to "Back to results" at the top of the page the scrim was covering.
  useModal(box);
  useEffect(() => {
    // Captured and stopped so the app's own Escape (which closes the whole listing) does not fire too.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div className="almodal" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className={"almodalbox" + (wide ? " wide" : "")} ref={box} onClick={(e) => e.stopPropagation()}>
        <div className="almodalhead">
          <button type="button" className="alround" onClick={onClose} aria-label="Close">
            <Markup html={I.close} />
          </button>
        </div>
        <div className="almodalbody">{children}</div>
      </div>
    </div>
  );
}

/** Airbnb's underlined text button with the trailing chevron: "Show more >". */
function MoreLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="almore" onClick={onClick}>
      <span>{children}</span>
      <Markup html={I.chevRight} />
    </button>
  );
}

/**
 * One review in Airbnb's card: the reviewer's initial and name, the source under it, then stars and date on one line
 * and the text clamped to four lines with "Show more" only when it really runs over. Missing fields are left out.
 */
export function ReviewCard({ r }: { r: ShownReview }) {
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el && !open) setOver(el.scrollHeight > el.clientHeight + 2);
  }, [r.text, open]);
  return (
    <article className="alreview">
      <header>
        <span className={"alavatar sm" + (r.initial ? "" : " anon")} aria-hidden="true">{r.initial || <Markup html={I.person} />}</span>
        <span>
          <b>{r.name || "A guest"}</b>
          {r.source ? <small>{r.source} review</small> : null}
        </span>
      </header>
      {r.stars || r.when ? (
        <span className="alreviewmeta">
          {r.stars ? <span className="alreviewstars" role="img" aria-label={r.stars + (r.stars === 1 ? " star" : " stars")}>{Array.from({ length: r.stars }, (_, k) => <Markup key={k} html={I.star} />)}</span> : null}
          {r.stars && r.when ? <span aria-hidden="true">·</span> : null}
          {r.when ? <span>{r.when}</span> : null}
        </span>
      ) : null}
      <p ref={textRef} className={open ? "open" : ""}>{r.text}</p>
      {over || open ? (
        <button type="button" className="alreviewmore" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Show less" : "Show more"}</button>
      ) : null}
    </article>
  );
}

/** The service the card opens on: the cheapest one with a price, else the first. */
function defaultOption(options: { price: number | null }[]): number | null {
  if (!options.length) return null;
  let best = 0;
  for (let i = 1; i < options.length; i++) {
    const a = options[i].price;
    const b = options[best].price;
    if (a != null && (b == null || a < b)) best = i;
  }
  return best;
}

/**
 * Airbnb's inline two-month calendar, the "Select dates" section of the left column. Bound to the same selected
 * day as the reserve card: a day reads as available only when it has start times left, the rest are struck through.
 */
function MonthPair({ dates, dateIdx, onPickDate, chipsFor }: { dates: Date[]; dateIdx: number; onPickDate: (i: number) => void; chipsFor: (d: Date) => TimeChip[] }) {
  const selected = dates[dateIdx];
  const first = dates[0];
  const last = dates[dates.length - 1];
  const firstMonth = new Date(first.getFullYear(), first.getMonth(), 1);
  const lastMonth = new Date(last.getFullYear(), last.getMonth(), 1);
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const selectedKey = dateKey(selected);
  useEffect(() => {
    // Keep the selection on screen when the card moves it into a month this pair is not showing.
    setMonth((m) => {
      const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      const inView = (d: Date) => (d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth()) || (d.getFullYear() === next.getFullYear() && d.getMonth() === next.getMonth());
      return inView(selected) ? m : new Date(selected.getFullYear(), selected.getMonth(), 1);
    });
  }, [selectedKey]);
  const index = useMemo(() => {
    const m = new Map<string, number>();
    dates.forEach((d, i) => m.set(dateKey(d), i));
    return m;
  }, [dates]);
  const open = useMemo(() => {
    const s = new Set<string>();
    dates.forEach((d) => { if (chipsFor(d).length) s.add(dateKey(d)); });
    return s;
  }, [dates, chipsFor]);
  const todayKey = dateKey(startOfToday());
  const canPrev = month > firstMonth;
  // The second month shown is month + 1, so the pair can only advance while that is before the last month.
  const canNext = new Date(month.getFullYear(), month.getMonth() + 1, 1) < lastMonth;
  const months = [month, new Date(month.getFullYear(), month.getMonth() + 1, 1)];
  return (
    <div className="alcal">
      <button type="button" className="alround alcalprev" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} disabled={!canPrev} aria-label="Previous month">
        <Markup html={I.chevLeft} />
      </button>
      <button type="button" className="alround alcalnext" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} disabled={!canNext} aria-label="Next month">
        <Markup html={I.chevRight} />
      </button>
      {months.map((m) => {
        const lead = m.getDay();
        const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
        const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
        for (let d = 1; d <= days; d++) cells.push(new Date(m.getFullYear(), m.getMonth(), d));
        return (
          <div className="alcalmonth" key={m.getTime()}>
            <b className="alcaltitle">{MONTHS[m.getMonth()]} {m.getFullYear()}</b>
            <div className="alcalweek" aria-hidden="true">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((w) => <span key={w}>{w}</span>)}</div>
            <div className="alcalgrid" role="group" aria-label={MONTHS[m.getMonth()] + " " + m.getFullYear()}>
              {cells.map((d, i) => {
                if (!d) return <span key={"e" + i} />;
                const k = dateKey(d);
                const idx = index.get(k);
                const ok = idx !== undefined && open.has(k);
                const on = k === selectedKey;
                return (
                  <button
                    type="button"
                    key={k}
                    className={"alday" + (on ? " on" : "") + (ok ? " ok" : "") + (k === todayKey ? " today" : "")}
                    aria-pressed={on}
                    aria-disabled={!ok}
                    aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + (ok ? "" : ", not available")}
                    onClick={() => { if (ok && idx !== undefined) onPickDate(idx); }}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- date and time picker ---------- */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const WEEK_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** One start time offered for the selected day. `time` is the 24h key the booking carries. */
export type { TimeChip };

/**
 * The booking card's date and time picker, one column wide.
 *
 * Shape borrowed from the pages that do this best: Airbnb's stay picker (full-width month, one-line heading,
 * unavailable days muted and not pickable, today ringed), GetYourGuide and Viator (pick a day, then a wrapped
 * grid of start-time chips carrying the price, a dot on the days that have departures) and OpenTable and Resy
 * (chips, cheapest highlighted, "show all" instead of a scroll box). Never two cramped columns: date, then
 * times, then the button, the way Calendly and Booksy stack it.
 */
function DayTimePicker({ dates, dateIdx, onPickDate, chipsFor, time, onPickTime, emptyNote, sourceNote }: {
  dates: Date[];
  dateIdx: number;
  onPickDate: (i: number) => void;
  /** Start times for a day. Live operator departures when the API has them, published times otherwise. */
  chipsFor: (d: Date) => TimeChip[];
  time: string | null;
  onPickTime: (c: TimeChip) => void;
  emptyNote: string;
  /** Shown under the chips when the times came from the operator's own booking calendar. */
  sourceNote?: string;
}) {
  const selected = dates[dateIdx];
  const selectedKey = dateKey(selected);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const gridRef = useRef<HTMLTableSectionElement | null>(null);

  // Follow the selection into its month, and start a new day's times collapsed.
  useEffect(() => {
    setMonth((m) => (m.getMonth() === selected.getMonth() && m.getFullYear() === selected.getFullYear() ? m : new Date(selected.getFullYear(), selected.getMonth(), 1)));
    setShowAll(false);
  }, [selectedKey]);

  const bookable = useMemo(() => {
    const m = new Map<string, number>();
    dates.forEach((d, i) => m.set(dateKey(d), i));
    return m;
  }, [dates]);
  // A day reads as available only when it really has start times left.
  const openDays = useMemo(() => {
    const s = new Set<string>();
    dates.forEach((d) => { if (chipsFor(d).length) s.add(dateKey(d)); });
    return s;
  }, [dates, chipsFor]);

  const firstMonth = useMemo(() => new Date(first.getFullYear(), first.getMonth(), 1), [first]);
  const lastMonth = useMemo(() => new Date(last.getFullYear(), last.getMonth(), 1), [last]);
  const canPrev = month > firstMonth;
  const canNext = month < lastMonth;
  const todayKey = dateKey(startOfToday());
  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;

  const rows = useMemo(() => {
    const lead = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (cells.length % 7) cells.push(null);
    const out: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [month.getTime()]);

  // Roving tab stop: one day in the grid is reachable by Tab, the arrows move it.
  const inMonth = (k: string) => k.slice(0, 7) === monthPrefix;
  const tabKey = focusKey && inMonth(focusKey) ? focusKey : inMonth(selectedKey) ? selectedKey : monthPrefix + "-01";
  useEffect(() => {
    if (!focusKey) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-k="${focusKey}"]`)?.focus();
  }, [focusKey, monthPrefix]);

  const move = (by: number) => {
    const [y, m, d] = tabKey.split("-").map(Number);
    const next = new Date(y, m - 1, d + by);
    const limit = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);
    if (next < firstMonth || next > limit) return;
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    setFocusKey(dateKey(next));
  };
  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, PageUp: -28, PageDown: 28 };
    if (e.key in step) { e.preventDefault(); move(step[e.key]); return; }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const [y, m, d] = tabKey.split("-").map(Number);
      const wd = new Date(y, m - 1, d).getDay();
      move(e.key === "Home" ? -wd : 6 - wd);
    }
  };

  const chips = chipsFor(selected);
  const shown = showAll || chips.length <= 9 ? chips : chips.slice(0, 9);
  // A price on every chip only earns its room when the chips differ. One repeated figure is noise; the
  // total below already carries it.
  const showPrice = chips.some((c) => c.price != null) && new Set(chips.map((c) => c.price)).size > 1;
  // Resy and OpenTable mark the cheapest sitting when the prices differ. With one price it means nothing.
  const cheapest = useMemo(() => {
    const priced = chips.filter((c) => c.price != null);
    const lo = Math.min(...priced.map((c) => c.price!));
    if (priced.length < 2 || lo === Math.max(...priced.map((c) => c.price!))) return null;
    return lo;
  }, [chips]);
  const endsInView = !canNext && last.getDate() < new Date(last.getFullYear(), last.getMonth() + 1, 0).getDate();

  return (
    <div className="bkpick">
      <div className="bkcal">
        <div className="bkcalhead">
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} disabled={!canPrev} aria-label="Previous month">
            <Markup html={ICONS.back} />
          </button>
          <b aria-live="polite">{MONTHS[month.getMonth()]} {month.getFullYear()}</b>
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} disabled={!canNext} aria-label="Next month">
            <Markup html={ICONS.arrow} />
          </button>
        </div>
        <table className="bkgrid" role="grid" aria-label={"Dates in " + MONTHS[month.getMonth()] + " " + month.getFullYear()}>
          <thead>
            <tr>
              {WEEK_LETTER.map((w, i) => <th key={i} scope="col" abbr={WEEK_FULL[i]} title={WEEK_FULL[i]}>{w}</th>)}
            </tr>
          </thead>
          <tbody ref={gridRef} onKeyDown={onKey}>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((d, ci) => {
                  if (!d) return <td key={ci} />;
                  const k = dateKey(d);
                  const idx = bookable.get(k);
                  const open = idx !== undefined && openDays.has(k);
                  const on = k === selectedKey;
                  return (
                    <td key={ci}>
                      <button
                        type="button"
                        data-k={k}
                        className={"bkday" + (on ? " on" : "") + (k === todayKey ? " today" : "") + (open ? " open" : "")}
                        tabIndex={k === tabKey ? 0 : -1}
                        aria-disabled={!open}
                        aria-pressed={on}
                        aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + (open ? "" : ", not available")}
                        onFocus={() => setFocusKey(k)}
                        onClick={() => { if (open && idx !== undefined) onPickDate(idx); }}
                      >
                        <span>{d.getDate()}</span>
                        {open ? <i aria-hidden="true" /> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {endsInView ? <p className="bkcalfoot">Bookable through {MONTHS[last.getMonth()].slice(0, 3)} {last.getDate()}</p> : null}
      </div>

      <div className="bktimes">
        <div className="bktimehead">
          <span>Start times</span>
          <span>{fmtDate(selected)}</span>
        </div>
        {chips.length ? (
          <>
            <div className="bkchips" role="group" aria-label="Start times">
              {shown.map((c) => (
                <button
                  type="button"
                  key={c.key}
                  className={"bkchip" + (time === c.time ? " on" : "") + (cheapest != null && c.price === cheapest ? " best" : "")}
                  aria-pressed={time === c.time}
                  onClick={() => onPickTime(c)}
                >
                  <b>{c.label}</b>
                  {showPrice && c.price != null ? <span>{money(c.price)}</span> : null}
                  {fewSeats(c.seatsLeft) ? <em>{c.seatsLeft} left</em> : null}
                </button>
              ))}
            </div>
            {chips.length > shown.length ? (
              <button type="button" className="bkmore" onClick={() => setShowAll(true)}>Show all {chips.length} times</button>
            ) : null}
            {sourceNote ? <p className="bksource">{sourceNote}</p> : null}
          </>
        ) : (
          <p className="bkempty">{emptyNote}</p>
        )}
      </div>
    </div>
  );
}

type KnowCol = { key: string; title: string; icon: string; lines: string[]; extra?: ReactNode };

export function WebListing({ item, onClose, onOpen }: { item: Unclaimed; onClose: () => void; onOpen: (id: string) => void }) {
  const { state, dates, confirmUnclaimed, setDate, openOperator, openAsk } = useApp();
  const metro = metroById(item.metroId);
  // The public rating and its count appear only beside written reviews we can actually show. A number with
  // nothing behind it reads as a promise of reviews, and the site does not make promises.
  const reviews = useMemo(() => shownReviews(item.quotes, item.title), [item.quotes, item.title]);
  const score = reviews.length ? publicRating(item) : null;
  const contact = contactFor(item);
  // Null when the shop published something that is not a number a guest can ring, and then no call is offered.
  const callHref = contact?.phone ? telHref(contact.phone) : null;
  const addressRaw = contact ? addressLine(contact) : null;
  const address = addressRaw ? tidyAddress(addressRaw) : null;
  const facts = listingFacts(item);
  // The operator's own guide (edited on the dashboard) replaces the steps, bring list and "good for" of the
  // kind's default; the default's time and nerves lines stay. With no default for the kind, theirs stands alone.
  const guide = item.guide && (item.guide.steps.length || item.guide.bring.length || item.guide.goodFor)
    ? { ...(GUIDES[item.art] || { hook: "", time: "", nerves: "" }), ...item.guide }
    : GUIDES[item.art];
  // The hero lays itself out from the media that really loads. Every photo is probed at thumbnail size up front so a
  // dead URL or a 40 px logo never claims a tile; a tile that still fails later drops out and the grid re-picks.
  const candidates = photoCandidates(item);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const drop = (src: string) => setBroken((b) => (b.has(src) ? b : new Set(b).add(src)));
  const media = listingMedia(item, broken);
  const hasVideo = media[0]?.kind !== "photo" && media.length > 0;
  // Only the first five ever render in the hero, and each probe is a real image fetch competing with the hero
  // photo the guest is waiting on. The rest are probed when the gallery opens; see deepProbe below.
  useEffect(() => probePhotos(candidates.slice(0, 5), drop), [candidates.join("|")]);

  const [time, setTime] = useState<string | null>(null);
  // The party picked in Who on the home page opens the box, the way the date already does and the way the
  // phone sheet has always carried its own pick. The shop's own ceiling still wins, here and in the clamp below.
  const [qty, setQty] = useState(() => startingParty(maxGuestsFor(item, defaultOption(item.options))));
  // The card is live from the first paint: the cheapest service is already chosen, so nothing sends the
  // guest off to the menu on the left before they can press the button.
  const [optionIdx, setOptionIdx] = useState<number | null>(() => defaultOption(item.options));
  // The catalog hydrates after first paint, so the menu can arrive a beat late; re-pick the default then. Every
  // generated listing opens with an empty menu until its own detail file lands, so this runs on essentially
  // every listing a guest opens, not only a rare edit. A time already chosen for this same listing must survive
  // that: it only clears when the guest has actually moved to a different listing, and the openSlots effect
  // below still catches a time the hydrated menu makes invalid.
  const prevItemId = useRef(item.id);
  useEffect(() => {
    setOptionIdx(defaultOption(item.options));
    if (prevItemId.current !== item.id) {
      prevItemId.current = item.id;
      setTime(null);
    }
  }, [item.id, item.options.length]);
  const [addonIdx, setAddonIdx] = useState<number[]>([]);
  const [openSvc, setOpenSvc] = useState<string | null>(null);
  const [moreSvc, setMoreSvc] = useState<string[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [guest, setGuest] = useState<{ name: string; phone: string; email?: string }>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem("outset.guest") || "null");
      const g = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      return {
        name: typeof g.name === "string" ? g.name : "",
        phone: typeof g.phone === "string" ? g.phone : "",
        ...(typeof g.email === "string" ? { email: g.email } : {}),
      };
    } catch {
      return { name: "", phone: "" };
    }
  });
  const guestOk = guest.name.trim().length >= 2 && guest.phone.replace(/\D/g, "").length >= 10;
  const [payments, setPayments] = useState(false);
  useEffect(() => { let alive = true; void apiConfig().then((c) => { if (alive) setPayments(c.payments); }); return () => { alive = false; }; }, []);
  const { wallet } = useWallet();
  const [gallery, setGallery] = useState<number | null>(null);
  const galleryBox = useRef<HTMLDivElement | null>(null);
  // The rest of the photos, probed once the gallery has been opened. This is the half of the comment above the
  // hero probe that was never written: only the first five were ever checked, so on 20,987 listings the 52,016
  // slides past the fifth reached the lightbox unexamined, and a dead URL or a 40 px logo took a full slide and
  // a place in the count. The phone sheet has always probed all twelve, so the two surfaces disagreed about how
  // many photos the same listing has. Still not before the gallery opens: a probe is a real fetch competing
  // with the hero the guest is waiting on.
  const [deepProbe, setDeepProbe] = useState(false);
  useEffect(() => { if (gallery != null) setDeepProbe(true); }, [gallery]);
  useEffect(() => (deepProbe ? probePhotos(candidates.slice(5), drop) : undefined), [deepProbe, candidates.join("|")]);
  /** Which modal is open: the description, the full included list, a Things to know column, or the guide. */
  const [modal, setModal] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("outset.saved") || "[]");
      return Array.isArray(parsed) && parsed.includes(item.id);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (gallery == null) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the lightbox only, not the listing behind it.
      if (e.key === "Escape") { e.stopPropagation(); setGallery(null); }
      if (e.key === "ArrowRight") setGallery((g) => (g == null ? g : (g + 1) % media.length));
      if (e.key === "ArrowLeft") setGallery((g) => (g == null ? g : (g - 1 + media.length) % media.length));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [gallery, media.length]);
  // The scrim covers the page, so the page behind it has to stop: it locked `body` only, which locks nothing
  // once `html` is the scroller, so a wheel over a full-screen photo rolled the listing underneath it. Focus
  // never came in here at all, so a guest who opened the photos was still standing on "Show all photos".
  useModal(galleryBox, gallery != null);
  useEffect(() => {
    // A tile dropping out of the list must not leave the lightbox pointing past the end.
    if (gallery != null && gallery >= media.length) setGallery(media.length ? media.length - 1 : null);
  }, [gallery, media.length]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(t);
  }, [flash]);

  const picked = optionIdx != null ? item.options[optionIdx] : null;
  const optGroups = useMemo(() => bookingGroups(item), [item]);
  const pickedGroup = optGroups.find((g) => g.rows.some((r) => r.idx === optionIdx)) || null;
  const pickedRow = pickedGroup?.rows.find((r) => r.idx === optionIdx) || null;
  const [optOpen, setOptOpen] = useState(false);
  const [optFilter, setOptFilter] = useState<string>("all");
  const optRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!optOpen) return;
    const onDown = (e: MouseEvent) => { if (optRef.current && !optRef.current.contains(e.target as Node)) setOptOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOptOpen(false); } };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    optRef.current?.querySelector(".aloptpop")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey, true); };
  }, [optOpen]);
  const extras = addonIdx.map((i) => (item.addons || [])[i]).filter(Boolean);
  const p = priceUnclaimed(picked, qty, extras);
  const needService = item.options.length > 0;
  // Attractions sell entry, not a slot. With no menu to book, the card becomes hours plus a tickets link.
  const VISIT_ARTS = new Set(["zoo", "aquarium", "themepark", "waterpark", "museum", "garden", "theatre", "arcade", "icerink", "trampoline", "bowling", "minigolf", "billiards", "camping", "sauna", "swim", "tennis", "discgolf", "venue", "brewery", "winery", "distillery"]);
  const visit = !needService && VISIT_ARTS.has(item.art);
  // The business's own site, crawled or operator-set: never trust it as a scheme without checking first.
  const ticketHref = safeHttpUrl(contact?.website || item.src);
  // The week this shop publishes, read once: the visit panel, the start times and the empty picker's line all
  // ask it, and parsing an operator's hour lines three times a render buys nothing.
  const week = useMemo(() => itemWeek(item), [item]);
  const visitWeek = visit ? week : null;
  const clock = (m: number) => fmtTime(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
  // The shop paused bookings or hid the listing in its dashboard. The page still opens by its own link, so a
  // guest who has it bookmarked learns why, but nothing here can be booked and the API refuses too. Both flags
  // only ever come from an owner's saved profile, so they count before the next sync stamps the record `claimed`.
  const paused = bookingPaused(item);
  // The operator's own "max guests per slot" for the service being booked, else the ceiling their own site
  // states, not a number we picked. Named here too, so a stepper that has stopped says what stopped it.
  const maxGuests = maxGuestsFor(item, optionIdx);
  const guestCap = guestCapFor(item, optionIdx);
  // The party has to come down with it when a smaller service is picked. The picker asks the API for times
  // that hold this many guests, and a service that holds fewer than the party has no such time on any date, so
  // a party left above the new limit emptied every day in the calendar and the page read as fully booked for
  // good. The stepper's own "+" was already held at the limit; only the number it started from was not.
  useEffect(() => { setQty((q) => Math.min(q, maxGuests)); }, [maxGuests]);
  const ready = !paused && time != null && (!needService || picked != null) && guestOk;
  // The card form's script and config load now, while the guest reads the price, so "Book and pay" opens it at once.
  useEffect(() => { if (ready && p.total) warmCheckout(); }, [ready, p.total]);
  const instant = !!(item.claimed && item.instant);
  // Say what pressing it does: a card payment, Otto holding the saved card, or a request the operator confirms.
  const ottoNow = ottoCanPay(wallet, p.total);
  const ctaLabel = payments && p.total ? (ottoNow ? "Book with Otto" : "Book and pay") : instant ? "Book" : "Request to book";
  const day = dates[state.dateIdx];

  /* Live departures from the operator's own booking system, when they run one we can read. The card paints
     with the published times first and upgrades itself when this resolves; with no API it never resolves
     true and nothing changes. */
  const [avail, setAvail] = useState<LiveAvailability | null>(null);
  useEffect(() => {
    let alive = true;
    setAvail(null);
    void fetchAvailability(item.id, dateKey(dates[0]), dates.length).then((a) => { if (alive) setAvail(a); }).catch(() => {});
    return () => { alive = false; };
  }, [item.id]);
  const liveDays = useMemo(() => liveChipsByDate(avail), [avail]);
  const live = liveDays.size > 0;

  /* What is actually still open on Outset: the claimed shop's own hours minus every time already booked. Loaded
     from the API, reloaded after a booking, and re-keyed on the picked service because capacity is per service,
     and on the party size, because a time with one seat left is not open to two guests. */
  const [openMap, setOpenMap] = useState<Map<string, string[]> | null>(null);
  const [openTick, setOpenTick] = useState(0);
  const reloadOpen = useCallback(() => setOpenTick((n) => n + 1), []);
  useEffect(() => {
    if (!hasApi()) return;
    let alive = true;
    void fetchOpenSlots(item.id, dateKey(dates[0]), dates.length, picked?.name, qty).then((r) => {
      if (!alive || !r.known) return;
      setOpenMap(new Map(r.days.map((d) => [d.date, d.slots])));
    });
    return () => {
      alive = false;
    };
  }, [item.id, picked?.name, qty, openTick]);

  // Today only shows start times at least an hour out. Nobody can book a 7 AM slot at 8:30. "Today" and "an
  // hour out" are both read on the shop's clock, because the times themselves are its wall clock times.
  const chipsFor = useMemo(() => {
    const stillOpen = bookableStart(item);
    const listed = picked?.price != null ? picked.price : undefined;
    // With no API to ask, the fixed times still drop the ones this shop's own published hours are shut for, so
    // the picker and the hours row a few lines above it cannot say different things. Same rule the API applies.
    return (d: Date) => {
      const k = dateKey(d);
      const fromLive = liveDays.get(k);
      if (live) return (fromLive || []).filter((c) => stillOpen(k, c.time)).slice().sort((a, b) => a.time.localeCompare(b.time));
      const base = openMap ? openMap.get(k) || [] : startTimesOn(week ? week[d.getDay()] ?? null : null, SLOT_TIMES);
      return base.filter((t) => stillOpen(k, t))
        .map((t) => ({ key: t, time: t, label: fmtTime(t), price: listed }));
    };
  }, [live, liveDays, item, picked?.price, openMap]);
  const openSlots = useMemo(() => chipsFor(day).map((c) => c.time), [chipsFor, day]);
  // An empty picker says why it is empty. A day the shop publishes as closed is not "no more start times
  // today", least of all under a date five days out.
  const emptyNote = live
    ? "No departures on this date. Pick another day."
    : noStartTimesNote(week ? week[day.getDay()] ?? null : null, day.toLocaleDateString("en-US", { weekday: "long" }));
  useEffect(() => { if (time && !openSlots.includes(time)) setTime(null); }, [openSlots, time]);
  // Land the guest on a day that actually has departures rather than an empty one.
  useEffect(() => {
    if (chipsFor(dates[state.dateIdx]).length) return;
    const i = dates.findIndex((d) => chipsFor(d).length);
    if (i >= 0 && i !== state.dateIdx) setDate(i);
  }, [chipsFor]);

  // Recomputed when the catalog grows: a shared link opens the listing from its own file before the catalog
  // arrives, and a rail built then held whatever few listings were loaded, from anywhere in the country.
  const { similar, similarNear } = useMemo(() => {
    const all = getCatalog().filter((u) => u.id !== item.id && u.art === item.art);
    const near = all.filter((u) => u.metroId && u.metroId === item.metroId);
    // Same metro first, then the same state or province, then anywhere. Nobody in Washington DC wants San Jose.
    const region = regionOfArea(item.area);
    const sameRegion = region ? all.filter((u) => regionOfArea(u.area) === region) : [];
    const pool = near.length >= 4 ? near : sameRegion.length >= 4 ? sameRegion : near.length ? [...near, ...sameRegion] : all;
    const picks = pool.sort((a, b) => (b.cover ? 1 : 0) - (a.cover ? 1 : 0) || (b.reviews || 0) - (a.reviews || 0)).slice(0, 10);
    // "Near Tampa Bay" is only true when the picks are there, not when the fallback reached across the country.
    return { similar: picks, similarNear: picks.length > 0 && picks.every((u) => u.metroId === item.metroId) };
  }, [item.id, state.catalogVersion]);

  /* ---------- derived, never invented ---------- */
  const requirements = item.requirements?.length ? item.requirements : facts.who.filter((l) => l.posted).map((l) => l.text);
  const included = splitIncluded(item.includes);
  const includes = included.yes;
  const notIncluded = included.no;
  const reqKeys = new Set(requirements.map((r) => r.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const highlights = (item.highlights?.length ? item.highlights : facts.about.slice(0, 6)).filter((h) => !reqKeys.has(h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const waiverLines = (item.policies?.filter((l) => /\bwaivers?\b|\bliabilit|\brelease form|\bsign(ed|ing)? (a |the |our |your )?(waiver|release|form)|\bcheck-?in\b/i.test(l)) || facts.waiver.filter((l) => l.posted).map((l) => l.text)).filter((l) => l.length <= 160);
  const policies = splitPolicies(item.policies || []);
  const otherPolicies = policies.other;
  const cancelRaw = freeCancelBadge(item);
  const cancel = cancelRaw ? tidyCancel(cancelRaw) : null;
  const age = minAge(requirements);
  const durationRaw = item.dur || durationLabel(item);
  const duration = durationRaw ? tidyDuration(durationRaw) : null;
  const openNow = itemOpenState(item);
  const dealsNow = todaysDeals(item);
  const today = item.promos?.length ? clockIn(zoneFor(item)).day : -1;
  const groupCap = readGroupCap(item.groupInfo);
  const hours = displayHours(hourLines(item).length ? hourLines(item) : contact?.hours || []);
  // The same bar the cards use, and beside it this page's own rule: a rating is printed only where
  // there are written reviews to read under it, which is what `score` already carries.
  const topRatedHere = !!score && isTopRated(item);
  const near = state.near ? nearestLocation(item, state.near) : null;
  const typeName = TYPE_NAME[item.art] || "Experience";
  const initial = (item.title.replace(/^the\s+/i, "").match(/[A-Za-z]/) || [item.title.slice(0, 1)])[0].toUpperCase();
  const bookableCount = bookableServices(item.services).length || item.options.filter((o) => o.price != null || o.name).length;
  const checkin = arrivalNote(item);
  const services = useMemo(() => bookableServices(item.services), [item.services]);
  const blurb = item.blurb ? cleanDesc(item.blurb).replace(/\s+(Book|Learn more|Read more|Reserve)\.?$/i, "") : "";

  // The grey line under the subtitle, Airbnb's "4 guests · 2 bedrooms · 2 beds": only what the operator states.
  // The duration is not here: it belongs on the tiers and in the booking box. The line above this one is the
  // open status ("Open · closes 7 PM"), and only when the business publishes hours; no hours, no line, no guess.
  const keyFacts: string[] = [];
  if (groupCap) keyFacts.push("Up to " + groupCap + " guests");
  if (age) keyFacts.push("Ages " + age + "+");
  if (item.season && item.season.length <= 32) keyFacts.push(item.season);
  if (item.locations?.length) keyFacts.push(item.locations.length + 1 + " locations");
  if (near) {
    const from = state.near!.label === "Near me" ? " away" : " from " + state.near!.label;
    keyFacts.push(fmtDistance(near.km, countryOfArea(item.area)) + from);
  }

  // Three highlight rows, Airbnb's "Self check-in / Great location / Free cancellation", from what the listing has.
  const rows: { icon: string; title: string; text: string }[] = [];
  if (dealsNow.length) {
    const d = dealsNow[0];
    rows.push({ icon: I.tag, title: "Deal today", text: dealShown(d).title + (d.code ? ", code " + d.code : "") + (d.end ? ", until " + clock12(d.end) : d.start ? ", from " + clock12(d.start) : "") });
  }
  if (live) rows.push({ icon: I.calendar, title: "Live times from their calendar", text: "Start times come straight from " + possessive(item.title) + " own booking system." });
  // Open status is the header line under the subtitle now, so it is not repeated as a highlight row.
  if (cancel) rows.push({ icon: I.calendar, title: cancel, text: "Plans change. Their published policy lets you cancel for a full refund." });
  if (instant) rows.push({ icon: I.bolt, title: "Instant confirmation", text: "Your spot is confirmed the moment you book." });
  else if (!visit) rows.push({ icon: I.message, title: "Request to book", text: "The business confirms by email. Nothing is charged until they do." });
  else if (ticketHref) rows.push({ icon: I.ticket, title: "Tickets from the business", text: "Entry is sold on " + possessive(item.title) + " own site, at their prices." });
  if (item.meetingPoint) rows.push({ icon: I.door, title: "Meeting point", text: tidyLine(item.meetingPoint) });
  if (topRatedHere && rows.length < 3) rows.push({ icon: I.medal, title: "Top rated", text: "Rated " + score!.rating.toFixed(1) + " from " + reviewsLine(score!.reviews, "public") + "." });
  const highlightRows = rows.slice(0, 3);

  // Things to know, Airbnb's three columns. A column with nothing stated stays out.
  const rules = [...requirements, ...(item.bring || []).map(bringLine), ...(item.groupInfo || [])];
  const safety = [...(age ? ["Minimum age " + age] : []), ...waiverLines];
  if (item.waiverUrl && !safety.some((l) => /waiver/i.test(l))) safety.push("Waiver to sign before you arrive");
  // The short free-cancellation line and the full policy are often the same sentence, one with a period and one
  // without: the column showed it twice. When the policy already says what the short line says, the policy alone stays.
  const cancelKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const cancelFull = item.cancellation ? tidyLine(item.cancellation) : null;
  const cancelShort = cancel && !(cancelFull && cancelKey(cancelFull).includes(cancelKey(cancel))) ? cancel : null;
  // A shop that states its terms as one of its policy lines rather than in `cancellation` was told it had none.
  const cancelLines: string[] = [];
  for (const line of [...(cancelShort ? [cancelShort] : []), ...(cancelFull ? [cancelFull] : []), ...policies.cancel.map(tidyLine)]) {
    if (line && !cancelLines.some((p) => cancelKey(p).includes(cancelKey(line)))) cancelLines.push(line);
  }
  // The rest of what a shop publishes ("No outside food", "$20 fuel surcharge") is not a cancellation term, so the
  // column says so in its heading instead of filing them all under one.
  const policyLines = [...(cancelLines.length ? cancelLines : ["Contact the business for cancellation terms before you book."]), ...otherPolicies];
  const knowCols: KnowCol[] = [];
  if (rules.length) knowCols.push({ key: "rules", title: "Who can go", icon: I.group, lines: rules });
  if (safety.length) knowCols.push({ key: "safety", title: "Safety and waiver", icon: I.shield, lines: safety });
  if (cancelLines.length || otherPolicies.length || knowCols.length) {
    knowCols.push({ key: "cancel", title: otherPolicies.length ? "Policies" : "Cancellation policy", icon: I.calendar, lines: policyLines });
  }

  const cheapIdx = defaultOption(item.options);
  const cheap = cheapIdx != null ? item.options[cheapIdx] : null;
  const from = fromPrice(item);
  const fromUnit = cheap && hasPrice(cheap.price) ? priceWith(cheap.price, cheap.per).replace(/^\$[\d,.]+\s*/, "") || (perPerson(cheap) ? "/ person" : "") : "";

  const [sending, setSending] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const book = async () => {
    if (!ready || !time || sending) return;
    try {
      localStorage.setItem("outset.guest", JSON.stringify(guest));
    } catch {
      /* ignore */
    }
    setSending(true);
    setBookError(null);
    const r = await confirmUnclaimed({ dateIdx: state.dateIdx, slot: time, qty, optionIdx, addonIdx, guest: { name: guest.name.trim(), phone: guest.phone.trim(), email: (guest.email || "").trim() || undefined }, pay: payments && !!p.total });
    setSending(false);
    if (r.ok) {
      // A card booking leaves for Stripe behind the checkout splash; the "sent" panel is for the request path.
      if (!r.checkoutUrl) setDone(true);
      reloadOpen();
      return;
    }
    setBookError(r.error || "Could not send the request.");
    // The time filled up while the guest was looking at it: drop it from the picker and ask for another.
    if (r.taken) {
      setTime(null);
      reloadOpen();
    }
  };

  const nameRef = useRef<HTMLInputElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const reserveRef = useRef<HTMLButtonElement | null>(null);
  const colsRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const pressReserve = () => {
    if (ready) return book();
    if (time == null) return setPickerOpen(true);
    (guest.name.trim().length < 2 ? nameRef : phoneRef).current?.focus();
  };

  const share = async () => {
    const url = listingUrl(item.id);
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: item.title, url }); } catch { /* dismissed */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setFlash("Link copied");
    } catch {
      setFlash(url);
    }
  };
  const toggleSave = () => {
    const next = !saved;
    setSaved(next);
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("outset.saved") || "[]");
      const list = (Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []).filter((x) => x !== item.id);
      localStorage.setItem("outset.saved", JSON.stringify(next ? [...list, item.id] : list));
    } catch {
      /* private window: the heart still fills for this visit */
    }
    setFlash(next ? "Saved" : "Removed from saved");
  };

  /* Airbnb's section bar: it slides in once the photos scroll away, and carries the price and the button once
     the reserve card has scrolled off too. */
  const [navOn, setNavOn] = useState(false);
  const [navCta, setNavCta] = useState(false);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const hero = heroRef.current?.getBoundingClientRect();
        setNavOn(!!hero && hero.bottom < 0);
        const btn = reserveRef.current?.getBoundingClientRect();
        setNavCta(!!btn && btn.bottom < 72);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 88, behavior: "smooth" });
  };

  // Description truncation at six lines, with "Show more" only when the text really runs over.
  const descRef = useRef<HTMLDivElement | null>(null);
  const [descOver, setDescOver] = useState(false);
  const measure = useCallback(() => {
    const el = descRef.current;
    setDescOver(!!el && el.scrollHeight > el.clientHeight + 4);
  }, []);
  useLayoutEffect(measure, [item.id, blurb, highlights.length, measure]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Close the date popover on an outside click.
  const popRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setPickerOpen(false); } };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    // Bring the whole picker on screen when the card sits low on the page.
    popRef.current?.querySelector(".alpop")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey, true); };
  }, [pickerOpen]);

  const railRef = useRef<HTMLDivElement | null>(null);
  const railBy = (dir: number) => {
    const el = railRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };

  const priceTag = from != null ? (
    <span className="alprice"><span className="alpricefrom">From</span> <b>{money(from)}</b>{fromUnit ? <span> {fromUnit}</span> : null}</span>
  ) : (
    <span className="alprice"><b>Request to book</b></span>
  );
  const chipsToday = chipsFor(day);
  const allIncluded = [...includes.map((t) => ({ t, no: false, strike: false })), ...notIncluded.map((n) => ({ t: n.text, no: true, strike: n.strike }))];
  const knowModal = knowCols.find((c) => "know-" + c.key === modal);

  return (
    <div className="wlisting al">
      <header className="alhead">
        <div className="alwrap alheadin">
          <button type="button" className="alback" onClick={onClose} aria-label="Back to results">
            <span className="alround"><Markup html={I.chevLeft} /></span>
            <span>Back to results</span>
        </button>
          <a className="allogo" href="#" onClick={(e) => { e.preventDefault(); onClose(); }} aria-label="Outset home">
            <Mark size={30} />
            <b>Outset</b>
          </a>
        </div>
      </header>

      <nav className={"alsubnav" + (navOn ? " on" : "")} aria-label="Sections" aria-hidden={!navOn}>
        <div className="alwrap alsubnavin">
          <div className="alsublinks">
            {media.length ? <button type="button" tabIndex={navOn ? 0 : -1} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Photos</button> : null}
            {allIncluded.length ? <button type="button" tabIndex={navOn ? 0 : -1} onClick={() => jump("al-included")}>What's included</button> : null}
            {score || reviews.length ? <button type="button" tabIndex={navOn ? 0 : -1} onClick={() => jump("al-reviews")}>Reviews</button> : null}
            <button type="button" tabIndex={navOn ? 0 : -1} onClick={() => jump("al-location")}>Location</button>
          </div>
          {navCta && !visit && !done && !paused ? (
            <div className="alsubcta">
              <span>{priceTag}{score ? <small><Markup html={I.star} /> {score.rating.toFixed(1)} · {reviewsLine(score.reviews)}</small> : null}</span>
              <button type="button" className="alprimary" tabIndex={navOn ? 0 : -1} onClick={() => { jump("al-cols"); if (time == null) window.setTimeout(() => setPickerOpen(true), 450); }}>{ctaLabel}</button>
            </div>
          ) : null}
        </div>
      </nav>

      <div className="alwrap">
        {state.removeId === item.id ? (
          <div className="alnotice">
            <span>
            <b>Is this your business and you'd rather not be listed?</b>
              <small>We take listings down within one business day. Send one line from a company email and it's gone.</small>
            </span>
            <a className="aloutline" href={"mailto:harshils2340@gmail.com?subject=" + encodeURIComponent("Remove listing: " + item.title + " (" + item.id + ")") + "&body=" + encodeURIComponent("Please remove " + item.title + " from Outset.\n\nListing: " + listingUrl(item.id) + "\n")}>Request removal</a>
          </div>
        ) : null}

        <div className="altitlerow" ref={media.length ? undefined : heroRef}>
          <div className="altitlewrap">
            <h1 className="altitle">{item.title}</h1>
            <AdminSiteLink item={{ src: item.src, contact: contact || item.contact }} />
        </div>
          <div className="alactions">
            <button type="button" className="altextbtn" onClick={() => void share()}>
              <Markup html={I.share} /> <span>Share</span>
            </button>
            <button type="button" className={"altextbtn" + (saved ? " saved" : "")} onClick={toggleSave} aria-pressed={saved}>
              <Markup html={saved ? I.heartOn : I.heart} /> <span>{saved ? "Saved" : "Save"}</span>
            </button>
          </div>
          </div>

        {media.length ? (
          <div className={"alphotos n" + Math.min(media.length, 5)} ref={heroRef}>
            {media.slice(0, 5).map((m, i) => (
              <button type="button" className={"alphoto " + (i === 0 ? "main" : "p" + (i - 1))} key={m.src} onClick={() => setGallery(i)} aria-label={i === 0 ? "Open photos" : "Open photo " + (i + 1)}>
                <HeroTile m={m} item={item} i={i} onBroken={() => drop(m.src)} />
                {i === 0 && m.kind !== "photo" ? <span className="alplaytag"><Markup html={PLAY} /> Video</span> : null}
          </button>
            ))}
            {media.length > 1 ? (
              <button type="button" className="alshowall" onClick={() => setGallery(0)}>
                <Markup html={I.grid} />
                <span>{hasVideo ? "Show video and " + (media.length - 1) + (media.length === 2 ? " photo" : " photos") : "Show all photos"}</span>
            </button>
          ) : null}
        </div>
        ) : null}

        {gallery != null && media[gallery] ? (
          <div className="algallery" ref={galleryBox} onClick={() => setGallery(null)} role="dialog" aria-modal="true" aria-label="Photos">
            <div className="algalleryhead" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="algalleryclose" onClick={() => setGallery(null)} aria-label="Close">
                <Markup html={I.close} /> <span>Close</span>
              </button>
              <span className="algallerycount">{gallery + 1} / {media.length}</span>
              <span className="algalleryactions">
                <button type="button" onClick={() => void share()}><Markup html={I.share} /> <span>Share</span></button>
                <button type="button" onClick={toggleSave} aria-pressed={saved}><Markup html={saved ? I.heartOn : I.heart} /> <span>{saved ? "Saved" : "Save"}</span></button>
              </span>
            </div>
            <button type="button" className="algallerynav prev" onClick={(e) => { e.stopPropagation(); setGallery((gallery - 1 + media.length) % media.length); }} aria-label="Previous photo" disabled={media.length < 2}>
              <Markup html={I.chevLeft} />
            </button>
            <GallerySlide m={media[gallery]} item={item} index={gallery} />
            <button type="button" className="algallerynav next" onClick={(e) => { e.stopPropagation(); setGallery((gallery + 1) % media.length); }} aria-label="Next photo" disabled={media.length < 2}>
              <Markup html={I.chevRight} />
            </button>
            <div className="algallerystrip" onClick={(e) => e.stopPropagation()}>
              {media.map((m, i) => (
                <button type="button" key={m.src} aria-pressed={i === gallery} onClick={() => setGallery(i)} aria-label={m.kind === "photo" ? "Photo " + (i + 1) : "Video"}>
                  {m.kind === "photo" || (m.kind === "clip" && m.poster) ? (
                    <img src={thumb(m.kind === "photo" ? m.src : m.poster, "thumb")} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="algalleryplay"><Markup html={PLAY} /></span>
                  )}
                  {m.kind !== "photo" ? <span className="algalleryplay over"><Markup html={PLAY} /></span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className={"alcols" + (media.length ? "" : " nohero")} id="al-cols" ref={colsRef}>
          <div className="almain">
            <section className="alsec alintro">
              <h2>{typeName} in {placeName(item.area)}</h2>
              {openNow ? <p className={"alstatus " + (openNow.open ? (openNow.soon ? "soon" : "open") : "closed")}>{openNow.line}</p> : null}
              {keyFacts.length ? <p className="alfacts">{keyFacts.join(" · ")}</p> : null}
              {!topRatedHere && score ? (
                <p className="alrateline">
                  <Markup html={I.star} /> <b>{score.rating.toFixed(1)}</b> · <button type="button" className="alunder" onClick={() => jump("al-reviews")}>{reviewsLine(score.reviews)}</button>
                </p>
            ) : null}
            </section>

            {topRatedHere ? (
              <button type="button" className="alfav" onClick={() => jump("al-reviews")}>
                <span className="alfavbadge">
                  <span className="allaurel"><Markup html={I.laurelL} /></span>
                  <b>Top<br />rated</b>
                  <span className="allaurel flip"><Markup html={I.laurelL} /></span>
                </span>
                <span className="alfavtext">One of the highest-rated {typeName.toLowerCase()} listings on Outset, from public reviews</span>
                <span className="alfavnum">
                  <b>{score!.rating.toFixed(1)}</b>
                  <span className="alfavstars" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <Markup key={i} html={I.star} />)}</span>
                </span>
                <span className="alfavsep" aria-hidden="true" />
                <span className="alfavnum">
                  <b>{fmtReviews(score!.reviews)}</b>
                  <u>Reviews</u>
                </span>
              </button>
            ) : null}

            <section className={"alsec alhost" + (topRatedHere ? " tight" : "")}>
              <span className="alavatar" aria-hidden="true">{initial}</span>
              <span>
                <b>Run by {item.title}</b>
                {/* Whether a shop has claimed its page is ours to know, not the guest's: this line describes how a
                    booking reaches them, which reads the same either way, so no listing looks second class. */}
                <small>{instant ? "Instant confirmation" : visit ? "Tickets are sold by the business" : "Requests go straight to the business"}</small>
              </span>
              </section>

            {highlightRows.length ? (
              <section className="alsec alhigh">
                {highlightRows.map((r) => (
                  <div className="alhighrow" key={r.title}>
                    <Markup html={r.icon} />
                <span>
                      <b>{r.title}</b>
                      <small>{r.text}</small>
                </span>
                  </div>
                ))}
              </section>
            ) : null}

            {blurb || highlights.length ? (
              <section className="alsec aldesc">
                {/* The preview is the description alone, or the highlights when there is no description. Showing both
                    under one height cap left a "Highlights" heading stranded above "Show more" with its list cut off. */}
                <div className="aldesctext" ref={descRef}>
                  {blurb ? <p>{blurb}</p> : (
                    <>
                      <p><b>Highlights</b></p>
                      <ul>{highlights.map((h) => <li key={h}>{tidyLine(h)}</li>)}</ul>
                    </>
                  )}
                    </div>
                {descOver || (blurb && highlights.length) ? <MoreLink onClick={() => setModal("desc")}>Show more</MoreLink> : null}
                {guide ? (
                  <p className="aldescguide">
                    <MoreLink onClick={() => setModal("guide")}>What {KIND[item.art] || "this"} is actually like</MoreLink>
                  </p>
              ) : null}
              </section>
            ) : guide ? (
              <section className="alsec aldesc">
                <MoreLink onClick={() => setModal("guide")}>What {KIND[item.art] || "this"} is actually like</MoreLink>
              </section>
            ) : null}

            {services.length ? (
              <section className="alsec">
                <h2>What you can book</h2>
                <div className="alsvcs">
                  {services.map((svc, svcIdx) => {
                    const desc = svc.desc ? cleanDesc(svc.desc).replace(/\(\s+/g, "(").replace(/\s+\)/g, ")") : "";
                    const long = desc.length > 140;
                    const on = svc.variants.some((v) => v.optionIdx === optionIdx);
                    return (
                      <div className={"alsvc" + (on ? " on" : "")} key={svc.name + "|" + svcIdx}>
                        {svc.photo ? (
                          <div className="alsvcpic">
                            <img src={thumb(svc.photo, "wide")} srcSet={srcSet(svc.photo, "wide")} sizes="(max-width: 1127px) 520px, 320px" alt={tidyName(svc.name)} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = "none")} />
                          </div>
                        ) : null}
                        <b className="alsvcname">{tidyName(svc.name)}</b>
                        <ExplainLine explain={svc.explain} className="alsvcexplain" />
                        {desc ? (
                          <p className="alsvcdesc">
                            {openSvc === svc.name || !long ? desc : desc.slice(0, 140).replace(/\s+\S*$/, "") + "…"}
                            {long ? <> <button type="button" className="alunder" onClick={() => setOpenSvc(openSvc === svc.name ? null : svc.name)}>{openSvc === svc.name ? "Show less" : "Show more"}</button></> : null}
                          </p>
                        ) : null}
                        <div className="alvariants">
                          {(() => {
                            const key = svc.name + "|" + svcIdx;
                            const { shown, hidden } = splitVariants(svc.variants, optionIdx, moreSvc.includes(key));
                            const single = isStandardOnly(svc);
                            return (
                              <>
                                {shown.map((v) => {
                                  const note = variantNote(v.explain, v.label);
                                  const length = single ? optionLength(item, v.optionIdx) : null;
                                  return (
                                    <button key={v.optionIdx} type="button" className={"alvariant" + (single ? " single" : "")} aria-pressed={optionIdx === v.optionIdx} onClick={() => setOptionIdx(v.optionIdx)} aria-label={single ? tidyName(svc.name) : undefined}>
                                      <span className="alradio" aria-hidden="true" />
                                      <span className="alvarlabel">
                                        {single ? (length || "") : tidyLength(v.label)}
                                        {note ? <small className="alvarnote">{note}</small> : null}
                                      </span>
                                      {hasPrice(v.price) ? <b>{priceWith(v.price, v.per)}</b> : <em className="alask">Price on request</em>}
                                    </button>
                                  );
                                })}
                                {hidden ? (
                                  <button type="button" className="almoreopts" aria-expanded="false" onClick={() => setMoreSvc((c) => [...c, key])}>
                                    More options ({hidden})
                                  </button>
                                ) : moreSvc.includes(key) && svc.variants.some((v) => v.moreOptions) ? (
                                  <button type="button" className="almoreopts" aria-expanded="true" onClick={() => setMoreSvc((c) => c.filter((k) => k !== key))}>
                                    Fewer options
                          </button>
                        ) : null}
                              </>
                            );
                          })()}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </section>
            ) : item.options.length ? (
              <section className="alsec">
                <h2>What you can book</h2>
                <div className="alvariants list">
                  {item.options.map((o, i) => (
                    <button key={o.name + i} type="button" className="alvariant" aria-pressed={optionIdx === i} onClick={() => setOptionIdx(i)}>
                      <span className="alradio" aria-hidden="true" />
                      <span>{tidyName(o.name)}{o.detail ? " · " + tidyLength(o.detail) : ""}</span>
                      {hasPrice(o.price) ? <b>{priceWith(o.price, o.per)}</b> : <em className="alask">Price on request</em>}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {item.addons && item.addons.length ? (
              <section className="alsec">
                <h2>Add-ons</h2>
                <div className="alvariants list">
                  {item.addons.map((a, i) => (
                    <button key={a.name} type="button" className="alvariant check" aria-pressed={addonIdx.includes(i)} onClick={() => setAddonIdx((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))}>
                      <span className="alcheck" aria-hidden="true"><Markup html={ICONS.check} /></span>
                      <span>{a.name}</span>
                      <b>{addonPrice(a) ? "+" + money(addonPrice(a)) : "Free"}</b>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {allIncluded.length ? (
              <section className="alsec" id="al-included">
                    <h2>What's included</h2>
                <div className="alamen">
                  {allIncluded.slice(0, 10).map(({ t, no, strike }) => (
                    <div className={"alamenrow" + (no ? " no" : "") + (no && !strike ? " sentence" : "")} key={(no ? "n" : "y") + t}>
                      <span className="alamenicon"><Markup html={amenityIcon(t)} /></span>
                      <span>{no && strike ? <span className="vh">Not included: </span> : null}{t}</span>
                  </div>
                  ))}
                  </div>
                {allIncluded.length > 10 ? (
                  <button type="button" className="aloutline" onClick={() => setModal("included")}>Show all {allIncluded.length} items</button>
                ) : null}
              </section>
            ) : null}

            {item.promos?.length ? (
              <section className="alsec" id="deals">
                <h2>Deals</h2>
                <p className="alsecsub">From {possessive(item.title)} own site. Days are in their local time.</p>
                <ul className="aldeals">
                  {item.promos.map((pr, prIdx) => {
                    const on = dealsNow.includes(pr);
                    const d = dealShown(pr);
                    return (
                      <li key={d.title + "|" + prIdx} className={on ? "on" : ""}>
                        <span className="alamenicon"><Markup html={I.tag} /></span>
                        <span className="aldealbody">
                          <b className="aldealtitle">{d.title}{on ? <em>Today</em> : null}</b>
                          {d.detail ? <span className="aldealdetail">{d.detail}</span> : null}
                          {d.code || d.when ? (
                            <span className="aldealmeta">
                              {d.code ? <span className="aldealcode">Code: <b>{d.code}</b></span> : null}
                              {d.when ? <small>{d.when}</small> : null}
                            </span>
              ) : null}
                          {d.date ? (
                            <span className="aldealdays"><i className={"hit" + (on ? " today" : "")}>{d.date}</i></span>
                          ) : (
                            <span className="aldealdays" role="img" aria-label={dayLabel(d.days)}>
                              {d.days.length ? DAY_SHORT.map((dn, i) => (
                                <i key={dn} className={d.days.includes(i) ? (i === today ? "hit today" : "hit") : ""}>{dn}</i>
                              )) : <i className={"hit" + (on ? " today" : "")}>Every day</i>}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
            </section>
            ) : null}

            {!visit ? (
              <section className="alsec" id="al-dates">
                <h2>{day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h2>
                <p className="alsecsub">
                  {chipsToday.length
                    ? chipsToday.length + (chipsToday.length === 1 ? " start time" : " start times") + (live ? " from their live calendar" : "") + (time ? " · " + fmtTime(time) + " picked" : "")
                    : emptyNote}
                </p>
                <MonthPair dates={dates} dateIdx={state.dateIdx} onPickDate={setDate} chipsFor={chipsFor} />
                <div className="alcalfoot">
                  <span>{live ? "Live times from " + possessive(item.title) + " own booking calendar." : "Days with start times are shown in black."}</span>
                  {!done ? <button type="button" className="alunder strong" onClick={() => { jump("al-cols"); window.setTimeout(() => setPickerOpen(true), 400); }}>{time ? "Change time" : "Choose a time"}</button> : null}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="alaside">
            {visit ? (
              // A place you walk into: a zoo, a museum, a show. Hours and the door, not a time slot.
              <div className="alreserve">
                <div className="alreservehead">
                  <span className="alprice"><b>Plan your visit</b></span>
                  {score ? <span className="alreserverate"><Markup html={I.star} /> {score.rating.toFixed(1)} · <u>{reviewsLine(score.reviews)}</u></span> : null}
                    </div>
                <div className="albox">
                  <div className="alboxcell static">
                    <small>Hours</small>
                    {visitWeek?.some((d) => d && d.close > d.open) ? (
                      <ul className="alhours">{visitWeek.map((d, i) => <li key={i}><span>{DAYS[i]}</span><span>{d && d.close > d.open ? clock(d.open) + " to " + clock(d.close) : "Closed"}</span></li>)}</ul>
                    ) : hours.length ? (
                      <ul className="alhours">{hours.slice(0, 7).map((h) => <li key={h}><span>{h}</span></li>)}</ul>
                    ) : (
                      <span className="alboxval muted">Call the business for hours.</span>
                    )}
                </div>
                  </div>
                {ticketHref ? (
                  <a className="alprimary" href={ticketHref} target="_blank" rel="noreferrer">Get tickets</a>
                ) : callHref ? (
                  <a className="alprimary" href={callHref}>Call to plan</a>
                ) : null}
                <p className="alfine">Tickets are sold by {item.title}. Prices and times on their side.</p>
              </div>
            ) : paused ? (
              <div className="alreserve aldone alpaused">
                <span className="aldonemark"><Markup html={I.calendar} /></span>
                <h3>{item.offline ? "This listing is hidden right now" : "Not taking bookings right now"}</h3>
                <p>{item.offline ? item.title + " has taken this page down for the moment." : item.title + " has paused new bookings. Check back soon."}</p>
                <button type="button" className="alprimary" onClick={onClose}>Find another experience</button>
              </div>
            ) : done ? (
              <div className="alreserve aldone">
                <span className="aldonemark"><Markup html={ICONS.checkbig} /></span>
                <h3>{instant ? "You're booked" : "Request sent"}</h3>
                <p>{fmtDate(day)} · {time ? fmtTime(time) : ""} · {qty} {qty === 1 ? "guest" : "guests"}</p>
                <p>{picked ? tidyName(picked.name) + (picked.detail ? " · " + tidyLength(picked.detail) : "") : item.title}</p>
                <button type="button" className="alprimary" onClick={onClose}>Find another experience</button>
              </div>
            ) : (
              <div className="alreserve">
                <div className="alreservehead">
                  {priceTag}
                  {score ? <span className="alreserverate"><Markup html={I.star} /> {score.rating.toFixed(1)} · <u>{reviewsLine(score.reviews)}</u></span> : null}
                </div>

                <div className="alboxwrap" ref={popRef}>
                  <div className="albox">
                    {needService && item.options.length > 1 ? (
                      <div className="alboxcell full sel alopt" ref={optRef}>
                        <button type="button" className="aloptbtn" onClick={() => setOptOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={optOpen}>
                          <small>{optGroups.length > 1 ? "Experience" : "Option"}</small>
                          <span className="alboxval">
                            {pickedRow ? (optGroups.length > 1 && pickedGroup!.name !== "Other options" && pickedGroup!.name !== pickedRow.label ? pickedGroup!.name + " · " : "") + pickedRow.label : "Choose one"}
                          </span>
                          <Markup className="alselchev" html={I.chevDown} />
                        </button>
                        {optOpen ? (
                          <div className="aloptpop" role="listbox" aria-label="What you're booking">
                            {optGroups.length > 1 || optKinds(optGroups).length > 1 ? (
                              <div className="aloptchips" role="group" aria-label="Filter options">
                                {[{ id: "all", label: "All" }, ...(optGroups.length > 1 && optGroups.length <= 5 ? optGroups.filter((g) => g.name !== "Other options").map((g) => ({ id: "g:" + g.name, label: g.name })) : []), ...(optKinds(optGroups).length > 1 ? optKinds(optGroups).map((k) => ({ id: "k:" + k, label: k })) : [])].map((c) => (
                                  <button type="button" key={c.id} className="aloptchip" aria-pressed={optFilter === c.id} onClick={() => setOptFilter(c.id)}>{c.label}</button>
                      ))}
                  </div>
                            ) : null}
                            {optGroups
                              .filter((g) => !optFilter.startsWith("g:") || "g:" + g.name === optFilter)
                              .map((g) => {
                                const rows = g.rows.filter((r) => !optFilter.startsWith("k:") || "k:" + r.kind === optFilter);
                                if (!rows.length) return null;
                                return (
                                  <div className="aloptgroup" key={g.name}>
                                    {optGroups.length > 1 ? <div className="aloptghead">{g.name}</div> : null}
                                    {rows.map((r) => (
                                      <button type="button" role="option" key={r.idx} aria-selected={r.idx === optionIdx} className="aloptrow" onClick={() => { setOptionIdx(r.idx); setOptOpen(false); }}>
                                        <span className="aloptmain">
                                          <span>{r.label}</span>
                                          {r.sub ? <small>{r.sub}</small> : null}
                                        </span>
                                        {hasPrice(r.price) ? <b>{priceWith(r.price, r.per)}</b> : <em className="alask">Price on request</em>}
                                      </button>
                                    ))}
                                  </div>
                                );
                              })}
                </div>
              ) : null}
                      </div>
                ) : null}
                    <div className="alboxrow">
                      <button type="button" className={"alboxcell" + (pickerOpen ? " active" : "")} onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}>
                        <small>Date</small>
                        <span className="alboxval">{fmtDate(day)}</span>
                      </button>
                      <button type="button" className={"alboxcell" + (pickerOpen ? " active" : "")} onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}>
                        <small>Start time</small>
                        <span className={"alboxval" + (time ? "" : " muted")}>{time ? fmtTime(time) : "Add time"}</span>
                      </button>
                    </div>
                    <div className="alboxcell full guests">
                      <span>
                        {/* A stepper that stops names the limit that stopped it, in the label the cell already
                            has, so a guest is not left pressing a dead "+". */}
                        <small>{guestCap != null ? "Guests · up to " + guestCap : "Guests"}</small>
                        <span className="alboxval">{qty} {qty === 1 ? "guest" : "guests"}</span>
                      </span>
                      <span className="alstep">
                        <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} disabled={qty <= 1} aria-label="Fewer guests">−</button>
                        <button type="button" onClick={() => setQty(Math.min(maxGuests, qty + 1))} disabled={qty >= maxGuests} aria-label="More guests">+</button>
                      </span>
                    </div>
                  </div>
                  {pickerOpen ? (
                    <div className="alpop" role="dialog" aria-label="Date and start time">
                      <div className="alpophead">
                        <span>
                          <b>{time ? fmtDate(day) + " · " + fmtTime(time) : "Pick a date and start time"}</b>
                          <small>{live ? "Live from their booking calendar" : duration ? duration : "Times shown in the business's local time"}</small>
                        </span>
                      </div>
                      <DayTimePicker
                        dates={dates}
                        dateIdx={state.dateIdx}
                        onPickDate={setDate}
                        chipsFor={chipsFor}
                        time={time}
                        onPickTime={(c) => { setTime(c.time); setPickerOpen(false); }}
                        emptyNote={emptyNote}
                        sourceNote={live ? "Live times from " + possessive(item.title) + " own booking calendar." : undefined}
                      />
                      <div className="alpopfoot">
                        <button type="button" className="alunder strong" onClick={() => setTime(null)} disabled={!time}>Clear time</button>
                        <button type="button" className="aldark" onClick={() => setPickerOpen(false)}>Close</button>
                      </div>
                    </div>
            ) : null}
                </div>

                <div className="albox alform">
                  <div className="alboxrow">
                    <label className="alboxcell">
                      <small>Name</small>
                      <input ref={nameRef} value={guest.name} placeholder="Your name" autoComplete="name" onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
                    </label>
                    <label className="alboxcell">
                      <small>Mobile</small>
                      <input ref={phoneRef} value={guest.phone} placeholder="Mobile number" inputMode="tel" autoComplete="tel" onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
                    </label>
                  </div>
                  <label className="alboxcell full">
                    <small>Email</small>
                    <input value={guest.email || ""} placeholder="Where your confirmation goes" inputMode="email" autoComplete="email" onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
                  </label>
                </div>
                {/* Only the name and the mobile are required, and email is the one channel that is built, so a
                    guest who skips it hears nothing: not the confirmation, not a decline, not a cancellation. */}
                {!(guest.email || "").trim() ? <p className="alfine">Leave it empty and we have no way to tell you when {item.title} answers.</p> : null}

                <button type="button" ref={reserveRef} className="alprimary" onClick={pressReserve} aria-disabled={!ready || sending} aria-busy={sending}>
                  {sending ? "Sending…" : ready ? ctaLabel + (p.total ? " · " + money(p.total) : "") : time == null ? "Pick a time" : "Add your name and number"}
                      </button>
                {bookError ? <p className="alfine center albookerror" role="alert">{bookError}</p> : null}
                {payments && p.total ? (
                  <p className="alfine center">Secure card payment. Your card is held and only charged once the booking is confirmed.</p>
                ) : (
                  <p className="alfine center">You won't be charged yet</p>
                )}

                {p.base && picked ? (
                  <div className="allines">
                    <div className="alline">
                      <u>{perPerson(picked) && picked.price != null ? money(picked.price) + " × " + qty + (qty === 1 ? " guest" : " guests") : tidyName(picked.name)}</u>
                      <span>{money(p.base)}</span>
                    </div>
                    {extras.map((a) => <div className="alline" key={a.name}><u>{a.name}</u><span>{money(addonPrice(a))}</span></div>)}
                    {p.fee ? <div className="alline"><u>{serviceFeeLabel(p)}</u><span>{money(p.fee)}</span></div> : null}
                    <div className="alline total"><span>Total</span><span>{p.total ? money(p.total) : "Pay on site"}</span></div>
                </div>
                ) : (
                  <div className="allines">
                    {extras.map((a) => <div className="alline" key={a.name}><u>{a.name}</u><span>{money(addonPrice(a))}</span></div>)}
                    <div className="alline total"><span>Total</span><span>{p.total ? money(p.total) : "Pay on site"}</span></div>
                  </div>
                )}
                <p className="alfine">
                  {instant ? "Instant confirmation. " : (guest.email || "").trim() ? "The operator confirms by email. " : "The operator confirms your request. "}
                  {cancel ? cancel + "." : item.cancellation ? "Cancellation terms are set by " + item.title + ", see the policy below." : "Cancellation terms are set by the operator."}
                </p>
              </div>
            )}
          </aside>
        </div>

            {(item.ytVideos && item.ytVideos.length) || item.tiktok ? (
          <section className="alwide">
                <h2>See it in action</h2>
            <p className="alsecsub">Videos from {possessive(item.title)} own channels.</p>
                {item.ytVideos && item.ytVideos.length ? (
              <div className={"alvideos" + (item.ytVideos.length === 1 ? " one" : "")}>
                    {item.ytVideos.slice(0, 2).map((v) => (
                  <div className="alvideo" key={v.id}>
                        <iframe
                          src={"https://www.youtube-nocookie.com/embed/" + v.id + "?rel=0&modestbranding=1"}
                          title={v.title}
                          loading="lazy"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                        <small>{v.title}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
                {item.tiktok ? (
              <div className="altiktok">
                    <blockquote className="tiktok-embed" cite={"https://www.tiktok.com/@" + item.tiktok} data-unique-id={item.tiktok} data-embed-type="creator" style={{ maxWidth: 780, minWidth: 288 }}>
                      <section>
                        <a target="_blank" rel="noreferrer" href={"https://www.tiktok.com/@" + item.tiktok}>@{item.tiktok} on TikTok</a>
                      </section>
                    </blockquote>
                    <TikTokScript />
                  </div>
                ) : null}
              </section>
            ) : null}

        {score || reviews.length ? (
          <section className="alwide" id="al-reviews">
            {topRatedHere ? (
              <div className="alfavbig">
                <span className="alfavbignum">
                  <span className="allaurel big"><Markup html={I.laurelL} /></span>
                  <b>{score!.rating.toFixed(1)}</b>
                  <span className="allaurel big flip"><Markup html={I.laurelL} /></span>
                    </span>
                <b className="alfavbigtitle">Top rated</b>
                <p>One of the most loved {typeName.toLowerCase()} listings on Outset, based on {reviewsLine(score!.reviews, "public")}</p>
                  </div>
            ) : score ? (
              <h2 className="alreviewshead"><Markup html={I.star} /> {score.rating.toFixed(1)} · {reviewsLine(score.reviews)}</h2>
            ) : (
              <h2>What guests say</h2>
            )}
            {reviews.length ? (
              <>
                <div className="alreviewgrid">
                  {reviews.map((r) => <ReviewCard key={r.key} r={r} />)}
                  </div>
                <p className="alsecsub">Reviews the operator publishes on their own site.</p>
              </>
                ) : null}
              </section>
            ) : null}

        <section className="alwide" id="al-location">
          <h2>Where you'll be</h2>
          <p className="alsecsub dark">{placeName(item.area)}{metro && !item.area.includes(metro.name) ? " · " + metro.name + " area" : ""}</p>
          <div className="alwhere">
            <a className="alwherecard" href={contact ? mapsHref(contact, item.title + " " + item.area) : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(item.title + " " + item.area)} target="_blank" rel="noreferrer">
              <span className="alwherepin"><Markup html={I.pin} /></span>
              <span>
                <small>{item.meetingPoint ? "Meeting point" : "Address"}</small>
                <b>{item.meetingPoint ? tidyLine(item.meetingPoint) : address || item.area}</b>
                {item.meetingPoint && address && item.meetingPoint !== address ? <span className="alwhereaddr">{address}</span> : null}
                <u>Open in Maps</u>
              </span>
            </a>
            <div className="alwhereside">
              {callHref && contact?.phone ? (
                <a className="alwhererow" href={callHref}>
                  <Markup html={I.phone} />
                  <span><b>{fmtPhone(contact.phone)}</b><small>Call a person at the shop</small></span>
                </a>
              ) : null}
              {hours.length ? (
                <div className="alwhererow">
                  <Markup html={I.clock} />
                  <span><b>Hours</b>{hours.map((h) => <small key={h}>{h}</small>)}</span>
              </div>
              ) : null}
              {checkin ? (
                <div className="alwhererow">
                  <Markup html={I.door} />
                  <span><b>When you arrive</b><small>{checkin}</small></span>
                </div>
                ) : null}
                </div>
                </div>
          {item.locations?.length ? (
            <div className="alvenues">
              <h3>{item.locations.length + 1} locations{state.near ? ", nearest to " + state.near.label + " first" : ""}</h3>
              <div className="alvenuegrid">
                {[{ city: item.area, region: regionOfArea(item.area), lat: item.lat, lon: item.lon, street: address || undefined, primary: true }, ...item.locations.map((l) => ({ ...l, region: l.region || regionOfArea(item.area), city: venueLabel({ city: l.city, region: l.region }), primary: false }))]
                  .map((v) => ({ ...v, km: state.near && v.lat != null && v.lon != null ? kmBetween(state.near, { lat: v.lat, lon: v.lon }) : null }))
                  .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity))
                  .slice(0, 24)
                  .map((v, i) => {
                    // A venue the crawl found as a bare pin has no town and no street. It is still one of this
                    // chain's places and still measurable, so it says that much, and its map link goes to the
                    // coordinates rather than searching for a town by whatever name we invented.
                    const title = v.city || v.street || "Another location";
                    // A chain can straddle the border, so each venue is measured in its own country's units and
                    // falls back to the listing's when the crawl never read its province or state.
                    const line = [v.street && v.street !== title ? v.street : v.primary ? "Main location" : "", v.km != null ? fmtDistance(v.km, countryOfRegion(v.region)) + " away" : ""].filter(Boolean).join(" · ");
                    const query = [v.street, v.city].filter(Boolean).join(", ") || v.lat + "," + v.lon;
                    return (
                      <a key={i} className="alvenue" href={"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query)} target="_blank" rel="noreferrer">
                        <b>{title}</b>
                        <small>{line}</small>
                      </a>
                    );
                  })}
                </div>
            </div>
                ) : null}
        </section>

        <section className="alwide" id="al-business">
          <h2>About the business</h2>
          <div className="albiz">
            <div className="albizleft">
              <div className="albizcard">
                <div className="albizwho">
                  <span className="alavatar lg" aria-hidden="true">{initial}</span>
                  <b>{item.title}</b>
                  <small>{typeName}</small>
                </div>
                <div className={"albizstats" + (score || item.locations?.length || bookableCount ? "" : " empty")}>
                  {score ? (
                    <>
                      <span><b>{fmtReviews(score.reviews)}</b><small>Reviews</small></span>
                      <span><b>{score.rating.toFixed(1)} <Markup html={I.star} /></b><small>Rating</small></span>
                    </>
                  ) : null}
                  {item.locations?.length ? <span><b>{item.locations.length + 1}</b><small>Locations</small></span> : null}
                  {/* Every stat is a number, as on Airbnb's host card: a word like "Request" set at a number's size read
                      as a different, larger font. How booking works is already in the list beside the card. */}
                  {bookableCount ? <span><b>{bookableCount}</b><small>{bookableCount === 1 ? "Experience" : "Experiences"}</small></span> : null}
                </div>
              </div>
              <ul className="albizfacts">
                <li><Markup html={I.pin} /> <span>{placeName(item.area)}</span></li>
                {duration ? <li><Markup html={I.clock} /> <span>{duration}</span></li> : null}
                {instant ? <li><Markup html={I.bolt} /> <span>Instant confirmation</span></li> : visit ? <li><Markup html={I.ticket} /> <span>Tickets on their own site</span></li> : <li><Markup html={I.message} /> <span>Confirms requests by email</span></li>}
              </ul>
            </div>
            <div className="albizright">
              <h3>Questions before you book?</h3>
              {/* The operator's Assistant switch. Off means this shop answers guests itself, so the agent goes
                  and the phone number, which sits under it as a second option, becomes the first one. The phone
                  listing has honoured this switch all along; the desktop one stopped when its Otto panel became
                  an Ask Outset button, and offered the shop's own information back to a guest either way. */}
              {assistantOn(item) ? (
                <>
                  <p className="alsecsub">Ask Outset reads {possessive(item.title)} own published information, and can check live availability while you wait.</p>
                  <button type="button" className="aloutline" onClick={() => openAsk("What should I know about " + item.title + " before booking?")}>
                    Ask Outset about {item.title}
                  </button>
                </>
              ) : (
                <p className="alsecsub">{item.title} answers these themselves. {callHref ? "Give them a call, or send" : "Send"} a booking request on this page and it reaches them directly.</p>
              )}
              {callHref ? <a className="aloutline" href={callHref}>Call the business</a> : null}
              {/* On every listing, claimed or not, and worded for an owner rather than about the page's status:
                  "Claim this listing" only appeared on unclaimed ones, which told a guest which shops had not
                  signed up. An owner who is already signed in lands in their dashboard from the same link. */}
              <p className="alclaim">
                <Markup html={I.shield} />
                <span>Work here? <button type="button" className="alunder strong" onClick={() => openOperator(item.id)}>Manage this listing</button> to answer guests and take bookings directly.</span>
                </p>
              </div>
        </div>
        </section>

        {knowCols.length ? (
          <section className="alwide">
            <h2>Things to know</h2>
            <div className={"alknow c" + knowCols.length}>
              {knowCols.map((c) => (
                <div key={c.key} className="alknowcol">
                  <span className="alknowicon"><Markup html={c.icon} /></span>
                  <b>{c.title}</b>
                  <ul>{c.lines.slice(0, 3).map((l, i) => <li key={i}>{tidyLine(l)}</li>)}</ul>
                  {c.lines.length > 3 || c.lines.some((l) => l.length > 90) || (c.key === "safety" && item.waiverUrl) ? <MoreLink onClick={() => setModal("know-" + c.key)}>Show more</MoreLink> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {item.faq?.length ? (
          <section className="alwide">
            <h2>Frequently asked questions</h2>
            <div className="alfaq">
              {item.faq.map((f, i) => (
                <div key={i} className={"alfaqitem" + (openFaq === i ? " open" : "")}>
                  <button type="button" onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}>
                    <span>{tidyLine(f.q)}</span>
                    <Markup html={I.chevDown} />
                  </button>
                  {openFaq === i ? <p>{tidyLine(f.a)}</p> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {similar.length ? (
          <section className="alwide alrail">
            <div className="alrailhead">
              <h2>More like this{metro && similarNear ? " near " + metro.name : ""}</h2>
              <span className="alrailnav">
                <button type="button" className="alround bordered" onClick={() => railBy(-1)} aria-label="Scroll back"><Markup html={I.chevLeft} /></button>
                <button type="button" className="alround bordered" onClick={() => railBy(1)} aria-label="Scroll forward"><Markup html={I.chevRight} /></button>
              </span>
            </div>
            <div className="alrailrow" ref={railRef}>{similar.map((u) => <Card key={u.id} u={u} onOpen={onOpen} />)}</div>
          </section>
        ) : null}
      </div>

      {flash ? <div className="alflash" role="status">{flash}</div> : null}

      {modal === "desc" ? (
        <Modal label="About this experience" onClose={() => setModal(null)}>
          <h2 className="almodaltitle">About this experience</h2>
          {blurb ? <p className="almodaltext">{blurb}</p> : null}
          {highlights.length ? (
            <>
              <h3 className="almodalsub">Highlights</h3>
              <ul className="almodallist">{highlights.map((h) => <li key={h}>{tidyLine(h)}</li>)}</ul>
            </>
          ) : null}
        </Modal>
      ) : null}

      {modal === "guide" && guide ? (
        <Modal label="What it's like" onClose={() => setModal(null)}>
          <h2 className="almodaltitle">What {KIND[item.art] || "this"} is actually like</h2>
          {guide.time ? <p className="alsecsub">{guide.time}</p> : null}
          {guide.steps.length ? (
            <ol className="alsteps">
              {guide.steps.map((s, i) => (
                <li key={i}><span className="n">{i + 1}</span><span>{s}</span></li>
              ))}
            </ol>
          ) : null}
          {guide.bring.length ? (
            <>
              <h3 className="almodalsub">Bring</h3>
              <ul className="almodallist">{guide.bring.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </>
          ) : null}
          {guide.goodFor ? (
            <>
              <h3 className="almodalsub">Good for</h3>
              <p className="almodaltext">{guide.goodFor}</p>
            </>
          ) : null}
          {guide.nerves ? (
            <>
              <h3 className="almodalsub">Nervous?</h3>
              <p className="almodaltext">{guide.nerves}</p>
            </>
          ) : null}
        </Modal>
      ) : null}

      {modal === "included" ? (
        <Modal label="What's included" onClose={() => setModal(null)}>
          <h2 className="almodaltitle">What's included</h2>
          {includes.length ? (
            <>
              <h3 className="almodalsub">Included</h3>
              <div className="alamenlist">
                {includes.map((t) => (
                  <div className="alamenrow" key={t}><span className="alamenicon"><Markup html={amenityIcon(t)} /></span><span>{t}</span></div>
                ))}
              </div>
            </>
          ) : null}
          {notIncluded.length ? (
            <>
              <h3 className="almodalsub">Not included</h3>
              <div className="alamenlist">
                {notIncluded.map((n) => (
                  <div className={"alamenrow no" + (n.strike ? "" : " sentence")} key={n.text}><span className="alamenicon"><Markup html={amenityIcon(n.text)} /></span><span>{n.strike ? <span className="vh">Not included: </span> : null}{n.text}</span></div>
                ))}
              </div>
            </>
          ) : null}
        </Modal>
      ) : null}

      {knowModal ? (
        <Modal label={knowModal.title} onClose={() => setModal(null)}>
          <h2 className="almodaltitle">{knowModal.title}</h2>
          {knowModal.key === "rules" ? (
            <>
              {requirements.length ? <><ul className="almodallist">{requirements.map((l) => <li key={l}>{tidyLine(l)}</li>)}</ul></> : null}
              {item.bring?.length ? <><h3 className="almodalsub">What to bring</h3><ul className="almodallist">{item.bring.map((l) => <li key={l}>{tidyLine(l)}</li>)}</ul></> : null}
              {item.groupInfo?.length ? <><h3 className="almodalsub">Groups</h3><ul className="almodallist">{item.groupInfo.map((l) => <li key={l}>{tidyLine(l)}</li>)}</ul></> : null}
            </>
          ) : knowModal.key === "safety" ? (
            <>
              {age ? <p className="almodaltext">Minimum age {age}.</p> : null}
              {waiverLines.length ? <><h3 className="almodalsub">Waiver and check-in</h3><ul className="almodallist">{waiverLines.map((l) => <li key={l}>{tidyLine(l)}</li>)}</ul></> : null}
              {safeHttpUrl(item.waiverUrl) ? (
                <a className="alwaiver" href={safeHttpUrl(item.waiverUrl)} target="_blank" rel="noreferrer">
                  <Markup html={I.ticket} />
                  <span><b>Sign the waiver online before you arrive</b><small>Saves time at check-in. Opens the operator's waiver form.</small></span>
                </a>
              ) : null}
            </>
          ) : (
            <>
              {cancel ? <h3 className="almodalsub">{cancel}</h3> : null}
              {cancelFull ? <p className="almodaltext">{cancelFull}</p> : null}
              {cancelLines.some((l) => l !== cancel && l !== cancelFull) ? (
                <ul className="almodallist">{cancelLines.filter((l) => l !== cancel && l !== cancelFull).map((l) => <li key={l}>{l}</li>)}</ul>
              ) : cancelLines.length ? null : (
                <p className="almodaltext muted">Contact {item.title} for their cancellation terms before you book.</p>
              )}
              {otherPolicies.length ? <><h3 className="almodalsub">Other policies</h3><ul className="almodallist">{otherPolicies.map((l) => <li key={l}>{tidyLine(l)}</li>)}</ul></> : null}
            </>
          )}
        </Modal>
      ) : null}
    </div>
  );
}

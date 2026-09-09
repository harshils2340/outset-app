import { CONTACTS } from "../data/contacts";
import { UNCLAIMED } from "../data/unclaimed";
import type { OperatorContact, Unclaimed, UnclaimedOption } from "../data/types";
import type { GeoPoint } from "./geo";

export function siteUrl(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return "https://" + src;
}

/* ---------- catalog registry ---------- */

let base: Unclaimed[] = UNCLAIMED;
let catalog: Unclaimed[] = UNCLAIMED;
let byId = new Map<string, Unclaimed>(UNCLAIMED.map((u) => [u.id, u]));
let contacts: Record<string, OperatorContact> = { ...CONTACTS };

/** Edits made by claimed operators in their dashboard, layered over the scraped record. */
const overrides = new Map<string, Partial<Unclaimed>>();
/** Operators who switched their listing off. Still resolvable by id, hidden from every list. */
const unpublished = new Set<string>();

function rebuild(): void {
  const patched = overrides.size ? base.map((u) => (overrides.has(u.id) ? { ...u, ...overrides.get(u.id) } : u)) : base;
  byId = new Map(patched.map((u) => [u.id, u]));
  catalog = unpublished.size ? patched.filter((u) => !unpublished.has(u.id)) : patched;
}

/**
 * Layer an operator's dashboard edits over their catalog record. Pass null to drop the override.
 * published=false pulls the listing from rails and search while keeping it reachable by id.
 */
export function setOperatorOverride(id: string, patch: Partial<Unclaimed> | null, published: boolean): void {
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

function domainOf(src: string): string {
  return src.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
}

/** Merge generated operators in. Seeds keep priority: same domain or id in the seed list is skipped. */
export function mergeCatalog(items: Unclaimed[], extraContacts: Record<string, OperatorContact>): number {
  const seenDomain = new Set(UNCLAIMED.map((u) => domainOf(u.src)));
  const seenId = new Set(UNCLAIMED.map((u) => u.id));
  const added: Unclaimed[] = [];
  for (const it of items) {
    const d = domainOf(it.src);
    if (seenId.has(it.id) || (d && !d.startsWith("osm-") && seenDomain.has(d))) continue;
    seenId.add(it.id);
    if (d) seenDomain.add(d);
    added.push(it);
  }
  // Hand-verified seeds keep their facts but borrow everything the crawl found that they lack: photos, videos,
  // grouped services, descriptions, social handles, pins.
  const remoteByDomain = new Map<string, Unclaimed>();
  for (const it of items) {
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
  for (const u of byId.values()) if (u.detail === id) return u;
  return null;
}

export function fromPrice(item: Unclaimed): number | null {
  const priced = item.options.map((o) => o.price).filter((n): n is number => n != null);
  if (!priced.length) return item.from ?? null;
  return Math.min(...priced);
}

/** Swap a lite record for its full detail record. Overrides and publish state stay as they were. */
export function hydrateItem(full: Unclaimed, targetId?: string): void {
  const id = targetId || full.id;
  const idx = base.findIndex((u) => u.id === id);
  if (idx === -1) return;
  const cur = base[idx];
  const handVerified = cur.id !== full.id;
  base = base.slice();
  if (!handVerified) {
    base[idx] = { ...full, lite: false };
  } else {
    // Seeds keep every fact a person checked; the crawl fills only what the seed left empty.
    const merged: Unclaimed = { ...full, ...cur, id: cur.id, lite: false, detail: undefined };
    for (const k of Object.keys(full) as (keyof Unclaimed)[]) {
      const v = cur[k] as unknown;
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) (merged as Record<string, unknown>)[k] = full[k];
    }
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

/**
 * Experiences are priced per person unless the operator's unit says the price covers a thing:
 * a boat, a ski, a kart, a room, a lane, a group, or a block of time on a rental.
 */
export function perPerson(o: UnclaimedOption): boolean {
  const unit = (o.per || "").toLowerCase();
  const text = ((o.name || "") + " " + (o.detail || "")).toLowerCase();
  if (/person|adult|child|kid|senior|youth|guest|rider|passenger|jumper|seat/.test(unit + " " + text)) return true;
  if (/\/(hr|hour|boat|ski|kart|vehicle|room|lane|group|trip|day|half day|half-day|week|session|game)\b/.test(unit)) return false;
  if (/\b(rental|per hour|hourly|half day|full day|all day|\d+\s*(hr|hour|hours|min|minutes))\b/.test(text) && /rental|boat|ski|pontoon|kayak|paddle|bike|kart/.test(text + " " + unit)) return false;
  return true;
}

export function publicRating(item: Unclaimed): { rating: number; reviews: number } | null {
  if (item.rating == null || item.reviews == null || item.reviews < 1) return null;
  return { rating: item.rating, reviews: item.reviews };
}

/** Synced public contact facts for an experience, matched by the operator's domain. */
export function contactFor(item: Unclaimed): OperatorContact | null {
  if (item.contact) return item.contact;
  return contacts[domainOf(item.src)] ?? null;
}

export function fmtPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const n = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (n.length !== 10) return raw;
  return "(" + n.slice(0, 3) + ") " + n.slice(3, 6) + "-" + n.slice(6);
}

export function telHref(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  return "tel:" + (digits.startsWith("+") ? digits : "+1" + digits.replace(/^1/, ""));
}

export function addressLine(c: OperatorContact): string | null {
  const parts = [c.street, [c.city, c.region].filter(Boolean).join(", "), c.postal].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function mapsHref(c: OperatorContact, fallbackName: string): string {
  const q = addressLine(c) || fallbackName;
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}

export function mapsQuery(item: Unclaimed, c: OperatorContact | null): string {
  if (c?.street) {
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

const DAY_NAMES: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun" };

function to12h(t: string): string {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m[2] === "00" ? h12 + suffix : h12 + ":" + m[2] + suffix;
}

/** "Mo-Fr 09:00-20:00" to "Mon-Fri 9am-8pm". Leaves anything it cannot parse as written. */
export function fmtHours(line: string): string {
  const m = line.match(/^([A-Za-z,-]+)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
  if (!m) return line;
  const days = m[1].replace(/Mo|Tu|We|Th|Fr|Sa|Su/g, (d) => DAY_NAMES[d] || d);
  return days + " " + to12h(m[2]) + "-" + to12h(m[3]);
}

/** Guests should never have to know the jargon. Expand it where it shows. */
const GLOSSARY: [RegExp, string][] = [
  [/\bSUPs?\b/g, "Stand-up paddleboard"], [/\bPWCs?\b/g, "Personal watercraft"], [/\bATVs?\b/g, "Four-wheeler (ATV)"],
  [/\bUTVs?\b/g, "Side-by-side (UTV)"], [/\bAFF\b/g, "Accelerated Freefall (learn to skydive)"], [/\bHP\b/g, "horsepower"],
  [/\bJet ?Ski\b/gi, "Jet ski"],
  [/\bIFR\b/g, "instrument-rated"], [/\bUSCG\b/g, "Coast Guard"], [/\bPFDs?\b/g, "life jacket"], [/\bBYOB\b/g, "bring your own drinks"],
];

export function plainWords(text: string): string {
  let out = text;
  for (const [re, word] of GLOSSARY) out = out.replace(re, word);
  return out.replace(/\s+/g, " ").trim();
}

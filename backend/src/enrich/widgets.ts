import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { normalizePhone } from "../scrape/run.ts";
import { withDeadline } from "../scrape/fetch.ts";

/**
 * Booking widgets as a free, exact source. FareHarbor and Xola publish each operator's item catalog as JSON
 * with no key: names, headlines, prices, durations, descriptions, photos, cancellation and check-in notes.
 * That is the operator's own live menu, so it outranks anything read from marketing pages.
 * Rows carry confidence 'widget'. Nothing is invented: a field the widget leaves blank stays blank.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 OutsetBot/0.1 (+https://outset.local)";

type Offering = { name: string; detail: string | null; duration: string | null; price: number | null; unit: string; url: string; desc: string | null; photo: string | null; photos: string[] };
type Company = { phone?: string | null; email?: string | null; street?: string | null; city?: string | null; region?: string | null; postal?: string | null; cover?: string | null; videoEmbed?: string | null; waiverUrl?: string | null; cancellation?: string | null; checkin?: string | null; faq?: string | null };
type WidgetResult = { vendor: "fareharbor" | "xola" | "peek"; offerings: Offering[]; company: Company; requirements: string[]; policies: string[]; includes: string[]; pages: number };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Markdown and HTML to plain sentences. */
export function plain(s: unknown): string {
  if (s == null) return "";
  if (typeof s !== "string") {
    if (typeof s === "number") return String(s);
    return "";
  }
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*|__|\*|_{1,2}/g, "")
    .replace(/^[-*•]\s+/gm, "")
    .replace(/_{5,}/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const REQ_RE = /\b(must be|minimum age|ages?\s*\d|\d+\s*(?:\+|and up|or older|years? old)|under \d+|weight limit|max(?:imum)? weight|\d{2,3}\s*(?:lbs?|pounds|kg)|valid (?:driver'?s? )?licen[cs]e|boating licen[cs]e|boater (?:safety )?(?:card|education)|swim|life ?jacket|pregnan|heart condition|adult (?:must|required)|accompanied by|photo id|closed[- ]toe|sober|alcohol|no experience)\b/i;
const POL_RE = /\b(cancel|refund|deposit|reschedul|no[- ]show|weather|rain ?check|late arrival|forfeit|non-?refundable|full payment|gratuit|tip)\b/i;
const INC_RE = /\b(includes?|included|provided|we provide|comes with)\b/i;
const NOISE_RE = /^rates?\b|\(\d{3}\)|\d{3}[-.]\d{3}[-.]\d{4}|call us|contact us|http|@|click|\bwww\b/i;

/** Sentences worth keeping as guest facts, split from any block of copy. */
export function mineSentences(text: string): { requirements: string[]; policies: string[]; includes: string[] } {
  const out = { requirements: [] as string[], policies: [] as string[], includes: [] as string[] };
  const seen = new Set<string>();
  for (const raw of plain(text).split(/(?<=[.!?])\s+(?=[A-Z0-9])/)) {
    const s = raw.trim().replace(/^[^A-Za-z0-9$]+/, "");
    if (s.length < 25 || s.length > 260 || NOISE_RE.test(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    let bucket: keyof typeof out | null = null;
    if (REQ_RE.test(s)) bucket = "requirements";
    else if (POL_RE.test(s)) bucket = "policies";
    else if (INC_RE.test(s)) bucket = "includes";
    if (!bucket || out[bucket].length >= 8) continue;
    seen.add(key);
    out[bucket].push(/[.!?]$/.test(s) ? s : s + ".");
  }
  return out;
}

/** "One Hour Rental $125 Two Hour Rental: $199 Half Day Rental: $349" -> labelled rows. Only distinct labels, only the rates block. */
export function rateRows(text: string): { label: string; price: number }[] {
  const block = (text.match(/\bRates?\b[:\s]*(.{0,600}?)(?=\b(?:Duration|About|Includes?|What to bring|Requirements?|Cancellation|Policy|Please note|Note:)\b|$)/i) || [])[1] || "";
  const out: { label: string; price: number }[] = [];
  const seen = new Set<string>();
  const re = /([A-Z][A-Za-z0-9&\/' -]{2,40}?)\s*[:\-–]?\s*\$\s?(\d{2,4}(?:\.\d{2})?)(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const label = m[1].replace(/\b(Rates?|Price|Prices|Pricing|Starting at|From)\b/gi, "").replace(/\s+/g, " ").trim().replace(/[:\-–]$/, "").trim();
    if (label.length < 3 || /^(per|each|and|or|the)$/i.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: label.slice(0, 60), price: Number(m[2]) });
    if (out.length >= 8) break;
  }
  return out;
}

function money(s: string | null | undefined): number | null {
  const m = (s || "").match(/\$\s?(\d{1,4}(?:[.,]\d{2})?)/);
  return m ? Number(m[1].replace(",", "")) : null;
}

function durationOf(...parts: (string | null | undefined)[]): string | null {
  for (const p of parts) {
    const m = (p || "").match(/\b(\d+(?:\.\d+)?(?:\s*-\s*\d+)?)\s*(hours?|hrs?|minutes?|mins?|days?)\b/i);
    if (m) return m[1] + " " + m[2].toLowerCase().replace(/^hrs?$/, "hours").replace(/^mins?$/, "min");
  }
  return null;
}

function unitOf(headline: string | null | undefined, name: string): string {
  const h = (headline || "") + " " + name;
  if (/per (?:jet ?ski|boat|kayak|vessel|cart|kart|lane|room|group|vehicle|hour|person|adult|guest|rider|player)/i.test(h)) {
    const m = h.match(/per (jet ?ski|boat|kayak|vessel|cart|kart|lane|room|group|vehicle|hour|person|adult|guest|rider|player)/i)![1].toLowerCase();
    if (/person|adult|guest|rider|player/.test(m)) return "each";
    if (m === "hour") return "/hr";
    return "/" + m.replace(/\s+/g, " ");
  }
  return "each";
}

/* ---------- FareHarbor ---------- */

type FhItem = {
  pk: number; name: string; headline: string | null; description: string | null; description_text: string | null; short_description: string | null;
  booking_notes: string | null; cancellation_notes: string | null; is_archived: boolean; is_unlisted: boolean; is_private: boolean;
  images?: { image_cdn_url: string }[]; image_cdn_url: string | null; minimum_initial_party_size: number | null; maximum_initial_party_size: number | null;
};
type FhCompany = {
  phone: string | null; email: string | null; street: string | null; city: string | null; province: string | null; postal_code: string | null;
  image_background_cdn_url: string | null; url_youtube: string | null; smartwaiver_url: string | null; cancellation_notes: string | null;
  booking_notes: string | null; faq: string | null; about: string | null; intro: string | null; summary: string | null;
};

export function fareharborShortname(bookingUrl: string): string | null {
  const m = bookingUrl.match(/fareharbor\.com\/(?:embeds\/book\/)?([a-z0-9-]+)\/?/i);
  if (!m || /^(api|embeds|book|widgets|static)$/i.test(m[1])) return null;
  return m[1];
}

export async function readFareharbor(shortname: string): Promise<WidgetResult | null> {
  const base = "https://fareharbor.com/api/v1/companies/" + encodeURIComponent(shortname) + "/";
  const [co, it] = await Promise.all([getJson<{ company: FhCompany }>(base), getJson<{ items: FhItem[] }>(base + "items/")]);
  if (!co?.company || !it?.items) return null;
  const c = co.company;
  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  for (const item of it.items) {
    if (!item || !item.name || item.is_archived || item.is_unlisted || item.is_private) continue;
    const headline = plain(item.headline);
    const descLong = plain(item.description_text || item.description);
    const desc = [plain(item.short_description) || descLong.slice(0, 600).replace(/\s+\S*$/, ""), headline ? headline.replace(/\s*\|\s*/g, " · ") : ""].filter(Boolean).join(" ").slice(0, 700);
    const photos = (item.images || []).map((i) => i.image_cdn_url).filter(Boolean);
    if (item.image_cdn_url && !photos.includes(item.image_cdn_url)) photos.unshift(item.image_cdn_url);
    const duration = durationOf(headline, descLong);
    const url = "https://fareharbor.com/embeds/book/" + shortname + "/items/" + item.pk + "/";
    const unit = unitOf(headline, item.name);
    const name = String(item.name || "").trim();
    // A rates table in the copy ("One Hour Rental $125 Two Hour Rental: $199 Half Day: $349") becomes one option per row.
    const rates = rateRows(descLong);
    if (rates.length >= 2) {
      for (const r of rates) offerings.push({ name, detail: r.label, duration: durationOf(r.label) || duration, price: r.price, unit, url, desc: desc || null, photo: photos[0] || null, photos });
    } else {
      offerings.push({
        name,
        // The variant label guests pick. The headline is copy, not a label, so it goes into the description.
        detail: duration,
        duration,
        price: money(headline) ?? money(descLong),
        unit,
        url,
        desc: desc || null,
        photo: photos[0] || null,
        photos,
      });
    }
    const mined = mineSentences([descLong, item.booking_notes, item.cancellation_notes].filter(Boolean).join(" "));
    mined.requirements.forEach((s) => req.add(s));
    mined.policies.forEach((s) => pol.add(s));
    mined.includes.forEach((s) => inc.add(s));
    if (item.minimum_initial_party_size && item.minimum_initial_party_size > 1) req.add(`${item.name}: minimum ${item.minimum_initial_party_size} guests per booking.`);
    if (item.maximum_initial_party_size) inc.add(`${item.name}: up to ${item.maximum_initial_party_size} guests per booking.`);
  }
  const coMined = mineSentences([c.cancellation_notes, c.booking_notes, c.faq, c.about, c.intro].filter(Boolean).join(" "));
  coMined.requirements.forEach((s) => req.add(s));
  coMined.policies.forEach((s) => pol.add(s));
  const yt = c.url_youtube && /youtu(?:be\.com\/(?:watch\?v=|embed\/)|\.be\/)([A-Za-z0-9_-]{6,})/.exec(c.url_youtube);
  return {
    vendor: "fareharbor",
    offerings,
    company: {
      phone: c.phone, email: c.email, street: c.street, city: c.city, region: c.province, postal: c.postal_code,
      cover: c.image_background_cdn_url || null,
      videoEmbed: yt ? "https://www.youtube.com/embed/" + yt[1] : null,
      waiverUrl: c.smartwaiver_url || null,
      cancellation: plain(c.cancellation_notes).slice(0, 400) || null,
      checkin: plain(c.booking_notes).slice(0, 400) || null,
      faq: plain(c.faq).slice(0, 1200) || null,
    },
    requirements: [...req].slice(0, 10),
    policies: [...pol].slice(0, 10),
    includes: [...inc].slice(0, 10),
    pages: 2,
  };
}

/* ---------- Xola ---------- */

type XolaExp = {
  id: string; name: string; desc: string | null; excerpt: string | null; duration: number | null; status: string; visible?: boolean;
  priceSchemes?: { price: number; constraints?: { object: string; privacy?: string; priceType?: string }[] }[];
  photo?: { src: string } | null; medias?: { src: string; type: string }[]; cancellationPolicy?: string | null;
  included?: string | null; notIncluded?: string | null; requireAdult?: boolean; demographics?: { label?: string; minAge?: number; maxAge?: number }[];
};

export function xolaSeller(bookingUrl: string): string | null {
  const m = bookingUrl.match(/seller\/([a-f0-9]{24})/i);
  return m ? m[1] : null;
}

export async function readXola(seller: string): Promise<WidgetResult | null> {
  const d = await getJson<{ data: XolaExp[] }>("https://xola.com/api/experiences?seller=" + seller + "&limit=100");
  if (!d?.data) return null;
  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  for (const e of d.data) {
    if (!e || !e.name || (e.status && e.status !== "published")) continue;
    const prices = (e.priceSchemes || []).map((p) => p.price).filter((n) => typeof n === "number" && n > 0);
    const perOuting = (e.priceSchemes || []).some((p) => (p.constraints || []).some((c) => c.priceType === "outing"));
    const photos = [e.photo?.src, ...(e.medias || []).filter((m) => m.type === "photo").map((m) => m.src)].filter((s): s is string => !!s).map((s) => (s.startsWith("http") ? s : "https://xola.com" + s));
    const desc = plain(e.excerpt) || plain(e.desc).slice(0, 700).replace(/\s+\S*$/, "");
    offerings.push({
      name: String(e.name || "").trim(),
      detail: e.duration ? (e.duration >= 60 ? (e.duration / 60).toFixed(e.duration % 60 ? 1 : 0) + " hours" : e.duration + " min") : null,
      duration: e.duration ? e.duration + " min" : null,
      price: prices.length ? Math.min(...prices) : null,
      unit: perOuting ? "/group" : "each",
      url: "https://checkout.xola.com/index.html#seller/" + seller + "/experiences/" + e.id,
      desc: desc || null,
      photo: photos[0] || null,
      photos: [...new Set(photos)].slice(0, 6),
    });
    if (e.cancellationPolicy) pol.add(plain(e.cancellationPolicy).slice(0, 260));
    if (e.included) plain(e.included).split(/[.\n]/).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 4).forEach((s) => inc.add(s));
    if (e.requireAdult) req.add(e.name + ": an adult must be in the group.");
    for (const dm of e.demographics || []) if (dm.minAge != null) req.add(`${dm.label || "Guests"}: ages ${dm.minAge}${dm.maxAge ? " to " + dm.maxAge : " and up"}.`);
    const mined = mineSentences(plain(e.desc));
    mined.requirements.forEach((s) => req.add(s));
    mined.policies.forEach((s) => pol.add(s));
  }
  return { vendor: "xola", offerings, company: {}, requirements: [...req].slice(0, 10), policies: [...pol].slice(0, 10), includes: [...inc].slice(0, 10), pages: 1 };
}


/* ---------- Peek ---------- */

/** book.peek.com/s/<key>/<program code>. The key in the URL is the public API key the widget itself sends. */
export function peekRef(bookingUrl: string): { key: string; code: string } | null {
  const m = bookingUrl.match(/book\.peek\.com\/s\/([a-f0-9-]{36})\/([A-Za-z0-9_]+)/i);
  return m ? { key: m[1], code: m[2] } : null;
}

type JsonApiDoc = { data?: { id: string }; included?: { type: string; id: string; attributes: Record<string, unknown>; relationships?: Record<string, { data: { id: string; type: string }[] | { id: string; type: string } | null }> }[] };

async function getPeek(key: string, code: string): Promise<JsonApiDoc | null> {
  try {
    const res = await fetch("https://book.peek.com/services/api/programs/" + encodeURIComponent(code), {
      headers: { "User-Agent": UA, Accept: "application/vnd.api+json", Authorization: "Key " + key },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return (await res.json()) as JsonApiDoc;
  } catch {
    return null;
  }
}

const PEEK_RETAIL = /gift ?card|t-?shirt|hoodie|\bhat\b|sticker|merch|cake|mug|towel|sunscreen|photo package|video package|membership/i;

function peekMinutes(min: unknown, max: unknown): string | null {
  const a = typeof min === "number" ? min : null;
  const b = typeof max === "number" ? max : null;
  const fmt = (m: number) => (m >= 60 ? (m / 60).toFixed(m % 60 ? 1 : 0).replace(/\.0$/, "") + (m === 60 ? " hour" : " hours") : m + " min");
  if (a && b && b !== a) return fmt(a) + " to " + fmt(b);
  if (a) return fmt(a);
  if (b) return fmt(b);
  return null;
}

/** Lowest listed price for a date-priced activity over the next three weeks, from the widget's own availability feed. */
async function peekDatePrice(key: string, activityId: string, ticketId: string): Promise<number | null> {
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const url = `https://book.peek.com/services/api/availability-dates?activity-id=${activityId}&start-date=${day(1)}&end-date=${day(21)}&tickets%5B0%5D%5Bticket-id%5D=${ticketId}&tickets%5B0%5D%5Bquantity%5D=1&use-legacy-api=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/vnd.api+json", Authorization: "Key " + key }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { attributes?: { "price-range"?: { amount: string }[] } }[] };
    const amounts = (j.data || []).flatMap((d) => (d.attributes?.["price-range"] || []).map((p) => Number(p.amount))).filter((n) => Number.isFinite(n) && n > 0);
    return amounts.length ? Math.min(...amounts) : null;
  } catch {
    return null;
  }
}

export async function readPeek(key: string, code: string): Promise<WidgetResult | null> {
  const root = await getPeek(key, code);
  if (!root?.included) return null;
  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  const seenActivity = new Set<string>();
  const ids = (rel: { data: unknown } | undefined) => (Array.isArray(rel?.data) ? (rel!.data as { id: string }[]).map((x) => x.id) : []);

  const harvest = async (doc: JsonApiDoc, onlyActivity: string | null) => {
    const inc0 = doc.included || [];
    const tickets = new Map(inc0.filter((x) => x.type === "ticket").map((x) => [x.id, x.attributes]));
    const questions = inc0.filter((x) => x.type === "question").map((x) => String(x.attributes["question-text"] || ""));
    const pcaImages = inc0.filter((x) => x.type === "program-configuration-activity").map((x) => String(x.attributes.image || "")).filter(Boolean);
    for (const act of inc0.filter((x) => x.type === "activity")) {
      const a = act.attributes;
      const ticketIds = ids(act.relationships?.tickets);
      if (onlyActivity ? act.id !== onlyActivity : ticketIds.length === 0) continue;
      if (seenActivity.has(act.id)) continue;
      const name = plain(a.name);
      if (!name || PEEK_RETAIL.test(name)) continue;
      seenActivity.add(act.id);
      const mine = ticketIds.map((id) => tickets.get(id)).filter((t): t is Record<string, unknown> => !!t);
      const prices = mine.map((t) => Number(t["source-price-gross"])).filter((n) => Number.isFinite(n) && n > 0);
      const fromPrice = Number(a["from-price"]);
      const price = prices.length ? Math.min(...prices) : Number.isFinite(fromPrice) && fromPrice > 0 ? fromPrice : null;
      const ticketNames = mine.map((t) => plain(t.name)).filter(Boolean);
      const rental = a.mode === "rental" || mine.some((t) => t.category === "EQUIPMENT");
      const perPersonTicket = ticketNames.some((n) => /adult|child|person|guest|rider|senior|youth|kid/i.test(n));
      const unit = rental && !perPersonTicket ? "/" + (/(boat|pontoon|tritoon)/i.test(name + " " + ticketNames.join(" ")) ? "boat" : /(jet ?ski|waverunner|sea-?doo)/i.test(name + " " + ticketNames.join(" ")) ? "jet ski" : /kayak|paddle|sup\b/i.test(name) ? "each" : "rental") : unitOf(ticketNames.join(" "), name);
      const durationText = peekMinutes(a["duration-min-minutes"], a["duration-max-minutes"]);
      const desc = plain(a["description-short"]) || plain(a.description).slice(0, 700).replace(/\s+\S*$/, "");
      const image = typeof a.image === "string" ? a.image : null;
      const priced = mine.filter((t) => Number.isFinite(Number(t["source-price-gross"])) && Number(t["source-price-gross"]) > 0);
      // Rentals priced by date carry no ticket price; the next three weeks of availability show the real range.
      let datePrice: number | null = null;
      if (!priced.length && price == null && ticketIds.length) datePrice = await peekDatePrice(key, act.id, ticketIds[0]);
      const unitFor = (label: string) => {
        const text = label + " " + name;
        const count = label.match(/\b(\d+)\s*-?\s*(people|persons?|guests?|adults?|riders?|pax|players?|passengers?)\b/i);
        if (/\b(\d+\s*-?\s*person)\s+(boat|pontoon|tritoon|tiki|yacht|vessel|kayak|cart|kart)\b/i.test(label)) return "/" + label.match(/\b\d+\s*-?\s*person\s+(boat|pontoon|tritoon|tiki|yacht|vessel|kayak|cart|kart)\b/i)![1].toLowerCase().replace(/pontoon|tritoon|tiki|yacht|vessel/, "boat");
        if ((count && Number(count[1]) > 1) || /\b(group|party|private|charter|whole boat|entire)\b/i.test(label)) return "/group";
        if (/\b(adult|child|children|person|guest|rider|senior|youth|kid|student|infant|toddler)\b/i.test(label)) return "each";
        if (/(boat|pontoon|tritoon|tiki|yacht|vessel)/i.test(text) && rental) return "/boat";
        if (/(jet ?ski|waverunner|sea-?doo)/i.test(text) && rental) return "/jet ski";
        return unit === "/rental" ? "each" : unit;
      };
      const base = {
        name,
        duration: durationText,
        url: "https://book.peek.com/s/" + key + "/" + code,
        desc: desc || null,
        photo: image,
        photos: [...new Set([image, ...pcaImages].filter((x): x is string => !!x))].slice(0, 6),
      };
      if (priced.length > 1) {
        // Every ticket type is its own labelled option; no unlabelled duplicate row.
        for (const t of priced) {
          const label = plain(t.name);
          offerings.push({ ...base, detail: label === name ? durationText : label, price: Number(t["source-price-gross"]), unit: unitFor(label), desc: offerings.some((o) => o.name === name) ? null : base.desc, photo: offerings.some((o) => o.name === name) ? null : base.photo, photos: offerings.some((o) => o.name === name) ? [] : base.photos });
        }
      } else {
        const label = ticketNames[0] || "";
        offerings.push({ ...base, detail: durationText || (label && label !== name ? label : null), price: price ?? datePrice, unit: unitFor(label) });
      }
      for (const t of mine) {
        const d = plain(t.description);
        if (d && REQ_RE.test(d) && d.length < 200) req.add(/[.!?]$/.test(d) ? d : d + ".");
      }
      const cancel = plain(a["cancellation-policy"]);
      if (cancel) pol.add(cancel.slice(0, 260));
      const hours = Number(a["cancellation-hours"]);
      if (!cancel && Number.isFinite(hours) && hours > 0) pol.add("Cancel up to " + (hours >= 48 ? hours / 24 + " days" : hours + " hours") + " before the start time through the booking system.");
      const mined = mineSentences(plain(a.description));
      mined.requirements.forEach((x) => req.add(x));
      mined.policies.forEach((x) => pol.add(x));
      mined.includes.forEach((x) => inc.add(x));
    }
    for (const q of questions) {
      const mined = mineSentences(q);
      mined.requirements.filter((x) => x.length <= 180).forEach((x) => req.add(x));
      mined.policies.filter((x) => x.length <= 180).forEach((x) => pol.add(x));
    }
  };

  await harvest(root, null);
  // Multi-activity programs list each activity's own program code as "p_xxxx--<activity id>".
  const subs = (root.included || [])
    .filter((x) => x.type === "program-configuration-activity")
    .map((x) => {
      const rel = x.relationships?.["program-configuration"]?.data as { id: string } | null | undefined;
      const m = rel?.id?.match(/^([A-Za-z0-9_]+)--([a-f0-9-]{36})$/i);
      return m ? { code: m[1], activity: m[2] } : null;
    })
    .filter((x): x is { code: string; activity: string } => !!x)
    .slice(0, 12);
  for (const sub of subs) {
    if (seenActivity.has(sub.activity)) continue;
    const doc = await getPeek(key, sub.code);
    if (doc) await harvest(doc, sub.activity);
  }
  if (!offerings.length) return null;
  return { vendor: "peek", offerings, company: {}, requirements: [...req].slice(0, 10), policies: [...pol].slice(0, 10), includes: [...inc].slice(0, 10), pages: 1 + subs.length };
}

/* ---------- store ---------- */

type OpRow = { id: string; domain: string; website: string | null; booking_url: string };

export function storeWidget(op: OpRow, w: WidgetResult): { offerings: number; facts: number } {
  const now = nowIso();
  db.prepare("DELETE FROM offerings WHERE operator_id = ? AND confidence IN ('widget', 'site')").run(op.id);
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'widget'").run(op.id);
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'site' AND fact_key IN ('service', 'service_desc', 'service_photo')").run(op.id);
  db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'widgets'").run(op.id);
  const insOff = db.prepare(
    `INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, source_url, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'widget')`,
  );
  const insFact = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'widget')");
  let facts = 0;
  const fact = (k: string, v: string | null | undefined, url = op.booking_url) => {
    if (!v) return;
    insFact.run(randomUUID(), op.id, k, v, url);
    facts += 1;
  };
  const seenPhotos = new Set<string>();
  for (const o of w.offerings) {
    insOff.run(randomUUID(), op.id, o.name.slice(0, 80), o.detail?.slice(0, 120) || null, o.duration, o.price == null ? null : Math.round(o.price * 100), o.unit, o.url);
    fact("service", o.name.slice(0, 80), o.url);
    if (o.desc) fact("service_desc", JSON.stringify({ name: o.name.slice(0, 80), desc: o.desc }), o.url);
    if (o.photo) fact("service_photo", JSON.stringify({ name: o.name.slice(0, 80), url: o.photo }), o.url);
    for (const p of o.photos) if (!seenPhotos.has(p) && seenPhotos.size < 10) { seenPhotos.add(p); fact("photo", p, o.url); }
  }
  // Widget photos only become the cover when the site crawl found none.
  const hasCover = db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = 'cover' LIMIT 1").get(op.id);
  if (!hasCover) fact("cover", w.company.cover || [...seenPhotos][0] || null);
  for (const r of w.requirements) fact("requirement", r);
  for (const p of w.policies) fact("policy", p);
  for (const i of w.includes) fact("includes", i);
  fact("cancellation", w.company.cancellation);
  fact("checkin", w.company.checkin);
  fact("waiver_url", w.company.waiverUrl);
  fact("faq", w.company.faq);
  if (w.company.videoEmbed && !db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = 'video_embed' LIMIT 1").get(op.id)) fact("video_embed", w.company.videoEmbed);
  fact("booking_vendor", w.vendor);
  db.prepare(
    `UPDATE operators SET phone = COALESCE(phone, ?), email = COALESCE(email, ?), street = COALESCE(street, ?), city = COALESCE(city, ?),
       region = COALESCE(region, ?), postal = COALESCE(postal, ?), calendar_vendor = COALESCE(calendar_vendor, ?), updated_at = ? WHERE id = ?`,
  ).run(w.company.phone ? normalizePhone(w.company.phone) : null, w.company.email || null, w.company.street || null, w.company.city || null, w.company.region || null, w.company.postal || null, w.vendor, now, op.id);
  db.prepare(
    "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'widgets', 1, ?)",
  ).run(randomUUID(), op.id, op.booking_url, now, `${w.vendor}: ${w.offerings.length} items with prices, descriptions and photos from the operator's booking widget.`);
  return { offerings: w.offerings.length, facts };
}

export async function widgetForOperator(op: OpRow): Promise<{ vendor: string; offerings: number; facts: number } | null> {
  const fh = fareharborShortname(op.booking_url);
  const xs = xolaSeller(op.booking_url);
  const pk = peekRef(op.booking_url);
  const w = fh ? await readFareharbor(fh) : xs ? await readXola(xs) : pk ? await readPeek(pk.key, pk.code) : null;
  if (!w || !w.offerings.length) return null;
  const n = storeWidget(op, w);
  return { vendor: w.vendor, ...n };
}

export function pendingWidgets(limit: number, redo = false): OpRow[] {
  const cond = redo ? "" : "AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'widgets')";
  return db
    .prepare(
      `SELECT o.id, o.domain, o.website, f.fact_value AS booking_url FROM operators o
       JOIN facts f ON f.operator_id = o.id AND f.fact_key = 'booking_url'
       WHERE o.origin != 'demo' AND (f.fact_value LIKE '%fareharbor.com/%' OR f.fact_value LIKE '%xola.%seller/%' OR f.fact_value LIKE '%book.peek.com/s/%') ${cond}
       GROUP BY o.id
       ORDER BY (o.metro_id IS NULL), o.review_count DESC NULLS LAST, o.name ASC
       LIMIT ?`,
    )
    .all(limit) as OpRow[];
}

export async function widgetsPending(limit: number, concurrency = 6, redo = false): Promise<{ sites: number; ok: number; offerings: number; facts: number }> {
  const queue = pendingWidgets(limit, redo);
  const out = { sites: 0, ok: 0, offerings: 0, facts: 0 };
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const op = queue[i++];
      try {
        const r = await withDeadline(widgetForOperator(op), 45000, op.domain);
        out.sites += 1;
        if (r) {
          out.ok += 1;
          out.offerings += r.offerings;
          out.facts += r.facts;
        } else {
          db.prepare("INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 0, 'widgets', 1, ?)").run(randomUUID(), op.id, op.booking_url, nowIso(), "widget returned no listed items");
        }
      } catch (e) {
        out.sites += 1;
        console.error(op.domain + ": " + (e as Error).message.slice(0, 120));
      }
      if (out.sites % 100 === 0) console.log(`${out.sites}/${queue.length} widgets, ${out.ok} ok, ${out.offerings} items`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}

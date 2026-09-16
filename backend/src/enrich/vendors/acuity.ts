import { mineSentences, plain, type Offering, type WidgetResult } from "../widgets.ts";
import { safeFetch } from "../../lib/safeFetch.ts";

/**
 * Acuity Scheduling (Squarespace Scheduling) as a free, exact source.
 *
 * Every public scheduling page (`<name>.as.me/`, `<name>.as.me/schedule/<key>`, `app.acuityscheduling.com/schedule.php?owner=<id>`,
 * `app.acuityscheduling.com/schedule/<key>`, same on app.squarespacescheduling.com) is a JS shell whose <head> carries
 * `var BUSINESS = {...};`: the operator's whole appointment-type menu as JSON. No key, no cookie, no XHR needed.
 * `appointmentTypes` is an object keyed by category ("" when uncategorised) of
 *   { id, name, active, description, duration (min), price ("2,520.00", string), category, type: service|class|series,
 *     classSize, private, image, calendarIDs, addonIDs, formIDs, paymentRequired, canChooseQuantity }
 * plus `products` (packages and gift certificates, keyed by kind), `calendars` (staff, with location and timezone),
 * `addons`, `forms`, `description` (business intro), `currencyAbbreviation`, `hidePrice`, `hideDuration`, `isExpired`.
 *
 * Read this page with its query string stripped: `?appointmentType=<id>` (and `/appointment/<id>`, `/category/<name>`) filters
 * the embedded list to one type, and a filter pointing at a deleted type answers an empty menu.
 * Acuity's `/api/*` is disallowed by its robots.txt and needs the owner's key; nothing here touches it.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HOSTS = /^(?:app\.)?(?:acuityscheduling|squarespacescheduling)\.com$|\.as\.me$/i;

export type AcuityRef = {
  /** Canonical schedule page, query and hash stripped, that carries the BUSINESS JSON. */
  url: string;
  /** Numeric owner id when the link names one (schedule.php?owner=<id>). */
  owner: string | null;
  /** Eight-hex owner key when the link names one (/schedule/<key>). */
  key: string | null;
};

type AcuityType = {
  id: number; name: string; active?: boolean; description?: string | null; duration?: number | null; price?: string | number | null;
  category?: string | null; private?: boolean; type?: string | null; image?: string | null; classSize?: number | null;
  calendarIDs?: number[]; addonIDs?: number[]; formIDs?: number[]; paymentRequired?: boolean; canChooseQuantity?: boolean;
};
type AcuityProduct = { id: number; title: string; description?: string | null; price?: number | string | null; formattedPrice?: string | null; category?: string | null; thumbnailUrl?: string | null; isSubscription?: boolean };
type AcuityCalendar = { id: number | string; name: string; description?: string | null; location?: string | null; timezone?: string | null; image?: string | null; thumbnail?: string | null };
type AcuityBusiness = {
  id: number; ownerKey?: string | null; name?: string | null; description?: string | null; url?: string | null; prettyUrl?: string | null; logoUrl?: string | null;
  currencyAbbreviation?: string | null; hidePrice?: boolean; hideDuration?: boolean; isExpired?: boolean; showFullAppointmentDescriptions?: boolean;
  appointmentTypes?: Record<string, AcuityType[]> | AcuityType[]; products?: Record<string, AcuityProduct[]> | AcuityProduct[];
  calendars?: Record<string, AcuityCalendar[]> | AcuityCalendar[]; addons?: { id: number; name: string; duration?: number; price?: string; active?: boolean; private?: boolean }[];
  country?: string | null; timezone?: string | null;
};

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A booking link, or a page's HTML, to the schedule page that embeds the menu. Null when nothing names an Acuity account. */
export function acuityRef(bookingUrlOrHtml: string): AcuityRef | null {
  const s = String(bookingUrlOrHtml || "").trim();
  if (!s) return null;
  const candidates: string[] = [];
  if (/^https?:\/\//i.test(s) && !/[<>\s]/.test(s)) candidates.push(s);
  else {
    // Page HTML: iframe/anchor/script targets and plain mentions. Squarespace's embed.js alone names no account, so nothing is guessed.
    const re = /https?:\/\/[a-z0-9.-]*(?:acuityscheduling\.com|squarespacescheduling\.com|as\.me)[^\s"'<>)\\]*/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) candidates.push(m[0].replace(/&amp;/g, "&").replace(/&quot;.*$/, ""));
  }
  for (const c of candidates) {
    const ref = refFromUrl(c);
    if (ref) return ref;
  }
  return null;
}

function refFromUrl(raw: string): AcuityRef | null {
  let u: URL;
  try {
    u = new URL(raw.replace(/&quot;.*$/i, "").replace(/%26quot%3B.*$/i, ""));
  } catch {
    return null;
  }
  const hostname = u.hostname.toLowerCase();
  if (!HOSTS.test(hostname)) return null;
  if (/^(?:embed|secure|cdn-s|www|acuityscheduling|de|it|es|fr-fr|pt-br)\.?(?:acuityscheduling|squarespacescheduling)?\.com$/i.test(hostname) && !/^app\./i.test(hostname)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  const owner = u.searchParams.get("owner");
  const keyMatch = path.match(/^\/schedule\/([a-f0-9]{8})(?:\/|$)/i);
  const isAsMe = /\.as\.me$/i.test(hostname);
  if (keyMatch) return { url: `https://${hostname}/schedule/${keyMatch[1].toLowerCase()}`, owner: owner && /^\d+$/.test(owner) ? owner : null, key: keyMatch[1].toLowerCase() };
  if (owner && /^\d+$/.test(owner)) return { url: `https://${hostname}/schedule.php?owner=${owner}`, owner, key: null };
  if (isAsMe) {
    // "<name>.as.me/", "/schedule.php", "/?appointmentType=…", "/catalog.php" all resolve to the account root, which lists every type.
    if (path === "" || /^\/(?:schedule\.php|catalog\.php|catalog|appointment|category|datetime)(?:\/|$)/i.test(path) || /^\/schedule(?:\/|$)/i.test(path)) return { url: `https://${hostname}/`, owner: null, key: null };
    return null;
  }
  return null;
}

/* ---------- robots ---------- */

const robotsCache = new Map<string, string[]>();

/** Disallow prefixes for `*` on this host; Acuity's file bars `/api/*` and one named owner id, both honoured. */
async function disallows(origin: string): Promise<string[]> {
  const hit = robotsCache.get(origin);
  if (hit) return hit;
  const out: string[] = [];
  try {
    const res = await safeFetch(origin + "/robots.txt", { headers: { "User-Agent": UA }, timeoutMs: 15000, maxBytes: 5_000_000 });
    if (res.ok) {
      let star = false;
      for (const line of (await res.text()).split(/\r?\n/)) {
        const l = line.replace(/#.*$/, "").trim();
        if (!l) continue;
        const [k, ...rest] = l.split(":");
        const v = rest.join(":").trim();
        if (/^user-agent$/i.test(k)) star = v === "*";
        else if (star && /^disallow$/i.test(k) && v) out.push(v);
      }
    }
  } catch {
    /* no robots reachable: nothing forbidden by it */
  }
  robotsCache.set(origin, out);
  return out;
}

function robotsAllows(rules: string[], pathAndQuery: string): boolean {
  for (const rule of rules) {
    const re = new RegExp("^" + rule.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
    if (re.test(pathAndQuery)) return false;
  }
  return true;
}

/* ---------- read ---------- */

async function fetchBusiness(ref: AcuityRef): Promise<AcuityBusiness | null> {
  const u = new URL(ref.url);
  if (!robotsAllows(await disallows(u.origin), u.pathname + u.search)) return null;
  await pause(200);
  let html: string;
  try {
    const res = await safeFetch(ref.url, { headers: { "User-Agent": UA, Accept: "text/html" }, timeoutMs: 15000, maxBytes: 5_000_000 });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  return parseBusiness(html);
}

/** The `var BUSINESS = {...};` literal in the page head. Exported so a cached page can be read without a fetch. */
export function parseBusiness(html: string): AcuityBusiness | null {
  const m = html.match(/var BUSINESS\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (!m) return null;
  try {
    const b = JSON.parse(m[1]) as AcuityBusiness;
    return b && typeof b.id === "number" ? b : null;
  } catch {
    return null;
  }
}

const flat = <T,>(v: Record<string, T[]> | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v ? Object.values(v).flat() : []);

function acuityMoney(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function minutes(m: number | null | undefined): string | null {
  if (!m || m <= 0) return null;
  if (m % 1440 === 0 && m >= 1440) return m / 1440 + (m === 1440 ? " day" : " days");
  if (m >= 60) return (m / 60).toFixed(m % 60 ? 1 : 0).replace(/\.0$/, "") + (m === 60 ? " hour" : " hours");
  return m + " min";
}

function absImage(s: string | null | undefined): string | null {
  if (!s) return null;
  if (s.startsWith("//")) return "https:" + s;
  return /^https?:\/\//i.test(s) ? s : null;
}

/** Deposits, holds and admin-only rows are not something a guest books as a service. */
const NOT_A_SERVICE = /^\s*(?:deposit|hold|retainer|balance|admin|do not book|test)\b|\b(?:deposit only|balance due)\b/i;

/** Per-type deep link the widget itself uses: the root schedule page plus `appointmentType=<id>`. */
function typeUrl(ref: AcuityRef, b: AcuityBusiness, id: number): string {
  const root = ref.url.includes("schedule.php?owner=") ? ref.url : (b.prettyUrl && /^https?:\/\//i.test(b.prettyUrl) ? b.prettyUrl.toLowerCase() : ref.url).replace(/\/+$/, "") + "/";
  return root + (root.includes("?") ? "&" : "?") + "appointmentType=" + id;
}

function unitFor(t: AcuityType, name: string): string {
  const text = name + " " + plain(t.description).slice(0, 200);
  if (t.type === "class" || t.type === "series") return "each";
  if (/\b(charters?|private (?:tours?|lessons?|sessions?|boat|trips?|groups?)|whole boat|entire boat|per (?:boat|group|vessel|room|lane))\b|\bup to \d+ (?:people|guests|anglers|passengers|riders)\b/i.test(text)) return "/group";
  return "each";
}

export async function readAcuity(ref: AcuityRef): Promise<WidgetResult | null> {
  const b = await fetchBusiness(ref);
  if (!b || b.isExpired) return null;
  const types = flat(b.appointmentTypes);
  const calendars = new Map(flat(b.calendars).map((c) => [String(c.id), c]));
  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  for (const t of types) {
    if (!t || !t.name || t.active === false || t.private) continue;
    const name = plain(t.name).slice(0, 120);
    if (!name || NOT_A_SERVICE.test(name)) continue;
    const descLong = plain(t.description);
    const duration = b.hideDuration ? null : minutes(t.duration);
    const category = plain(t.category);
    const photo = absImage(t.image);
    const staff = (t.calendarIDs || []).map((id) => calendars.get(String(id))).filter((c): c is AcuityCalendar => !!c);
    const staffPhotos = staff.map((c) => absImage(c.image)).filter((s): s is string => !!s);
    const detail = t.type === "class" || t.type === "series"
      ? [t.type === "series" ? "Series" : "Group class", t.classSize ? "up to " + t.classSize : "", duration || ""].filter(Boolean).join(" · ")
      : [category, duration].filter(Boolean).join(" · ") || null;
    offerings.push({
      name,
      detail: detail && detail !== name ? detail.slice(0, 120) : null,
      duration,
      price: b.hidePrice ? null : acuityMoney(t.price),
      unit: unitFor(t, name),
      url: typeUrl(ref, b, t.id),
      desc: descLong.slice(0, 700).replace(/\s+\S*$/, "") || null,
      photo,
      photos: [...new Set([photo, ...staffPhotos].filter((s): s is string => !!s))].slice(0, 6),
    });
    const mined = mineSentences(descLong);
    mined.requirements.forEach((s) => req.add(s));
    mined.policies.forEach((s) => pol.add(s));
    mined.includes.forEach((s) => inc.add(s));
  }
  // Packages and gift certificates are real priced products on the same account (catalog.php), sold as bundles of the types above.
  for (const p of flat(b.products)) {
    if (!p || !p.title || p.isSubscription) continue;
    const name = plain(p.title).slice(0, 120);
    const desc = plain(p.description);
    if (!name || /\bgift\b/i.test(name) || /\bgift (?:card|certificate)/i.test(desc)) continue;
    offerings.push({ name, detail: "Package", duration: null, price: b.hidePrice ? null : acuityMoney(p.price ?? p.formattedPrice), unit: "each", url: b.prettyUrl && /^https?:\/\//i.test(b.prettyUrl) ? b.prettyUrl.toLowerCase().replace(/\/+$/, "") + "/catalog.php" : ref.url, desc: desc.slice(0, 700).replace(/\s+\S*$/, "") || null, photo: absImage(p.thumbnailUrl), photos: [] });
    const mined = mineSentences(desc);
    mined.includes.forEach((s) => inc.add(s));
    mined.requirements.forEach((s) => req.add(s));
  }
  if (!offerings.length) return null;
  const intro = plain(b.description);
  const coMined = mineSentences(intro);
  coMined.requirements.forEach((s) => req.add(s));
  coMined.policies.forEach((s) => pol.add(s));
  coMined.includes.forEach((s) => inc.add(s));
  // "All changes require a 48 hour notice" sits in the intro without the words the policy miner keys on.
  const noticeLine = intro.split(/(?<=[.!?])\s+/).map((x) => x.trim()).find((x) => x.length >= 20 && x.length <= 300 && /\b\d+\s*(?:hours?|days?)\b.*\b(?:notice|cancel|reschedul|change)/i.test(x)) || null;
  const cancel = coMined.policies.find((s) => /cancel|reschedul|notice/i.test(s)) || (noticeLine ? noticeLine.replace(/[.!?]?$/, ".") : null);
  if (noticeLine && !pol.has(cancel!)) pol.add(cancel!);
  const firstCal = flat(b.calendars).find((c) => c && c.id !== "any");
  const cover = absImage(firstCal?.image) || offerings.map((o) => o.photo).find((p) => !!p) || null;
  return {
    vendor: "acuity",
    offerings,
    company: {
      currency: b.currencyAbbreviation ? String(b.currencyAbbreviation).toUpperCase() : null,
      cover,
      cancellation: cancel ? cancel.slice(0, 400) : null,
      checkin: null,
    },
    requirements: [...req].slice(0, 10),
    policies: [...pol].slice(0, 10),
    includes: [...inc].slice(0, 10),
    pages: 1,
  };
}

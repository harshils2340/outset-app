import type { Company, Offering, WidgetResult } from "../widgets.ts";
import { mineSentences, plain } from "../widgets.ts";
import { safeFetch } from "../../lib/safeFetch.ts";

/**
 * Resova: escape rooms and similar timed rooms, booked at <company>.resova.us (also .com / .eu).
 *
 * The booking site is an Angular app. Its HTML shell (robots.txt: allow all) holds two globals the app sends on every
 * call: `baseUrl` (the host) and `aeuToken`, a per-request public key that goes out as X-API-KEY, together with the
 * `resova_session` cookie the same response sets. With those two, no login:
 *   GET https://<host>/api/booking/v1/misc/init
 *       settings (business name, phone, address, currency, waivers), items (every item shown on the booking site:
 *       name, short and long description, duration, per_person or total pricing, "from" price, min and max players,
 *       featured and gallery images, categories, terms), extras (merchandise), vouchers.
 *   GET https://<host>/api/booking/v1/availability/calendar/list?start_date=YYYY-MM-DD&length=7
 *       every slot of the coming week, each with its item, duration, that day's price and pricing type, private or
 *       shared, and min/max party size. Items that an operator books only through the calendar (a party package, a
 *       room hidden from the item grid) show up here and not in misc/init, so both feeds are read and merged.
 * /items and /items/<id> answer the HTML shell to a plain GET, so the two calls above are the whole read.
 * Images: https://d1p8ky4d0rkzp4.cloudfront.net/780x610/<file> is the size the booking site itself shows.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const IMG = "https://d1p8ky4d0rkzp4.cloudfront.net/780x610/";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ResovaRef = { host: string };

const NOT_A_SHOP = /^(www|get|app|help|api|cdn|static|assets|mail|blog|status|docs|developers?|support|my|admin)$/i;

/** A booking URL, or a page of the operator's HTML with a Resova link, iframe or widget script in it. */
export function resovaRef(bookingUrlOrHtml: string): ResovaRef | null {
  const counts = new Map<string, number>();
  const re = /(?:https?:\/\/|\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.resova\.(us|com|eu)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bookingUrlOrHtml))) {
    const sub = m[1].toLowerCase();
    if (NOT_A_SHOP.test(sub)) continue;
    const host = sub + ".resova." + m[2].toLowerCase();
    counts.set(host, (counts.get(host) || 0) + 1);
  }
  if (!counts.size) return null;
  const host = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { host };
}

type RsItem = {
  id: number; name: string; status?: number; order?: number; type?: string;
  short_description?: string | null; short_excerpt?: string | null; long_description?: string | null;
  duration_amount?: number | null; duration_type?: string | null;
  pricing_type?: string | null; single_price?: string | null; total_price?: string | null;
  from?: { price?: string | null; type?: string | null } | null;
  min_quantity?: number | null; max_quantity?: number | null; total_quantity?: number | null;
  private_booking_min_quantity?: number | null; private_booking_description?: string | null;
  featured_image?: string | null; gallery_images?: { type?: string; value?: string | null }[] | null;
  terms_active?: boolean; terms_content?: string | null; calltobook_over_max?: boolean;
  categories?: { id?: number; name?: string }[] | null;
  location?: { id?: number; address_city?: string | null; maps_address?: string | null } | null;
};
type RsInit = {
  settings?: { data?: {
    business?: { name?: string; telephone?: string; telephone_full?: string; website?: string; invoice_address?: { address?: string; address2?: string; city?: string; county?: string; postcode?: string; country?: string } };
    locale?: { currency?: string };
    waivers?: { active?: boolean; content?: string | null };
    booking_site_url?: string;
    business_type?: string;
  } };
  items?: { data?: RsItem[]; total?: number };
};
type RsSlot = {
  item_id: number; type?: string; duration?: number | null;
  item?: { id: number; name: string; featured_image?: string | null; short_description?: string | null; short_excerpt?: string | null; long_description?: string | null };
  availablity?: { private?: boolean; min?: number; max?: number; available?: number };
  from?: { price?: string | null; pricing_type?: string | null } | null;
  password?: string | null;
};
type RsCalendar = { data?: { dates?: { date: string; times?: RsSlot[] }[] } };

async function shell(host: string): Promise<{ token: string; cookie: string } | null> {
  try {
    const res = await safeFetch("https://" + host + "/", { headers: { "User-Agent": UA, Accept: "text/html" }, timeoutMs: 15000, maxBytes: 5_000_000 });
    if (!res.ok) return null;
    const html = await res.text();
    const token = html.match(/aeuToken\s*=\s*"([^"]+)"/)?.[1];
    if (!token) return null;
    const cookie = (typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""])
      .map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    return { token, cookie };
  } catch {
    return null;
  }
}

async function api<T>(host: string, auth: { token: string; cookie: string }, path: string): Promise<T | null> {
  try {
    const res = await safeFetch("https://" + host + "/api/booking/v1/" + path, {
      headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Content-Type": "application/json", "X-API-KEY": auth.token, Cookie: auth.cookie, Referer: "https://" + host + "/" },
      timeoutMs: 15000,
      maxBytes: 5_000_000,
    });
    if (!res.ok || !/json/i.test(res.headers.get("content-type") || "")) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const num = (s: string | number | null | undefined): number | null => {
  const n = typeof s === "number" ? s : Number(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const img = (file: string | null | undefined): string | null => (file && !/fallback|gift_default/i.test(file) ? IMG + file : null);
const RETAIL = /gift ?(card|voucher)|t-?shirt|hoodie|\bhat\b|merch|photo package|membership/i;

function durationText(amount: number | null | undefined, type: string | null | undefined): string | null {
  if (!amount || amount <= 0) return null;
  const minutes = /hour/i.test(type || "") ? amount * 60 : /day/i.test(type || "") ? amount * 1440 : amount;
  if (minutes % 60 === 0 && minutes >= 60) return minutes / 60 + (minutes === 60 ? " hour" : " hours");
  return minutes + " min";
}

export async function readResova(ref: ResovaRef): Promise<WidgetResult | null> {
  const auth = await shell(ref.host);
  if (!auth) return null;
  await pause(300);
  const init = await api<RsInit>(ref.host, auth, "misc/init");
  if (!init?.items) return null;
  await pause(300);
  const start = new Date().toISOString().slice(0, 10);
  const cal = await api<RsCalendar>(ref.host, auth, `availability/calendar/list?start_date=${start}&length=7`);

  // One row per item: the grid item when it exists, else the calendar's copy of it.
  type Live = { price: number | null; perPerson: boolean | null; minutes: number | null; min: number | null; max: number | null; priv: boolean | null };
  const live = new Map<number, Live>();
  const calItems = new Map<number, NonNullable<RsSlot["item"]>>();
  for (const day of cal?.data?.dates || []) for (const t of day.times || []) {
    if (!t?.item_id || t.password) continue;
    if (t.item && !calItems.has(t.item_id)) calItems.set(t.item_id, t.item);
    const p = num(t.from?.price);
    const cur = live.get(t.item_id) || { price: null, perPerson: null, minutes: null, min: null, max: null, priv: null };
    if (p != null && (cur.price == null || p < cur.price)) cur.price = p;
    if (t.from?.pricing_type) cur.perPerson = t.from.pricing_type === "per_person";
    if (t.duration && !cur.minutes) cur.minutes = t.duration;
    const a = t.availablity;
    if (a) {
      if (typeof a.min === "number" && (cur.min == null || a.min < cur.min)) cur.min = a.min;
      if (typeof a.max === "number" && (cur.max == null || a.max > cur.max)) cur.max = a.max;
      if (typeof a.private === "boolean") cur.priv = cur.priv === null ? a.private : cur.priv && a.private;
    }
    live.set(t.item_id, cur);
  }

  const items: RsItem[] = (init.items.data || []).filter((i) => i && i.name && (i.status == null || i.status === 1));
  for (const [id, it] of calItems) if (!items.some((i) => i.id === id)) items.push({ id, name: it.name, short_description: it.short_description, short_excerpt: it.short_excerpt, long_description: it.long_description, featured_image: it.featured_image });

  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  for (const it of items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.id - b.id)) {
    const name = plain(it.name).slice(0, 80);
    if (!name || RETAIL.test(name)) continue;
    const l = live.get(it.id);
    const perPerson = l?.perPerson ?? (it.pricing_type ? it.pricing_type === "per_person" : it.from?.type ? it.from.type === "per_person" : null);
    const fromPrice = num(it.from?.price) ?? num(it.single_price);
    // What the calendar charges this week is the price; the grid's lower "from" price is a stated fact the guest also sees.
    const price = l?.price ?? fromPrice;
    const minutes = it.duration_amount ? null : l?.minutes ?? null;
    const duration = durationText(it.duration_amount, it.duration_type) || durationText(minutes, "minutes");
    // A private slot's calendar min equals its capacity, so the minimum party size is only what the item itself states.
    const min = it.min_quantity ?? null;
    const max = it.max_quantity ?? l?.max ?? null;
    const players = min && max && max > min ? `${min} to ${max} players` : max ? `up to ${max} players` : null;
    const details: string[] = [];
    if (players) details.push(players);
    // Resova's item grid says "From $15.00 per person" when larger groups or other dates pay less; the calendar says what a minimum booking pays this week.
    if (fromPrice != null && price != null && fromPrice < price) details.push(`from $${fromPrice}${perPerson ? " each" : ""}`);
    if (l?.priv) details.push("private room");
    const longDesc = plain(it.long_description);
    const desc = (plain(it.short_description) || plain(it.short_excerpt) || longDesc.slice(0, 600).replace(/\s+\S*$/, "")).slice(0, 700);
    const photos = [...new Set([img(it.featured_image), ...(it.gallery_images || []).map((g) => img(g?.value))].filter((x): x is string => !!x))].slice(0, 6);
    offerings.push({
      name,
      detail: details.length ? details.join(" · ").slice(0, 120) : duration,
      duration,
      price,
      unit: perPerson === false ? "/group" : "each",
      url: "https://" + ref.host + "/items/view/" + it.id,
      desc: desc || null,
      photo: photos[0] || null,
      photos,
    });
    const mined = mineSentences([longDesc, it.private_booking_description, it.terms_active ? it.terms_content : null].filter(Boolean).join(" "));
    mined.requirements.forEach((s) => req.add(s));
    mined.policies.forEach((s) => pol.add(s));
    mined.includes.forEach((s) => inc.add(s));
    if (min && min > 1) req.add(`${name}: minimum ${min} players per booking.`);
    if (it.private_booking_min_quantity && it.private_booking_min_quantity > 0) inc.add(`${name}: book ${it.private_booking_min_quantity} or more to have the room to yourselves.`);
    if (it.calltobook_over_max && max) pol.add(`${name}: groups larger than ${max} book by phone.`);
  }
  if (!offerings.length) return null;

  const s = init.settings?.data || {};
  const b = s.business || {};
  const addr = b.invoice_address || {};
  const waiver = s.waivers?.active ? "https://" + ref.host + "/sign_waiver" : null;
  const wmined = s.waivers?.active ? mineSentences(plain(s.waivers?.content)) : null;
  wmined?.requirements.forEach((x) => req.add(x));
  wmined?.policies.forEach((x) => pol.add(x));
  const company: Company = {
    currency: s.locale?.currency ? s.locale.currency.toUpperCase() : null,
    phone: b.telephone_full || b.telephone || null,
    street: [addr.address, addr.address2].filter(Boolean).join(", ") || null,
    city: addr.city || null,
    region: addr.county || null,
    postal: addr.postcode || null,
    waiverUrl: waiver,
  };
  return { vendor: "resova", offerings, company, requirements: [...req].slice(0, 10), policies: [...pol].slice(0, 10), includes: [...inc].slice(0, 10), pages: 3 };
}

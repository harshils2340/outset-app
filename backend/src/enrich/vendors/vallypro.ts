import type { Company, Offering, WidgetResult } from "../widgets.ts";
import { mineSentences, plain } from "../widgets.ts";
import { safeFetch } from "../../lib/safeFetch.ts";

/**
 * VallyPro (Vally): guide and charter booking, book.vallypro.com/p/<slug>.
 *
 * What is open and what is not (checked 15 September 2026):
 *   book.vallypro.com/robots.txt disallows /p/, /embed/ and /affiliate/ for every agent, and the pages carry
 *   <meta name="robots" content="noindex, nofollow">. api.vallypro.com/robots.txt disallows everything. So the
 *   booking pages, which are the only place trip names and copy are rendered, are off limits, and this reader never
 *   fetches them.
 *   services.vallypro.com is the JSON API the booking page itself calls from the browser with no key. It has no
 *   robots.txt (404) and three of its routes answer without an Authorization header:
 *     GET /v1/businesses/lookup/<slug or id>                 business: name, contact, cancellation policy, deposit, cover
 *     GET /v1/businesses/<id>/participant-types              Adult, Child... (labels only, no prices)
 *     GET /v1/activities/<tripId>/offering-instances?mode=instances&year=YYYY&month=M   (M is 0-based, JS style)
 *                                                            every departure in that month: durationMinutes, basePrice in
 *                                                            cents, groupSizeMultiplier, callToBookOnly
 *   The routes that would list a business's trips (/v1/businesses/<id>/activities, /folders, /service-add-ons) answer
 *   401 "Missing or invalid Authorization header". There is no unauthenticated list of trips.
 *
 * So a trip is readable only when its id is already known. Ids come from the operator's own site: "Book" links of the
 * form book.vallypro.com/p/<slug>/trips/<24 hex> (or vallypro.com/p/...). Links to /folders/<id> name a folder, not a
 * trip, and give nothing. Pass the operator's page HTML to vallyproRef() and it collects the slug, the trip ids and the
 * link text that named each one.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const API = "https://services.vallypro.com/v1/";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type VallyproRef = { slug: string; trips: { id: string; name: string | null }[] };

type VpBusiness = {
  _id: string; name: string; slugOrId?: string;
  contact?: { organization?: string; email?: string[]; phone?: string[] } | null;
  imageUrl?: string | null; coverImageUrls?: string[] | null;
  cancellationPolicy?: string | null; orderBeforeHours?: number | null;
  depositType?: string | null; depositPercent?: number | null; depositPrice?: number | null;
};
type VpInstance = {
  activityId: string; offeringId: string; isoDate: string; durationMinutes: number | null; basePrice: number | null;
  groupSizeMultiplier?: number | null; callToBookOnly?: boolean; conditions?: unknown[];
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await safeFetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 15000, maxBytes: 5_000_000 });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const GENERIC_LINK = /^(book( now| online| here| a trip| this trip)?|check (live )?availability|reserve( now)?|schedule|buy|view|learn more|details|more info|click here|availability|online booking|booking)[.!]?$/i;

/** A booking URL or a page of the operator's HTML. Trip ids only appear in /trips/<id> links; folders name nothing. */
export function vallyproRef(bookingUrlOrHtml: string): VallyproRef | null {
  const s = bookingUrlOrHtml;
  const slugs = new Map<string, number>();
  const slugRe = /(?:book\.|www\.)?vallypro\.com\/p\/([a-z0-9][a-z0-9_-]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = slugRe.exec(s))) slugs.set(m[1], (slugs.get(m[1]) || 0) + 1);
  if (!slugs.size) return null;
  const slug = [...slugs.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const trips = new Map<string, string | null>();
  // <a href="...vallypro.com/p/<slug>/trips/<id>...">Half Day Inshore</a>: the link text is the operator's own name for the trip.
  const aRe = /<a\b[^>]*href=["']?[^"'>]*vallypro\.com\/p\/([a-z0-9_-]+)\/trips\/([a-f0-9]{24})[^"'>]*["']?[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(s))) {
    if (m[1] !== slug) continue;
    const text = plain(m[3]).slice(0, 80);
    const name = text && !GENERIC_LINK.test(text) && text.length >= 3 ? text : null;
    if (!trips.has(m[2]) || (name && !trips.get(m[2]))) trips.set(m[2], name);
  }
  const idRe = /vallypro\.com\/p\/([a-z0-9_-]+)\/trips\/([a-f0-9]{24})/gi;
  while ((m = idRe.exec(s))) if (m[1] === slug && !trips.has(m[2])) trips.set(m[2], null);
  return { slug, trips: [...trips.entries()].map(([id, name]) => ({ id, name })) };
}

function hoursLabel(minutes: number): string {
  if (minutes % 60 === 0) return minutes / 60 + (minutes === 60 ? " hour" : " hours");
  if (minutes < 60) return minutes + " min";
  return (minutes / 60).toFixed(1).replace(/\.0$/, "") + " hours";
}

/** Distinct offerings of one trip over this month and next: each (duration, base price) the widget would sell. */
async function tripOfferings(tripId: string): Promise<{ offeringId: string; minutes: number | null; cents: number | null; callToBook: boolean; multiplier: number | null; firstDate: string }[]> {
  const out = new Map<string, { offeringId: string; minutes: number | null; cents: number | null; callToBook: boolean; multiplier: number | null; firstDate: string }>();
  const now = new Date();
  for (let k = 0; k < 2; k++) {
    // The API's month is 0-based like a JS Date: month=9 answers October.
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
    const j = await getJson<{ offerings?: VpInstance[] }>(API + `activities/${encodeURIComponent(tripId)}/offering-instances?mode=instances&year=${d.getUTCFullYear()}&month=${d.getUTCMonth()}`);
    for (const o of j?.offerings || []) {
      if (!o || !o.offeringId) continue;
      const key = o.offeringId + ":" + (o.durationMinutes ?? "") + ":" + (o.basePrice ?? "");
      if (out.has(key)) continue;
      out.set(key, {
        offeringId: o.offeringId,
        minutes: typeof o.durationMinutes === "number" && o.durationMinutes > 0 ? o.durationMinutes : null,
        cents: typeof o.basePrice === "number" && o.basePrice > 0 ? o.basePrice : null,
        callToBook: !!o.callToBookOnly,
        multiplier: typeof o.groupSizeMultiplier === "number" ? o.groupSizeMultiplier : null,
        firstDate: o.isoDate,
      });
    }
    await pause(200);
  }
  return [...out.values()].sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0));
}

export async function readVallypro(ref: VallyproRef): Promise<WidgetResult | null> {
  const biz = await getJson<VpBusiness>(API + "businesses/lookup/" + encodeURIComponent(ref.slug));
  if (!biz?._id || !biz.name) return null;
  const bookUrl = "https://book.vallypro.com/p/" + ref.slug;
  const cover = biz.coverImageUrls?.[0] || biz.imageUrl || null;
  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  let pages = 1;
  for (const trip of ref.trips.slice(0, 20)) {
    const opts = await tripOfferings(trip.id);
    pages += 2;
    if (!opts.length) continue;
    const url = bookUrl + "/trips/" + trip.id;
    for (const o of opts) {
      const dur = o.minutes ? hoursLabel(o.minutes) : null;
      // The operator's own link text names the trip; failing that the trip is known only by its length.
      const name = trip.name || (dur ? dur.replace(/ hours?$/, "-hour") + " trip" : "Charter trip");
      if (o.callToBook && o.cents == null) {
        req.add(`${name}: call to book.`);
        continue;
      }
      offerings.push({
        name,
        detail: opts.length > 1 && dur ? dur : trip.name && dur ? dur : null,
        duration: dur,
        price: o.cents != null ? o.cents / 100 : null,
        // basePrice is the departure's base fare; charters sell the boat, and the widget adds guests through a
        // participant plan we cannot call without posting a booking, so this is the "from" price per trip.
        unit: "/trip",
        url,
        desc: null,
        photo: null,
        photos: [],
      });
    }
  }
  const cancellation = plain(biz.cancellationPolicy).slice(0, 400) || null;
  const mined = mineSentences(plain(biz.cancellationPolicy));
  mined.requirements.forEach((s) => req.add(s));
  mined.policies.forEach((s) => pol.add(s));
  mined.includes.forEach((s) => inc.add(s));
  if (biz.depositType === "percent" && biz.depositPercent && biz.depositPercent > 0 && biz.depositPercent < 100) pol.add(`A ${biz.depositPercent}% deposit is charged when you book; the balance is due to the operator.`);
  else if (biz.depositType === "fixed" && biz.depositPrice && biz.depositPrice > 0) pol.add(`A $${(biz.depositPrice / 100).toFixed(0)} deposit is charged when you book; the balance is due to the operator.`);
  if (biz.orderBeforeHours && biz.orderBeforeHours > 0) pol.add(`Online booking closes ${biz.orderBeforeHours >= 48 ? Math.round(biz.orderBeforeHours / 24) + " days" : biz.orderBeforeHours + " hours"} before departure.`);
  const company: Company = {
    currency: "USD",
    phone: biz.contact?.phone?.[0] || null,
    email: biz.contact?.email?.[0] || null,
    cover,
    cancellation,
  };
  return { vendor: "vallypro", offerings, company, requirements: [...req].slice(0, 10), policies: [...pol].slice(0, 10), includes: [...inc].slice(0, 10), pages };
}

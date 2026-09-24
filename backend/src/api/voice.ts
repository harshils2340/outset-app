import { Hono } from "hono";
import { ID, rateLimit } from "./auth.ts";
import { getAvailability, type Availability } from "../enrich/availability.ts";
import { zonedNow } from "../concierge/shopday.ts";
import { zoneForArea } from "../lib/zone.ts";

/**
 * The phone agent's data endpoints ("Otto on the phone").
 *
 * A voice platform (Vapi, Retell, Bland) owns the phone number, the speech and the turn-taking. It calls these
 * two read-only tools during a call so the agent speaks from the operator's real, published facts and its real
 * calendar, never anything invented: `GET /voice/:operatorId` for who the business is and what it offers, and
 * `GET /voice/:operatorId/availability` for what is actually open. This is what makes the agent book instead of
 * only taking a message, and it reuses the same live-availability readers the listing page already uses.
 *
 * Both sources are the site's own published files, not SQLite: the API host has no operators table (it serves
 * Postgres and the static catalog), so the facts come from the same `o/<id>.json` a listing page reads, fetched
 * over HTTP and cached, exactly as availability already reads live-index.json. Read-only and public, like the
 * availability route: no auth, a per-IP limit, and an honest gap ("not published") rather than a guess. It never
 * books or charges; the booking link is handed back for a later step, so nothing on a call moves money on its own.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 30;
const SITE = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/");
const CACHE_TTL_MS = 10 * 60 * 1000;

export const voice = new Hono();

type Listing = {
  id: string;
  title?: string;
  area?: string;
  blurb?: string;
  from?: number;
  dur?: string;
  options?: { name: string; detail?: string | null; price?: number | null }[];
  services?: { name: string; variants?: { label?: string; price?: number | null }[] }[];
  includes?: string[];
  requirements?: string[];
  policies?: string[];
  cancellation?: string;
  hoursText?: string[];
  fc?: string;
  lat?: number | null;
  lon?: number | null;
  affiliate?: { label: string; url: string } | null;
  contact?: { phone?: string; website?: string; hours?: string[] } | null;
};

const cache = new Map<string, { at: number; value: Listing | null }>();

/**
 * The published listing record, the same `o/<id>.json` a listing page reads, fetched over HTTP and cached.
 *
 * Only an answer is cached. A 404 is the site saying there is no such listing and is worth remembering; a
 * timeout, a reset or a 502 is the site saying nothing at all, and caching that as "not found" took one blip
 * and turned it into ten minutes of the phone agent telling callers it has never heard of the business.
 */
async function listing(id: string): Promise<Listing | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  try {
    const res = await fetch(`${SITE}o/${encodeURIComponent(id)}.json`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (res.ok) {
      const value = (await res.json()) as Listing;
      cache.set(id, { at: Date.now(), value });
      return value;
    }
    if (res.status >= 500) return null;
  } catch {
    return null;
  }
  cache.set(id, { at: Date.now(), value: null });
  return null;
}

/** A zero is a price the crawler could not read, not a free trip, so it is said as no price, as everywhere else. */
const money = (n: number | null | undefined): string | null => (typeof n === "number" && n > 0 ? "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : null);

/** The bookable lines a guest picks from: plain options, or the first priced variant of each service. */
function offersOf(l: Listing): { name: string; detail: string | null; price: string | null }[] {
  if (l.options?.length) return l.options.map((o) => ({ name: o.name, detail: o.detail || null, price: money(o.price) }));
  if (l.services?.length) return l.services.map((s) => ({ name: s.name, detail: (s.variants?.[0]?.label && s.variants[0].label !== "Standard" ? s.variants[0].label : null) || null, price: money(s.variants?.[0]?.price) }));
  return [];
}

/**
 * What the business starts at, the way `fromPrice` in `src/lib/catalog.ts` works it out for a card: the
 * cheapest priced line on the menu, and only the crawled `from` when nothing on the menu carries a price.
 *
 * This route read `from` and nothing else, and `from` is written on partner rows only: no operator listing in
 * the shipped catalog has one. So "what do you charge?", the question a caller asks before any other, was
 * answered with nothing on all 46,324 of them, 10,209 of which publish a priced menu.
 */
function fromPriceOf(l: Listing): number | null {
  const priced = [
    ...(l.options || []).map((o) => o.price),
    ...(l.services || []).flatMap((s) => (s.variants || []).map((v) => v.price)),
  ].filter((n): n is number => typeof n === "number" && n > 0);
  return priced.length ? Math.min(...priced) : l.from ?? null;
}

/**
 * A partner's product is not a business with a phone.
 *
 * `backend/AGENTS.md`: "An affiliate row is never an operator: no claim link, no outreach, no Instant Book,
 * no request, no Otto." Otto is sold to an operator to answer that operator's own calls, and a Viator row is
 * a product listed under licence with no operator behind it on our side: its photos, descriptions, prices and
 * calendar are the partner's, shown on a page that says so and books on their site. Served here, those facts
 * would be read out on a call with none of that, so the route refuses for the same reason and in the same
 * words the booking route already refuses one.
 */
function partnerRefusal(l: Listing): string | null {
  return l.affiliate ? "This experience is booked on " + (l.affiliate.label || "the partner's site") + ", not on Outset, so it has no Outset phone agent" : null;
}

voice.get("/voice/:operatorId", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("operatorId") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const l = await listing(id);
  if (!l || !l.title) return c.json({ error: "not found" }, 404);
  const no = partnerRefusal(l);
  if (no) return c.json({ error: no }, 409);

  // Only what is published on the listing. A missing field is said as missing so the agent offers to have a
  // person confirm, exactly as the on-page assistant does, rather than inventing an answer on a live call.
  const hours = l.hoursText?.length ? l.hoursText : l.contact?.hours || [];
  return c.json({
    business: {
      id: l.id,
      name: l.title,
      where: l.area || null,
      about: l.blurb || null,
      offers: offersOf(l),
      fromPrice: money(fromPriceOf(l)),
      duration: l.dur || null,
      hours: hours.length ? hours : null,
      includes: (l.includes || []).slice(0, 12),
      requirements: (l.requirements || []).slice(0, 12),
      policies: (l.policies || []).length ? (l.policies || []).slice(0, 8) : null,
      cancellation: l.cancellation || null,
      freeCancellation: !!l.fc,
      phone: l.contact?.phone || null,
      // Where a booking is completed. Only ever our own listing: a partner's product never reaches here.
      bookingUrl: `${SITE}#o=${encodeURIComponent(l.id)}`,
    },
    speak: {
      onlyPublishedFacts: true,
      whenUnknown: "Say you will have someone from the business confirm, and take a name and number. Never guess a price, a time, an age rule or availability.",
      offTopic: "Politely decline weather, directions, comparisons with other businesses, and anything not about this business, and offer to pass the caller to a person.",
    },
  });
});

/**
 * The departures a voice agent may read out, on the shop's own clock.
 *
 * `src/lib/liveTimes.ts` drops four kinds of row before a guest ever sees a chip on the page, and the phone
 * agent has to drop the same four or it says out loud what the page refuses to print:
 *
 *  - a `timeUnknown` marker row, which exists only to say the date is open. Its `startsAt` carries a midnight
 *    that means nothing, so passing it through had the agent offering a caller a trip at 00:00.
 *  - a departure the vendor says has no seats left.
 *  - a price of nothing, which is a vendor that stated no price, not a free trip.
 *  - a departure that has already left. The page asks this on the shop's clock; this route asked it on
 *    nobody's, defaulting `from` to the host's UTC date, so from early evening Eastern it skipped the rest of
 *    tonight entirely and every morning it offered departures that sailed hours ago.
 */
export function speakableDays(av: Availability, zone: string | null, now: Date = new Date()): { date: string; times: { at: string; label: string; price: string | null; seatsLeft: number | null; bookUrl: string }[] }[] {
  const here = zonedNow(zone, now);
  const out: { date: string; times: { at: string; label: string; price: string | null; seatsLeft: number | null; bookUrl: string }[] }[] = [];
  for (const d of av.days || []) {
    if (!d?.date || d.date < here.date) continue;
    const times = [];
    for (const s of d.slots || []) {
      if (s.timeUnknown) continue;
      if (typeof s.seatsLeft === "number" && s.seatsLeft <= 0) continue;
      const clock = /T(\d{2}):(\d{2})/.exec(s.startsAt || "");
      if (!clock) continue;
      if (d.date === here.date && Number(clock[1]) * 60 + Number(clock[2]) <= here.minutes) continue;
      times.push({
        at: `${clock[1]}:${clock[2]}`,
        label: s.label,
        price: typeof s.priceCents === "number" && s.priceCents > 0 ? "$" + (s.priceCents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) : null,
        seatsLeft: typeof s.seatsLeft === "number" ? s.seatsLeft : null,
        bookUrl: s.bookUrl,
      });
      if (times.length === 12) break;
    }
    if (times.length) out.push({ date: d.date, times });
  }
  return out;
}

voice.get("/voice/:operatorId/availability", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("operatorId") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const fromRaw = String(c.req.query("from") ?? "").trim();
  if (fromRaw && (!DATE.test(fromRaw) || Number.isNaN(Date.parse(fromRaw + "T00:00:00Z")))) return c.json({ error: "from must be YYYY-MM-DD" }, 400);
  // The shop's own zone, from the same published record the facts route reads, so "today" is today there.
  const l = await listing(id);
  const no = l ? partnerRefusal(l) : null;
  if (no) return c.json({ error: no }, 409);
  const zone = zoneForArea(l?.area, l?.lat, l?.lon);
  const from = fromRaw || zonedNow(zone).date;
  const days = Math.min(Math.max(Number(c.req.query("days")) || 14, 1), MAX_DAYS);

  const av = await getAvailability(id, from, days);
  // A speakable line for the agent, not the internal reason: when the calendar is not connected, the agent
  // should offer to have a person confirm the time and take a callback, never guess.
  if (!av.live) return c.json({ live: false, note: "This business's calendar is not connected, so a person confirms the time. Offer to take a name and number.", days: [] });

  const openDays = speakableDays(av, zone);

  return c.json({ live: true, vendor: av.vendor, from, days: openDays, partial: av.partial || false, note: openDays.length ? null : "Nothing is open in this window; offer another date or take a callback." });
});

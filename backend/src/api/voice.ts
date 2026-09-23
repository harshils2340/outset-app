import { Hono } from "hono";
import { ID, rateLimit } from "./auth.ts";
import { getAvailability } from "../enrich/availability.ts";

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
  affiliate?: { label: string; url: string } | null;
  contact?: { phone?: string; website?: string; hours?: string[] } | null;
};

const cache = new Map<string, { at: number; value: Listing | null }>();

/** The published listing record, the same `o/<id>.json` a listing page reads, fetched over HTTP and cached. */
async function listing(id: string): Promise<Listing | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  let value: Listing | null = null;
  try {
    const res = await fetch(`${SITE}o/${encodeURIComponent(id)}.json`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (res.ok) value = (await res.json()) as Listing;
  } catch {
    value = null;
  }
  cache.set(id, { at: Date.now(), value });
  return value;
}

const money = (n: number | null | undefined): string | null => (typeof n === "number" ? "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : null);

/** The bookable lines a guest picks from: plain options, or the first priced variant of each service. */
function offersOf(l: Listing): { name: string; detail: string | null; price: string | null }[] {
  if (l.options?.length) return l.options.map((o) => ({ name: o.name, detail: o.detail || null, price: money(o.price) }));
  if (l.services?.length) return l.services.map((s) => ({ name: s.name, detail: (s.variants?.[0]?.label && s.variants[0].label !== "Standard" ? s.variants[0].label : null) || null, price: money(s.variants?.[0]?.price) }));
  return [];
}

voice.get("/voice/:operatorId", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("operatorId") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const l = await listing(id);
  if (!l || !l.title) return c.json({ error: "not found" }, 404);

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
      fromPrice: money(l.from),
      duration: l.dur || null,
      hours: hours.length ? hours : null,
      includes: (l.includes || []).slice(0, 12),
      requirements: (l.requirements || []).slice(0, 12),
      policies: (l.policies || []).length ? (l.policies || []).slice(0, 8) : null,
      cancellation: l.cancellation || null,
      freeCancellation: !!l.fc,
      phone: l.contact?.phone || null,
      // Where a booking is completed: the partner's page for an affiliate product, otherwise the Outset listing.
      bookingUrl: l.affiliate?.url || `${SITE}#o=${encodeURIComponent(l.id)}`,
      bookedElsewhere: l.affiliate ? l.affiliate.label : null,
    },
    speak: {
      onlyPublishedFacts: true,
      whenUnknown: "Say you will have someone from the business confirm, and take a name and number. Never guess a price, a time, an age rule or availability.",
      offTopic: "Politely decline weather, directions, comparisons with other businesses, and anything not about this business, and offer to pass the caller to a person.",
    },
  });
});

voice.get("/voice/:operatorId/availability", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("operatorId") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const fromRaw = String(c.req.query("from") ?? "").trim();
  if (fromRaw && (!DATE.test(fromRaw) || Number.isNaN(Date.parse(fromRaw + "T00:00:00Z")))) return c.json({ error: "from must be YYYY-MM-DD" }, 400);
  const from = fromRaw || new Date().toISOString().slice(0, 10);
  const days = Math.min(Math.max(Number(c.req.query("days")) || 14, 1), MAX_DAYS);

  const av = await getAvailability(id, from, days);
  // A speakable line for the agent, not the internal reason: when the calendar is not connected, the agent
  // should offer to have a person confirm the time and take a callback, never guess.
  if (!av.live) return c.json({ live: false, note: "This business's calendar is not connected, so a person confirms the time. Offer to take a name and number.", days: [] });

  const openDays = av.days
    .filter((d) => d.slots.length)
    .map((d) => ({
      date: d.date,
      times: d.slots.slice(0, 12).map((s) => ({
        at: s.startsAt.slice(11),
        label: s.label,
        price: typeof s.priceCents === "number" ? "$" + (s.priceCents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) : null,
        seatsLeft: typeof s.seatsLeft === "number" ? s.seatsLeft : null,
        bookUrl: s.bookUrl,
      })),
    }));

  return c.json({ live: true, vendor: av.vendor, from, days: openDays, partial: av.partial || false, note: openDays.length ? null : "Nothing is open in this window; offer another date or take a callback." });
});

import { Hono } from "hono";
import { ID, rateLimit } from "./auth.ts";
import { db } from "../db/client.ts";
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
 * Read-only and public, like the availability route: no auth, a per-IP limit, and it states an honest gap
 * ("not published") rather than guessing. It never books or charges; the booking link is handed back for the
 * platform to send, or for a later step to complete, so nothing on a call moves money on its own.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 30;

export const voice = new Hono();

type OpRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  website: string | null;
  phone: string | null;
  hours: string | null;
  booking_mode: string | null;
};
type Offering = { name: string; detail: string | null; duration: string | null; price_cents: number | null; price_unit: string | null; currency: string | null };
type Fact = { fact_key: string; fact_value: string };

const money = (cents: number | null, unit: string | null, currency: string | null): string | null => {
  if (cents == null) return null;
  const cur = currency && currency.toUpperCase() !== "USD" ? currency.toUpperCase() + " " : "$";
  return cur + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) + (unit ? " " + unit : "");
};

voice.get("/voice/:operatorId", rateLimit(120, 60 * 60 * 1000), (c) => {
  const id = String(c.req.param("operatorId") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const op = db.prepare("SELECT id, name, city, region, country, website, phone, hours, booking_mode FROM operators WHERE id = ?").get(id) as OpRow | undefined;
  if (!op) return c.json({ error: "not found" }, 404);

  const offerings = db.prepare("SELECT name, detail, duration, price_cents, price_unit, currency FROM offerings WHERE operator_id = ? ORDER BY price_cents IS NULL, price_cents").all(id) as Offering[];
  const facts = db.prepare("SELECT fact_key, fact_value FROM facts WHERE operator_id = ?").all(id) as Fact[];
  const factOf = (key: string): string | null => facts.find((f) => f.fact_key === key)?.fact_value ?? null;
  const factsAll = (key: string): string[] => facts.filter((f) => f.fact_key === key).map((f) => f.fact_value).filter(Boolean);
  const bookingUrl = factOf("booking_url") || op.website;
  const policies = factsAll("policy");

  // Only what an operator has actually published. A missing field is said as missing so the agent offers to have
  // a person confirm, exactly as the on-page assistant does, rather than inventing an answer on a live call.
  return c.json({
    business: {
      id: op.id,
      name: op.name,
      where: [op.city, op.region].filter(Boolean).join(", ") || null,
      offers: offerings.map((o) => ({ name: o.name, detail: o.detail || null, duration: o.duration || null, price: money(o.price_cents, o.price_unit, o.currency) })),
      hours: op.hours || null,
      about: factOf("description") || factOf("site_desc") || factOf("one_line"),
      includes: factsAll("includes").slice(0, 12),
      requirements: factsAll("requirement").slice(0, 12),
      policies: policies.length ? policies.slice(0, 8) : null,
      phone: op.phone || null,
      bookingUrl: bookingUrl || null,
      instantBook: op.booking_mode === "instant",
    },
    // The rules the platform's system prompt should hold the agent to, returned so the two stay in sync.
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
  // A speakable line for the agent, not the internal reason ("no booking url"): when the calendar is not
  // connected, the agent should offer to have a person confirm the time and take a callback, never guess.
  if (!av.live) return c.json({ live: false, note: "This business's calendar is not connected, so a person confirms the time. Offer to take a name and number.", days: [] });

  // Compact and speakable: the open days, and each day's start times with price and seats where the vendor gives
  // them. The full booking URL rides along so the platform can text it or a later step can complete the booking.
  const openDays = av.days
    .filter((d) => d.slots.length)
    .map((d) => ({
      date: d.date,
      times: d.slots.slice(0, 12).map((s) => ({
        at: s.startsAt.slice(11),
        label: s.label,
        price: typeof s.priceCents === "number" ? money(s.priceCents) : null,
        seatsLeft: typeof s.seatsLeft === "number" ? s.seatsLeft : null,
        bookUrl: s.bookUrl,
      })),
    }));

  return c.json({ live: true, vendor: av.vendor, from, days: openDays, partial: av.partial || false, note: openDays.length ? null : "Nothing is open in this window; offer another date or take a callback." });
});

import { Hono } from "hono";
import { ID, rateLimit } from "./auth.ts";
import { getAvailability } from "../enrich/availability.ts";
import { zonedNow } from "../concierge/shopday.ts";
import { zoneOf } from "./openSlots.ts";

/**
 * The operator's real calendar, for the guest.
 *
 * When a listing's booking URL points at FareHarbor, Peek or Xola, their public feeds say exactly which
 * dates and times that operator is open, how many seats are left, and where the booking flow starts. This
 * route reads that live (cached ten minutes, three upstream calls at most) so the listing page can show
 * real departures instead of our generic slot guesses.
 *
 * It answers `{ live: false }` for everything else, an operator on another booking system, a vendor that
 * is down, a listing we cannot resolve, and the page keeps whatever it showed before. CORS and the
 * response headers come from the app-wide middleware in routes.ts; this is a public, read-only route, so
 * there is no auth, only a per-IP limit.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 60;

export const availability = new Hono();

/**
 * The day the window opens on: the date the caller named, else today where the shop is.
 *
 * `render.yaml` sets no TZ for `outset-api`, so the container's clock is UTC and this route defaulted to UTC's
 * own date: from eight in the evening Eastern, five in the afternoon Pacific, a caller that named no date was
 * answered about tomorrow and lost the rest of tonight. Every surface in the app passes `from` off the guest's
 * own clock, so no guest met it; the route's documented default did. `GET /voice/:id/availability` carries the
 * same fix and `openSlots` reads the same zone, so all three now open on the shop's own day.
 */
export async function windowStart(id: string, fromRaw: string, now: Date = new Date()): Promise<string> {
  if (fromRaw) return fromRaw;
  return zonedNow(await zoneOf(id).catch(() => null), now).date;
}

availability.get("/availability/:operatorId", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("operatorId") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);

  const fromRaw = String(c.req.query("from") ?? "").trim();
  if (fromRaw && (!DATE.test(fromRaw) || Number.isNaN(Date.parse(fromRaw + "T00:00:00Z")))) return c.json({ error: "from must be YYYY-MM-DD" }, 400);
  const from = await windowStart(id, fromRaw);

  const daysRaw = String(c.req.query("days") ?? "").trim();
  if (daysRaw && !/^\d{1,3}$/.test(daysRaw)) return c.json({ error: "days must be a number" }, 400);
  const days = Math.min(Math.max(Number(daysRaw || 14), 1), MAX_DAYS);

  // getAvailability never throws and does its own ten-minute caching, so this is a plain read.
  return c.json(await getAvailability(id, from, days));
});

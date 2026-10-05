import { Hono } from "hono";
import { ID, rateLimit } from "./auth.ts";
import { getAvailability, type Availability } from "../enrich/availability.ts";
import { zonedNow } from "../concierge/shopday.ts";
import { zoneForArea } from "../lib/zone.ts";
import { getProfile } from "../lib/repo.ts";
import { openSlots } from "./openSlots.ts";
import { pgConfigured } from "../db/pg.ts";
import { bookingPause, type StoredProfile } from "./profiles.ts";
import { splitIncluded } from "../../../src/lib/listingDerive.ts";

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
 * How many listings the facts cache holds at once.
 *
 * Both routes are public and take the id out of the path, so the key is whatever the caller asked about, and a
 * miss is remembered as well as an answer. Unbounded, that is one entry per distinct id for the life of the
 * process, and nothing ever leaves: the per-IP limit holds any one caller to 120 an hour, which bounds how
 * fast it grows and not how far, since `ID` allows any 3 to 80 characters of a-z, 0-9 and - and the limit is
 * per address. Every other cache in this API is capped, and this was the one that was not: `otto.ts` at 500
 * oldest-first (the rule copied here), `openSlots.ts` and `enrich/availability.ts` at 5,000, the concierge's
 * sessions at 500 and its live reads at 400. 500 is far more than the businesses with a number pointed at the
 * agent, and a ten-minute entry costs one fetch to rebuild.
 */
const CACHE_MAX = 500;

/** Remember one answer, oldest out first once the cache is full. */
function remember(id: string, value: Listing | null): void {
  if (!cache.has(id) && cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(id, { at: Date.now(), value });
}

/** For tests: the cache is per process, so a test that fills it would reach the next one. */
export function resetVoiceCacheForTests(): void {
  cache.clear();
}

/** For tests: how many listings are remembered right now. */
export function voiceCacheSize(): number {
  return cache.size;
}

/**
 * Whether a status that is not ok is the site saying there is no such listing, which is worth remembering for
 * the ten minutes below, or the site saying nothing at all, which is not.
 *
 * Only 404 and 410 are the first kind: a static host answers 404 for a file it does not have, and 410 for one
 * it has withdrawn. Everything else is the question not getting through. The site sits behind Cloudflare (see
 * `clientIp` in api/auth.ts), so this API host asking for a listing can be answered 403 by a bot challenge,
 * 429 by a rate limit, or 408 when the edge gives up, and none of those is evidence about the listing. Reading
 * them as "no such listing" is the blip the comment below was written about, closed for 5xx and left open for
 * every 4xx: one Cloudflare challenge and the phone agent tells every caller for the next ten minutes that it
 * has never heard of the business, and `/voice/:id/availability` refuses them for the same ten minutes.
 */
export function remembersMiss(status: number): boolean {
  return status === 404 || status === 410;
}

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
      remember(id, value);
      return value;
    }
    if (!remembersMiss(res.status)) return null;
  } catch {
    return null;
  }
  remember(id, null);
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
/**
 * The operator's own edits, over the nightly file.
 *
 * `o/<id>.json` is written by the nightly sync. A claimed shop's live facts are its dashboard patch, which is
 * what `GET /profiles/:id` hands the listing page so a price or an hours change shows a guest at once. This
 * route read the nightly file alone, and the shops Otto is sold to are exactly the claimed ones: an operator
 * who put their prices up in the morning had their own phone agent quoting yesterday's all day, along with
 * yesterday's menu, hours, policies, cancellation line and even the business name.
 *
 * The two switches come with it. The booking API refuses a booking for a listing whose owner has it hidden or
 * has paused bookings, so a caller sent to that link is turned away at the end of it.
 */
export function applyEdits(l: Listing, rec: StoredProfile | null): { listing: Listing; takingBookings: boolean } {
  if (!rec) return { listing: l, takingBookings: true };
  // An array is an object, and a patch stored as one would spread as numbered keys over the whole record.
  const patch = rec.patch && typeof rec.patch === "object" && !Array.isArray(rec.patch) ? (rec.patch as Partial<Listing> & { accepting?: boolean }) : null;
  // The same two switches the booking route refuses on, read by the same rule, so the agent and the route
  // cannot disagree about whether a caller may be sent to a booking page.
  return { listing: patch ? { ...l, ...patch } : l, takingBookings: !bookingPause(rec) };
}

async function withOperatorEdits(l: Listing): Promise<{ listing: Listing; takingBookings: boolean }> {
  // An unclaimed shop has no row, and a host with no store has no rows at all: the nightly file is stale
  // rather than wrong, so a live call is never failed over this, the agent just speaks from the file.
  if (!pgConfigured()) return { listing: l, takingBookings: true };
  try {
    return applyEdits(l, await getProfile<StoredProfile>(l.id));
  } catch (e) {
    console.error(`[voice] could not read the profile for ${l.id}: ${(e as Error).message}`);
    return { listing: l, takingBookings: true };
  }
}

/**
 * What the agent is told when the operator's own Published or Accepting switch is down.
 *
 * One sentence in one place, because the two routes here have to agree about it. The facts route said "take a
 * name and number" while the availability route beside it read the shop's vendor calendar out, departure by
 * departure, each with its own booking link, having never looked at either switch.
 */
export const PAUSED_NOTE =
  "This business is not taking bookings through Outset right now. Take a name and number instead of offering a time or sending the caller to a booking page.";

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
  const { listing: shop, takingBookings } = await withOperatorEdits(l);

  // Only what is published on the listing. A missing field is said as missing so the agent offers to have a
  // person confirm, exactly as the on-page assistant does, rather than inventing an answer on a live call.
  const hours = shop.hoursText?.length ? shop.hoursText : shop.contact?.hours || [];
  const included = splitIncluded(shop.includes || []);
  return c.json({
    business: {
      id: shop.id,
      name: shop.title,
      where: shop.area || null,
      about: shop.blurb || null,
      offers: offersOf(shop),
      fromPrice: money(fromPriceOf(shop)),
      duration: shop.dur || null,
      hours: hours.length ? hours : null,
      // Through the split every other surface draws. Read raw, a voice agent read the shop's own exclusions out
      // as things the price covers: 5,263 shipped listings publish one here ("Gratuities", "Lunch (not
      // included)", "Snacks available for purchase"), and on a call there is no second column to read instead.
      includes: included.yes.slice(0, 12),
      notIncluded: included.no.length ? included.no.map((n) => n.text).slice(0, 12) : null,
      requirements: (shop.requirements || []).slice(0, 12),
      policies: (shop.policies || []).length ? (shop.policies || []).slice(0, 8) : null,
      cancellation: shop.cancellation || null,
      freeCancellation: !!shop.fc,
      phone: shop.contact?.phone || null,
      // Where a booking is completed. Only ever our own listing: a partner's product never reaches here. Null
      // while the owner has the listing hidden or has paused bookings, because the booking API refuses both,
      // so a caller sent to that link is turned away at the end of it.
      takingBookings,
      bookingUrl: takingBookings ? `${SITE}activities#o=${encodeURIComponent(shop.id)}` : null,
      bookingNote: takingBookings ? null : PAUSED_NOTE,
    },
    speak: {
      onlyPublishedFacts: true,
      whenUnknown: "Say you will have someone from the business confirm, and take a name and number. Never guess a price, a time, an age rule or availability.",
      offTopic: "Politely decline weather, directions, comparisons with other businesses, and anything not about this business, and offer to pass the caller to a person.",
    },
  });
});

export type SpeakableTime = { at: string; label: string; price: string | null; seatsLeft: number | null; bookUrl: string };
export type SpeakableDay = { date: string; times: SpeakableTime[] };

/**
 * The departures a voice agent may read out, on the shop's own clock, and the open dates it must not call shut.
 *
 * `src/lib/liveTimes.ts` drops four kinds of row before a guest ever sees a chip on the page, and the phone
 * agent has to drop the same four or it says out loud what the page refuses to print:
 *
 *  - a `timeUnknown` marker row, which exists only to say the date is open. Its `startsAt` carries a midnight
 *    that means nothing, so passing it through had the agent offering a caller a trip at 00:00.
 *  - a departure the vendor says has no seats left.
 *  - a departure whose clock we cannot read, which now includes one out of range: the page's own `clockOf`
 *    refuses an hour past 23 and a minute past 59, and this was the one reader that would have read a
 *    vendor's "T25:00" out to a caller as a quarter past one in the morning.
 *  - a departure that has already left. The page asks this on the shop's clock; this route asked it on
 *    nobody's, defaulting `from` to the host's UTC date, so from early evening Eastern it skipped the rest of
 *    tonight entirely and every morning it offered departures that sailed hours ago.
 *
 * Dropping the first and third kinds silently is what made the route lie. `liveTimes.ts` keeps those dates as
 * `unread`, because a date the vendor says is open and whose clock times we never got to is the opposite of a
 * date the shop is shut, and the page prints "Their booking system has not listed times for this date" on it.
 * Here they simply vanished, so the agent had no way to tell them from a closed day and said the business had
 * nothing on. That is the common case rather than the rare one: Peek answers which dates are open in one call
 * and a date's times in another, and the call budget stops after the first two or three, and every reader
 * behind `fromConcierge` stops at the first day an activity has something free. 250 of the 1,911 shipped
 * booking links are the second kind and 239 are Peek.
 */
export function speakableRead(av: Availability, zone: string | null, now: Date = new Date()): { days: SpeakableDay[]; unread: string[] } {
  const here = zonedNow(zone, now);
  const days: SpeakableDay[] = [];
  const unread: string[] = [];
  for (const d of av.days || []) {
    if (!d?.date || d.date < here.date) continue;
    const times: SpeakableTime[] = [];
    /** Whether anything on this date said the shop has something on without saying when. */
    let lost = false;
    for (const s of d.slots || []) {
      if (s.timeUnknown) {
        lost = true;
        continue;
      }
      if (typeof s.seatsLeft === "number" && s.seatsLeft <= 0) continue;
      const clock = /T(\d{2}):(\d{2})/.exec(s.startsAt || "");
      const hour = clock ? Number(clock[1]) : 0;
      const minute = clock ? Number(clock[2]) : 0;
      if (!clock || hour > 23 || minute > 59) {
        // A departure we cannot put a clock on is a vendor shape we do not understand, not a closed shop.
        lost = true;
        continue;
      }
      if (d.date === here.date && hour * 60 + minute <= here.minutes) continue;
      times.push({
        at: `${clock[1]}:${clock[2]}`,
        label: s.label,
        price: typeof s.priceCents === "number" && s.priceCents > 0 ? "$" + (s.priceCents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) : null,
        seatsLeft: typeof s.seatsLeft === "number" ? s.seatsLeft : null,
        bookUrl: s.bookUrl,
      });
      if (times.length === 12) break;
    }
    if (times.length) days.push({ date: d.date, times });
    else if (lost) unread.push(d.date);
  }
  return { days, unread };
}

/** The departures alone, for a caller with no use for the dates we could not time. */
export function speakableDays(av: Availability, zone: string | null, now: Date = new Date()): SpeakableDay[] {
  return speakableRead(av, zone, now).days;
}

/**
 * The line the agent speaks about the window as a whole.
 *
 * "Nothing is open in this window" is only ever true of a read that covered the window. `liveEmptyNote` in
 * `src/lib/liveTimes.ts` keeps that rule for the page and this route kept none of it: it said those words
 * whenever no departure came back, on a read the vendor had answered in part, and on a shop whose every open
 * date arrived as a marker row. A phone agent speaking that sentence tells a caller the business is shut for a
 * fortnight while its own booking system says the opposite, which is the one thing an operator who bought Otto
 * cannot have it do.
 */
export function windowNote(days: SpeakableDay[], unread: string[], partial: boolean): string | null {
  if (!days.length) {
    return unread.length || partial
      ? "Their booking system has not listed times for this window, so this is not the whole picture: do not say the business is closed or has nothing open. Offer to have someone confirm a time, and take a name and number."
      : "Nothing is open in this window; offer another date or take a callback.";
  }
  return unread.length
    ? "These are the dates whose times their booking system listed. The dates under `unread` are open and their times are not listed, so do not say the business is closed on those."
    : null;
}

/**
 * The shop's own calendar on Outset, which for almost every shop that claims is the only calendar it has.
 *
 * This route read one source, `getAvailability`, which is a third-party booking system and nothing else. Only
 * 1,911 of the 46,324 shipped operator listings publish a link to one, so for roughly nineteen shops in twenty
 * the vendor read came back with no booking url, and the agent told every caller "this business's calendar is
 * not connected, so a person confirms the time" while the listing page beside it was taking instant bookings
 * off the hours the operator had typed into their dashboard that morning. That is the one thing an operator who
 * bought a booking agent cannot have it say, and the on-page assistant has never said it: it reads
 * `GET /bookings/open/:listing`, the same calendar this now reads.
 *
 * Only a claimed shop's own slots are real, which is the same exception `liveWins` in `src/lib/liveTimes.ts`
 * makes for both pickers and calls `sellsItsOwn`. For an unclaimed listing the same call answers with our fixed
 * nine, eleven and one, minus the hours its own website says it is shut, and that is a guess: `AGENTS.md` is
 * explicit that the agent may never invent an open slot, so `claimed` is the gate. The Published and Accepting
 * switches, the notice period, the booking window, the days off, the blocked slots, the shop's own zone and the
 * seats already sold are all inside that call, so what comes back is bookable rather than merely open.
 */
export function speakableOwn(own: { claimed: boolean; days: { date: string; slots: string[] }[] }, id: string): SpeakableDay[] | null {
  if (!own.claimed) return null;
  // Where the booking is completed, which is the same page the facts route hands over as `bookingUrl`.
  const bookUrl = `${SITE}activities#o=${encodeURIComponent(id)}`;
  return own.days
    .filter((d) => d.slots.length)
    .map((d) => ({
      date: d.date,
      // A time on our own calendar has no trip name to carry and no price until the caller picks a service off
      // the menu the facts route already handed over, so it is said as the clock and nothing else. Twelve a
      // date, the same ceiling a vendor's departures get.
      times: d.slots.slice(0, 12).map((at) => ({ at, label: at, price: null, seatsLeft: null, bookUrl })),
    }));
}

async function ownCalendar(id: string, from: string, days: number): Promise<SpeakableDay[] | null> {
  try {
    return speakableOwn(await openSlots(id, from, days), id);
  } catch (e) {
    console.error(`[voice] could not read the Outset calendar for ${id}: ${(e as Error).message}`);
    return null;
  }
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

  // The dashboard's Published and Accepting switches, which the facts route beside this one has always read
  // and this one never did. An operator who hid their listing or paused bookings had their vendor calendar
  // read out to callers here, departure by departure and each with its own booking link, while the same agent
  // was told by the other route to take a name and number instead. Read before the vendor is called at all,
  // because there is nothing to do with the answer.
  const gate = l ? await withOperatorEdits(l) : null;
  if (gate && !gate.takingBookings) return c.json({ live: false, takingBookings: false, note: PAUSED_NOTE, days: [] });

  const av = await getAvailability(id, from, days);
  const read = av.live ? speakableRead(av, zone) : { days: [] as SpeakableDay[], unread: [] as string[] };

  // The page's own rule, `liveWins` in src/lib/liveTimes.ts: the vendor's answer stands unless it came back
  // with nothing and this shop sells its own slots here, because the booking link in the catalog can predate
  // the claim and an empty fortnight on a stale one must not empty a calendar the shop is taking bookings on.
  if (!read.days.length) {
    const own = await ownCalendar(id, from, days);
    if (own) {
      return c.json({
        live: true,
        vendor: "outset",
        from,
        days: own,
        partial: false,
        unread: [],
        note: own.length ? null : "Nothing is open in this window; offer another date or take a callback.",
      });
    }
  }

  // A speakable line for the agent, not the internal reason: when the calendar is not connected, the agent
  // should offer to have a person confirm the time and take a callback, never guess.
  if (!av.live) return c.json({ live: false, note: "This business's calendar is not connected, so a person confirms the time. Offer to take a name and number.", days: [] });

  return c.json({
    live: true,
    vendor: av.vendor,
    from,
    days: read.days,
    partial: av.partial || false,
    // Open dates whose clock times their booking system never listed, kept apart from the shut ones the way
    // the guest's own picker keeps them apart.
    unread: read.unread,
    note: windowNote(read.days, read.unread, !!av.partial),
  });
});

import { db } from "../db/client.ts";
import { CATEGORIES, METROS, inferCategory } from "../taxonomy/catalog.ts";
import { fareharborLive, type Departure } from "./live.ts";

/**
 * One sentence in, real bookable options out.
 *
 * "escape room in kitchener tonight for 4" has four things in it: what, where, when and how many. None of them
 * arrive in fields, so they are read out of the sentence, matched against the catalog, and then the shortlist
 * is checked against each shop's own booking system so the times and prices we quote are theirs and current.
 *
 * Shops with a booking system we can read come first. A guest does not care which of the three fulfilment
 * routes their booking took, but they do care whether we can tell them a time, so the ones we can answer for
 * are the ones we offer.
 */

export type Intent = {
  text: string;
  categoryId: string | null;
  categoryLabel: string | null;
  city: string | null;
  region: string | null;
  party: number;
  when: "today" | "tonight" | "tomorrow" | "weekend" | "any";
  maxPerPerson: number | null;
};

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, couple: 2 };

/** What, where, when and how many, out of a sentence a person actually typed. */
export function readIntent(text: string): Intent {
  const t = text.toLowerCase();

  // How many. "for 4", "4 of us", "party of six", "me and my dad" is two.
  let party = 2;
  const m =
    t.match(/\bfor\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/) ||
    t.match(/\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:of us|people|persons|adults|guests|players|pax)\b/) ||
    t.match(/\bparty of\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (m) party = Number(m[1]) || NUM_WORDS[m[1]] || 2;
  else if (/\b(me and my|my partner and i|just us two|date night)\b/.test(t)) party = 2;

  // Budget, per head unless it says otherwise.
  const b = t.match(/\bunder\s*\$?\s*(\d{1,4})|\bless than\s*\$?\s*(\d{1,4})|\$\s?(\d{1,4})\s*(?:or less|max|budget)/);
  const maxPerPerson = b ? Number(b[1] || b[2] || b[3]) : null;

  // When.
  const when: Intent["when"] = /\btonight\b/.test(t)
    ? "tonight"
    : /\btomorrow\b/.test(t)
      ? "tomorrow"
      : /\btoday\b|\bright now\b|\bthis afternoon\b/.test(t)
        ? "today"
        : /\bweekend\b|\bsaturday\b|\bsunday\b/.test(t)
          ? "weekend"
          : "any";

  // Where: a city we actually hold operators in beats a metro name, because guests say "kitchener" not "toronto".
  let city: string | null = null;
  let region: string | null = null;
  const cityRow = db
    .prepare(
      `SELECT city, region, COUNT(*) AS n FROM operators
        WHERE city IS NOT NULL AND length(city) >= 4 AND instr(?, lower(city)) > 0
        GROUP BY lower(city), region ORDER BY n DESC LIMIT 1`,
    )
    .get(t) as { city: string; region: string } | undefined;
  if (cityRow) {
    city = cityRow.city;
    region = cityRow.region;
  } else {
    const metro = METROS.find((x) => t.includes(x.name.toLowerCase()));
    if (metro) {
      city = metro.name;
      region = metro.region;
    }
  }

  // What. inferCategory always answers, so only trust it when a category word is really in the sentence.
  const cat = inferCategory(t);
  const named = CATEGORIES.some((c) => t.includes(c.label.toLowerCase()) || t.includes(c.id)) || cat.id !== "jetski" || /jet ?ski/.test(t);
  return {
    text,
    categoryId: named ? cat.id : null,
    categoryLabel: named ? cat.label : null,
    city,
    region,
    party,
    when,
    maxPerPerson,
  };
}

export type Option = {
  name: string;
  domain: string;
  city: string | null;
  region: string | null;
  rating: number | null;
  reviews: number | null;
  category: string;
  bookingUrl: string;
  /** Empty until the shop's own system has been asked. */
  departures: Departure[];
  route: "feed" | "agent" | "phone";
  phone: string | null;
  /** True when nothing was free when they asked and these times are from a wider search. */
  widened?: boolean;
};

/** The shortlist: businesses that match, best reviewed first, the ones we can quote times for first of all. */
export function candidates(intent: Intent, limit = 8): Option[] {
  const where: string[] = ["o.origin != 'demo'", "o.name IS NOT NULL"];
  const args: unknown[] = [];
  if (intent.categoryId) {
    where.push("o.category_id = ?");
    args.push(intent.categoryId);
  }
  if (intent.city) {
    where.push("(lower(o.city) = lower(?) OR o.metro_id IN (SELECT id FROM metros WHERE lower(name) = lower(?)))");
    args.push(intent.city, intent.city);
  }
  if (intent.region) {
    where.push("(o.region = ? OR o.region IS NULL)");
    args.push(intent.region);
  }
  const rows = db
    .prepare(
      `SELECT o.name, o.domain, o.city, o.region, o.rating, o.review_count, o.category_id, o.phone,
              (SELECT f.fact_value FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'booking_url' LIMIT 1) AS booking
         FROM operators o
        WHERE ${where.join(" AND ")}
        ORDER BY (booking IS NULL), (booking NOT LIKE '%fareharbor%'),
                 o.review_count DESC NULLS LAST, o.rating DESC NULLS LAST
        LIMIT ?`,
    )
    .all(...args, limit) as {
    name: string; domain: string; city: string | null; region: string | null; rating: number | null;
    review_count: number | null; category_id: string; phone: string | null; booking: string | null;
  }[];

  return rows.map((r) => ({
    name: r.name,
    domain: r.domain,
    city: r.city,
    region: r.region,
    rating: r.rating,
    reviews: r.review_count,
    category: r.category_id,
    bookingUrl: r.booking || "",
    departures: [],
    route: r.booking ? (/fareharbor/i.test(r.booking) ? "feed" : "agent") : r.phone ? "phone" : "agent",
    phone: r.phone,
  }));
}

/** The date a guest means. "tonight" is today; "weekend" is the next Saturday. */
export function windowFor(when: Intent["when"], now = new Date()): { from: Date; days: number } {
  if (when === "tomorrow") return { from: new Date(now.getTime() + 86400_000), days: 1 };
  if (when === "today" || when === "tonight") return { from: now, days: 1 };
  if (when === "weekend") {
    const d = new Date(now);
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
    return { from: d, days: 2 };
  }
  return { from: now, days: 14 };
}

/**
 * The whole answer: read the sentence, shortlist the catalog, then ask the shops themselves. Only the ones with
 * a feed are asked here, because a browser agent takes half a minute a shop and a guest is waiting.
 */
export async function plan(text: string, opts: { ask?: number } = {}): Promise<{ intent: Intent; options: Option[] }> {
  const intent = readIntent(text);
  const options = candidates(intent);
  const win = windowFor(intent.when);
  const fits = (d: Departure) => intent.maxPerPerson == null || d.fromPrice == null || d.fromPrice <= intent.maxPerPerson;

  /**
   * The shops are asked at the same time, not one after another. Each one is a handful of round trips to its
   * booking provider, so asking three in turn took nineteen seconds with the machine idle for most of it, and
   * a guest waiting nineteen seconds has already decided we are broken. They go to different hosts and we send
   * a few requests each, so there is nothing rude about doing them together.
   */
  const feeds = options.filter((o) => o.route === "feed").slice(0, opts.ask ?? 3);
  await Promise.all(
    feeds.map(async (o) => {
      const live = await fareharborLive(o.bookingUrl, { from: win.from, days: win.days, maxItems: 3 });
      if (live) o.departures = live.departures.filter(fits);
      if (!o.departures.length && win.days < 14) {
        const wider = await fareharborLive(o.bookingUrl, { from: new Date(), days: 14, maxItems: 3 });
        if (wider?.departures.length) {
          o.departures = wider.departures.filter(fits);
          o.widened = true;
        }
      }
    }),
  );

  return { intent, options };
}

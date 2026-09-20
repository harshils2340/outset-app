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
  /** Where they meant, as a point, so results are chosen by distance rather than by a matching city name. */
  point: { lat: number; lon: number } | null;
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

  /**
   * Where, as a point rather than a word. "escape room in waterloo" used to match on city = 'Waterloo' and
   * find nothing, because the twelve escape rooms a Waterloo student would go to are filed under Kitchener and
   * Cambridge. A place name is turned into a coordinate, taken from the middle of the operators we already
   * hold there, and everything after that is measured in kilometres.
   *
   * Provinces and states are not cities: "skydiving in ontario" was matching a town called Ontario. They are
   * recognised separately and searched as a whole region.
   */
  let city: string | null = null;
  let region: string | null = null;
  let point: { lat: number; lon: number } | null = null;

  const REGIONS: Record<string, string> = {
    ontario: "ON", quebec: "QC", alberta: "AB", manitoba: "MB", saskatchewan: "SK", "nova scotia": "NS",
    "new brunswick": "NB", "british columbia": "BC", "newfoundland": "NL", "prince edward island": "PE",
    florida: "FL", california: "CA", texas: "TX", "new york": "NY", ohio: "OH", michigan: "MI",
    arizona: "AZ", colorado: "CO", washington: "WA", oregon: "OR", nevada: "NV", hawaii: "HI", alaska: "AK",
  };
  for (const [word, code] of Object.entries(REGIONS)) {
    if (new RegExp("\\b" + word + "\\b").test(t)) { region = code; break; }
  }

  /**
   * A province is not a town of the same name. "skydiving in ontario" found Ontario, California, and offered a
   * dropzone in Perris to somebody standing in Waterloo. When the sentence named a region, a city whose name is
   * that same word is not what they meant.
   */
  const regionWord = Object.entries(REGIONS).find(([, code]) => code === region)?.[0] ?? null;
  const placeRow = region && regionWord ? undefined : db
    .prepare(
      `SELECT city, region, COUNT(*) AS n, AVG(lat) AS lat, AVG(lon) AS lon FROM operators
        WHERE city IS NOT NULL AND length(city) >= 4 AND lat IS NOT NULL AND instr(?, lower(city)) > 0
        GROUP BY lower(city), region HAVING n >= 3 ORDER BY n DESC LIMIT 1`,
    )
    .get(t) as { city: string; region: string; lat: number; lon: number } | undefined;
  if (placeRow) {
    city = placeRow.city;
    region = region || placeRow.region;
    point = { lat: placeRow.lat, lon: placeRow.lon };
  } else if (!region) {
    const metro = METROS.find((x) => t.includes(x.name.toLowerCase()));
    if (metro) {
      city = metro.name;
      region = metro.region;
      point = { lat: metro.lat, lon: metro.lon };
    }
  }

  /**
   * What. `inferCategory` answers "jetski" when nothing matched, so a miss is indistinguishable from a hit
   * unless the words are checked first, and its patterns are the root words: "skydive", not "skydiving". A
   * guest typing "skydiving in ontario" was getting jet skis, then having them thrown away as a false positive,
   * and ending up with escape rooms. The sentence is tried as typed and with English's endings taken off.
   */
  const deInged = t
    .split(/\s+/)
    .map((w) => (w.length > 6 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 5 && w.endsWith("ing") ? w.slice(0, -3) + "e" : w))
    .join(" ");
  const forms = [t, deInged, t.replace(/\bskydiving\b/g, "skydive").replace(/\bziplining\b/g, "zipline")];
  let categoryId: string | null = null;
  let categoryLabel: string | null = null;
  for (const form of forms) {
    const c = inferCategory(form);
    // "jetski" is the fallback, so only believe it when the sentence really says so.
    if (c.id === "jetski" && !/jet ?ski|wave ?runner|\bpwc\b/.test(form)) continue;
    categoryId = c.id;
    categoryLabel = c.label;
    break;
  }

  return {
    text,
    categoryId,
    categoryLabel,
    city,
    region,
    point,
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
  /**
   * What this shop sells and what it charges, from our own catalog, read off their site by the crawl. This is
   * the answer when their booking system has no feed to read: a guest asking for an escape room in Waterloo
   * should be told "Adventure Rooms, $28 a head" and that we will confirm the time, not shown a blank screen
   * because the shop happens to run Checkfront.
   */
  services: { name: string; price: number | null; unit: string | null }[];
};

/** What the crawl read off this shop's own site: the menu a guest would see there. */
function servicesFor(domain: string): { name: string; price: number | null; unit: string | null }[] {
  return db
    .prepare(
      `SELECT x.name, x.price_cents AS cents, x.price_unit AS unit
         FROM offerings x JOIN operators o ON o.id = x.operator_id
        WHERE o.domain = ? AND x.name IS NOT NULL
        ORDER BY (x.price_cents IS NULL), x.price_cents ASC LIMIT 24`,
    )
    .all(domain)
    .filter((r) => {
      /**
       * The cheapest row is often not the one a guest can buy. Shops list school rates, corporate days, gift
       * cards and private hire in the same menu, so "escape room in Waterloo" was answered with "School Trip
       * 24-50 students, $25 each" and a $250 private room quoted as a per-person price. None of those is what
       * somebody asking for a night out can turn up and buy.
       */
      const n = (r as { name: string }).name.toLowerCase();
      if (/school|student|corporate|team building|fundraiser|group of \d|\d{2,}\s*(?:students|people|guests)|gift (?:card|certificate|voucher)|membership|season pass|party package|waiver|deposit/.test(n)) return false;
      // A line that is a sentence, or a nav label, is not a service.
      if (n.length > 60 || /^check out|^see |^click |^more |^other /.test(n)) return false;
      const cents = (r as { cents: number | null }).cents;
      // Per head, a local activity is a few dollars to a few hundred. Anything past that is private hire.
      if (cents != null && (cents < 300 || cents > 40000)) return false;
      return true;
    })
    .slice(0, 4)
    .map((r) => {
      const row = r as { name: string; cents: number | null; unit: string | null };
      return { name: row.name, price: row.cents == null ? null : Math.round(row.cents) / 100, unit: row.unit };
    });
}

/** The shortlist: businesses that match, best reviewed first, the ones we can quote times for first of all. */
export function candidates(intent: Intent, limit = 8, radiusKm = 40): Option[] {
  const where: string[] = ["o.origin != 'demo'", "o.name IS NOT NULL"];
  const args: (string | number)[] = [];
  if (intent.categoryId) {
    where.push("o.category_id = ?");
    args.push(intent.categoryId);
  }
  /**
   * A degree of latitude is 111 km everywhere; a degree of longitude shrinks with the cosine of the latitude.
   * Comparing squared degrees with longitude scaled that way orders by real distance without a trig function
   * per row, which matters when the table has 418,000 of them.
   */
  let order = "o.review_count DESC NULLS LAST, o.rating DESC NULLS LAST";
  if (intent.point) {
    const { lat, lon } = intent.point;
    const kx = Math.cos((lat * Math.PI) / 180);
    const deg = radiusKm / 111;
    where.push("o.lat IS NOT NULL AND abs(o.lat - ?) < ? AND abs(o.lon - ?) < ?");
    args.push(lat, deg, lon, deg / Math.max(kx, 0.2));
    order = `((o.lat - ${lat}) * (o.lat - ${lat}) + (o.lon - ${lon}) * (o.lon - ${lon}) * ${(kx * kx).toFixed(4)}) ASC, o.review_count DESC NULLS LAST`;
  } else if (intent.region) {
    where.push("o.region = ?");
    args.push(intent.region);
  }

  const rows = db
    .prepare(
      `SELECT o.name, o.domain, o.city, o.region, o.rating, o.review_count, o.category_id, o.phone,
              (SELECT f.fact_value FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'booking_url' LIMIT 1) AS booking
         FROM operators o
        WHERE ${where.join(" AND ")}
        ORDER BY (booking IS NULL), (booking NOT LIKE '%fareharbor%'), ${order}
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
    services: servicesFor(r.domain),
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
export type Answer = {
  intent: Intent;
  options: Option[];
  /** A question to ask back, when the sentence did not carry enough to search on. */
  followUp: string | null;
  /** Said out loud when the search had to be loosened: a wider area, or any activity rather than the one named. */
  loosened: string | null;
  /** Cheapest and dearest of what was found, because comparing is the thing a search engine cannot do for you. */
  compare: { cheapest: number; dearest: number; count: number } | null;
};

/** The lowest price we can quote for an option, live or from its published menu. */
export function priceOf(o: Option): number | null {
  const live = o.departures.map((d) => d.fromPrice).filter((n): n is number => n != null);
  const menu = o.services.map((s) => s.price).filter((n): n is number => n != null);
  const all = [...live, ...menu];
  return all.length ? Math.min(...all) : null;
}

/**
 * The whole answer, and the ways of not having one.
 *
 * A person asking a friend does not get silence when the friend has not understood: they get a question back,
 * or a near miss offered with an apology. So this either asks for the one thing it is missing, or it loosens
 * the search until it has something to show and says which rule it broke to get there.
 */
export async function plan(text: string, opts: { ask?: number } = {}): Promise<Answer> {
  const intent = readIntent(text);

  // Not enough to search on. Ask for the one thing that would make it searchable, not a form.
  if (!intent.categoryId && !intent.city && !intent.region) {
    return {
      intent, options: [], compare: null, loosened: null,
      followUp: "What sort of thing, and roughly where? Something like \u201cescape room in Kitchener\u201d or \u201cboat trip near Toronto\u201d.",
    };
  }
  if (!intent.city && !intent.region) {
    return { intent, options: [], compare: null, loosened: null, followUp: "Where are you? A town or city is enough." };
  }
  if (!intent.categoryId) {
    // A place with no activity is answerable: show what that place is known for rather than asking.
  }

  let loosened: string | null = null;
  let options = candidates(intent);

  // Nothing here: look further out before looking elsewhere, because people will travel for the right thing.
  if (!options.length && intent.point) {
    options = candidates(intent, 8, 120);
    if (options.length) loosened = "Nothing in " + (intent.city || "town") + " itself, so this is a wider search.";
  }
  // Still nothing: the activity is what is missing, not the place. Offer what the place does have.
  if (!options.length && intent.categoryId) {
    const anywhere: Intent = { ...intent, categoryId: null, categoryLabel: null };
    options = candidates(anywhere, 8, 60);
    if (options.length) {
      loosened = "No " + (intent.categoryLabel || "matches").toLowerCase() + " near " + (intent.city || "you") + ". Here is what else is around.";
    }
  }
  if (!options.length) {
    return {
      intent, options: [], compare: null, loosened: null,
      followUp: "I could not find anything for that. Try a bigger town nearby, or a different activity.",
    };
  }

  const win = windowFor(intent.when);
  const fits = (d: Departure) => intent.maxPerPerson == null || d.fromPrice == null || d.fromPrice <= intent.maxPerPerson;

  /**
   * The shops are asked at the same time, not one after another. Each is a handful of round trips to its
   * booking provider, so asking three in turn took nineteen seconds with the machine idle for most of it.
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

  // What it costs, across everything we found. This is the answer to "why not just use Google".
  const prices = options.map(priceOf).filter((n): n is number => n != null);
  const compare = prices.length >= 2 ? { cheapest: Math.min(...prices), dearest: Math.max(...prices), count: prices.length } : null;

  return { intent, options, followUp: null, loosened, compare };
}

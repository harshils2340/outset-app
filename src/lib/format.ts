import type { Listing } from "../data/types";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function money(n: number): string {
  // Whole dollars stay whole ("$95"); anything else shows cents ("$7.50"), never "$7.5".
  const whole = Number.isInteger(n);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/**
 * The same figure with the dollar named when it is not the American one: "CA$135", "$135".
 *
 * A listing is priced, charged and paid out in its own country's dollars: `currencyForArea` in
 * `backend/src/payments/money.ts` sends every booking at a Canadian address to Stripe as CAD, and the
 * booking email already writes it that way ("Your card was charged CA$135.00"). Only the screens in
 * between wrote a bare "$", so a guest read "Total $135", met "CA$135" in Stripe's own card form and read
 * "CA$135.00" again in the email that followed. 5,153 shipped listings are Canadian, and six metros
 * (Detroit, Niagara, Vancouver, Victoria, Montreal, Ottawa) hold shops on both sides of the border, so the
 * two dollars sit in one list.
 *
 * Only the money a guest is told they will be charged carries the label. A card's "from" price is an
 * indication and stays as it is until somebody decides that question for the whole catalog.
 */
export function moneyIn(n: number, country: "US" | "CA"): string {
  return (country === "CA" ? "CA" : "") + money(n);
}

/**
 * "2:00 PM" from a 24 hour clock string. An hour past 24 is the small hours of the next day, which is how a
 * week that runs past midnight is carried: `parseWeek` adds a day to the closing time, so a bar open until 4 AM
 * closes at minute 1680, and midnight itself is 1440.
 *
 * Without the wrap, "24:00" read as noon and "26:00" as 2 PM, so the Hours block on the listing page of a
 * brewery, bar, bowling alley or arcade that trades into the night printed the wrong half of the day: 169 Bar
 * in New York said "2:00 PM to 4:00 PM", an RV park "10:00 PM to 7:00 PM", and an arcade open until midnight
 * "2:00 PM to 12:00 PM". 213 shipped listings printed 874 such lines. `fmt` in openNow.ts has always wrapped;
 * this is its twin and did not.
 */
export function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const hour = ((h % 24) + 24) % 24;
  const ap = hour >= 12 ? "PM" : "AM";
  const hh = hour % 12 === 0 ? 12 : hour % 12;
  return hh + ":" + String(m).padStart(2, "0") + " " + ap;
}

/**
 * The same clock from minutes since midnight, which is how a parsed week carries a day: the "Plan your visit"
 * Hours block on a listing page is drawn from one.
 */
export function clockOfMinutes(m: number): string {
  return fmtTime(String(Math.floor(m / 60)) + ":" + String(m % 60).padStart(2, "0"));
}

/**
 * "Sat, Jan 3", and "Sat, Jan 3, 2027" for a date outside the current year. The booking window runs up to a
 * year ahead, so a January trip booked in December read on the ticket, the trip list and the booking box as
 * though it were this January. The year is left off the common case so the date strip stays short.
 */
export function fmtDate(d: Date, now: Date = new Date()): string {
  const year = d.getFullYear() === now.getFullYear() ? undefined : ("numeric" as const);
  return DAYS[d.getDay()] + ", " + d.toLocaleDateString("en-US", { month: "short", day: "numeric", year });
}

/**
 * How one date in a booking calendar reads out: "Thursday, October 1", with what the day is on the end
 * ("Thursday, October 1, not available", "Saturday, October 4, 3 open").
 *
 * The desktop listing's two month grids wrote this by hand and the phone's shared `SlotCalendar` did not, so
 * the same calendar named its days two ways: a guest on a desktop heard "Thursday, October 1, not available"
 * and a guest on a phone heard "1", with nothing to say the greyed day could not be picked and no month
 * anywhere in the grid. Every date in the booking window is an identically named button that way, which is
 * the one control in the flow a guest cannot do without.
 *
 * The weekday and the month are spelled out rather than abbreviated because this is read, not printed: the
 * number itself is already on screen.
 */
export function dayPickLabel(d: Date, note = ""): string {
  const name = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return note ? name + ", " + note : name;
}

export function nowStamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function unitLine(l: Listing, qty: number): string {
  if (l.unit === "hr") {
    return money(l.price) + "/hr x " + l.minHours + " hr x " + qty + " " + l.qtyUnit + (qty > 1 ? "s" : "");
  }
  if (l.unit === "person") {
    return money(l.price) + " x " + qty + " " + l.qtyUnit + (qty > 1 ? "s" : "");
  }
  return "Flat rate · " + l.minHours + " hour trip";
}

/**
 * A count as the product writes it, not as the reader's browser would: "1,234".
 *
 * `money`, `fmtDate` and every other formatter in this file name "en-US", so the dollars, the dates and the
 * review counts read the same for everybody. The counts on browse and on the two search sheets called bare
 * `toLocaleString()` instead, which hands the grouping to whatever locale the browser is set to. Half the
 * catalog is Canadian and a browser there is often fr-CA, where 1,234 is "1 234" with a no-break space; a
 * German browser reads "1.234" and an Egyptian one "\u0661\u066c\u0662\u0663\u0664". The same sentences carry "Over 1,000" and
 * "1,000+" as literals, so one line read "Over 1,000 experiences" beside "1 234".
 *
 * Nothing changes below a thousand, which is every count `plural` is handed outside the concierge's own
 * "I found N places".
 */
export function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function plural(n: number, unit: string): string {
  return fmtCount(n) + " " + unit + (n === 1 ? "" : "s");
}

export function fmtReviews(n: number): string {
  return fmtCount(n);
}

/**
 * "1 review", "2,431 reviews", "1 public review": the count with its own word. Every surface that printed the two
 * together wrote "reviews" whatever the number, so a shop with one told a guest "1 reviews".
 */
export function reviewsLine(n: number, adjective = ""): string {
  return fmtReviews(n) + " " + (adjective ? adjective + " " : "") + "review" + (n === 1 ? "" : "s");
}

/**
 * "$80" plus its unit as "$80 / person". Units come in as "/person", "/hr", "each".
 *
 * "clas" is not a typo here: the crawl used to singularise a unit by stripping a trailing "s", which turned
 * "$30 per class" into "/clas", and 11 shipped rows on 10 listings still carry it. The crawl no longer does it
 * (`backend/src/enrich/sitescrape.ts`), so the spelling goes when those listings are next crawled and synced.
 */
export function priceWith(amount: number, per?: string | null): string {
  const unit = (per || "").replace(/^\//, "").trim();
  if (!unit || unit === "each") return money(amount);
  const nice: Record<string, string> = { hr: "hour", hour: "hour", person: "person", boat: "boat", ski: "ski", day: "day", trip: "trip", group: "group", vehicle: "vehicle", room: "room", clas: "class" };
  return money(amount) + " / " + (nice[unit] || unit);
}

/**
 * Section headings read as titles: "Popular Jet Ski Rentals", not "Popular jet ski rentals". Words already
 * carrying a capital are left alone so ATV, NYC and TopGolf survive, joining words stay lowercase unless
 * they open or close the heading, and a hyphenated pair capitalises both halves so "e-bike" becomes "E-Bike".
 */
const SMALL_WORDS = new Set(["and", "or", "the", "a", "an", "of", "in", "on", "at", "to", "for", "near", "with", "by"]);

export function titleCase(text: string): string {
  const words = text.split(" ");
  return words
    .map((word, i) => {
      if (!word) return word;
      if (/[A-Z]/.test(word)) return word;
      const last = i === words.length - 1;
      if (i > 0 && !last && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word.replace(/(^|-)([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
    })
    .join(" ");
}

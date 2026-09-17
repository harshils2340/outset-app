import type { Listing } from "../data/types";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function money(n: number): string {
  // Whole dollars stay whole ("$95"); anything else shows cents ("$7.50"), never "$7.5".
  const whole = Number.isInteger(n);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

export function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return hh + ":" + String(m).padStart(2, "0") + " " + ap;
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

export function plural(n: number, unit: string): string {
  return n + " " + unit + (n === 1 ? "" : "s");
}

export function fmtReviews(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * "1 review", "2,431 reviews", "1 public review": the count with its own word. Every surface that printed the two
 * together wrote "reviews" whatever the number, so a shop with one told a guest "1 reviews".
 */
export function reviewsLine(n: number, adjective = ""): string {
  return fmtReviews(n) + " " + (adjective ? adjective + " " : "") + "review" + (n === 1 ? "" : "s");
}

/** "$80" plus its unit as "$80 / person". Units come in as "/person", "/hr", "each". */
export function priceWith(amount: number, per?: string | null): string {
  const unit = (per || "").replace(/^\//, "").trim();
  if (!unit || unit === "each") return money(amount);
  const nice: Record<string, string> = { hr: "hour", hour: "hour", person: "person", boat: "boat", ski: "ski", day: "day", trip: "trip", group: "group", vehicle: "vehicle", room: "room" };
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

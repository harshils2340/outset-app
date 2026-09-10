import type { Unclaimed } from "../data/types";
import { plainWords } from "./catalog";

/**
 * Derivations shared by the desktop listing page and the phone listing sheet. Every function reads what the
 * operator's own site states and returns null when it says nothing. Nothing here invents a fact.
 */

/** Service copy straight from the operator's page, minus the button labels that get scraped along with it. */
export function cleanDesc(raw: string): string {
  return plainWords(raw)
    .replace(/\b(SELECT|BOOK NOW|BOOK ONLINE|RESERVE NOW|LEARN MORE|READ MORE|CLICK HERE|ADD TO CART|BUY NOW)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/** "Free cancellation up to 48 hours before" when the operator's own policy says so. Null otherwise. */
export function freeCancel(text: string | undefined): string | null {
  if (!text) return null;
  if (!/full refund|free cancellation|100% refund|fully refundable/i.test(text)) return null;
  const m = text.match(/(\d+)\s*(hours?|hrs?|days?)/i);
  if (!m) return "Free cancellation";
  const n = Number(m[1]);
  const unit = /day/i.test(m[2]) ? (n === 1 ? "day" : "days") : n === 1 ? "hour" : "hours";
  return `Free cancellation up to ${n} ${unit} before`;
}

/** Minimum age from lines like "Must be 18+", "Minimum age 8", "ages 6 and up". */
export function minAge(lines: string[]): number | null {
  for (const l of lines) {
    const m = l.match(/\b(?:min(?:imum)? age(?: is|:)?|must be(?: at least)?|ages?|riders? must be)\s*(\d{1,2})\s*(?:\+|and (?:up|over|older)|years|yrs|or older)/i) || l.match(/\b(\d{1,2})\s*\+/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 2 && n <= 21) return n;
    }
  }
  return null;
}

/** Longest duration mentioned across the menu, as the operator wrote it. */
export function durationLabel(item: Unclaimed): string | null {
  const texts = [...(item.services || []).flatMap((s) => s.variants.map((v) => v.label)), ...item.options.map((o) => o.detail)];
  const found = texts.map((t) => t.match(/\b(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+)?\s*(hours?|hrs?|minutes?|mins?|days?)\b/i)).filter(Boolean) as RegExpMatchArray[];
  if (!found.length) return null;
  const m = found[0];
  const unit = /min/i.test(m[3]) ? "min" : /day/i.test(m[3]) ? (Number(m[2] || m[1]) === 1 ? "day" : "days") : Number(m[2] || m[1]) === 1 ? "hour" : "hours";
  return (m[2] ? m[1] + " to " + m[2] : m[1]) + " " + unit;
}

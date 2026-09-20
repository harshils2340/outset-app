import { randomUUID } from "node:crypto";
import { db } from "../db/client.ts";
import { detectVendor, type VendorHit } from "./vendors.ts";

/**
 * Finding a shop's booking system at the moment a guest is looking at it.
 *
 * The catalog holds 423,161 businesses and a booking link for 8,370 of them, because finding one has always
 * meant crawling the shop's website and only 6.5% of those sites have ever been fetched. Every reader we
 * have — FareHarbor, Resova, Peek, Checkfront — is therefore pointed at two per cent of the catalog.
 *
 * Pre-crawling 315,281 sites to fix that is weeks of worker time for an answer almost none of which any
 * guest will ever see. But a search returns eight businesses, and eight is nothing: fetch *those* eight now,
 * find the booking page, and the other 423,153 cost us nothing until somebody actually asks about them.
 *
 * So the work moves from "crawl everything in case" to "resolve what is on screen", and the catalog stops
 * being the limit. A shop is fetched once in its life: whatever is found — a vendor, a booking link, or
 * nothing at all — is written down, so the second guest to ask about that town pays none of it.
 *
 * Three pages at most per shop, chosen because they are where a booking link lives: the site itself, and the
 * two or three paths every booking page in the world is actually on.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** Where a booking page lives, when it is not on the front page. Ordered by how often they pay off. */
const LIKELY_PATHS = ["", "/book", "/booking", "/book-now", "/reservations", "/book-online"];

export type Resolved = {
  operatorId: string;
  domain: string;
  vendor: string;
  bookingUrl: string | null;
  /** True when a reader exists for this vendor, so the concierge can quote a time rather than a price. */
  readable: boolean;
  /** How it ended: found something, found nothing, or never got to look. */
  outcome: "found" | "none" | "unreachable" | "cached";
};

/** The vendors a reader exists for today. */
const READABLE = /fareharbor|resova|peek\.com|checkfront/i;

/**
 * Has this shop already been looked at? Written whatever the answer, including "nothing", because the second
 * most expensive thing after fetching a site is fetching it again to learn the same nothing.
 */
function alreadyTried(operatorId: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key IN ('booking_url', 'booking_resolved') LIMIT 1")
    .get(operatorId);
}

function remember(operatorId: string, hit: VendorHit | null, bookingUrl: string | null, source: string): void {
  /**
   * Six columns, six placeholders. Written with five and called with six arguments, this threw
   * "column index out of range" on every single shop, and `resolveMany`'s catch turned that into a calm
   * "0 of 30 had a booking system" — a crash reported as a finding. The same mistake was found in
   * `scripts/revendor.mts` an hour before this file was written.
   */
  const ins = db.prepare(
    "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, ?)",
  );
  // The marker is written even for a miss, so a shop with no booking system is never fetched twice.
  ins.run(randomUUID(), operatorId, "booking_resolved", hit?.vendor ?? "none", source, "resolve");
  if (hit && hit.vendor !== "unknown") ins.run(randomUUID(), operatorId, "booking_vendor", hit.vendor, source, "resolve");
  if (bookingUrl) ins.run(randomUUID(), operatorId, "booking_url", bookingUrl, source, "resolve");
}

async function fetchText(url: string, ms: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(ms),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!/html|text/i.test(type)) return null;
    // A booking widget is declared in the head or early body; a megabyte of marketing copy after it is noise.
    return (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  }
}

/**
 * Work out one shop's booking system, from its own website, now.
 *
 * Returns the cached answer without fetching anything when the shop has been looked at before, which after
 * the first busy evening in a town is nearly always.
 */
export async function resolveBooking(
  op: { id: string; domain: string; website: string | null },
  opts: { budgetMs?: number } = {},
): Promise<Resolved> {
  const base = { operatorId: op.id, domain: op.domain };
  if (alreadyTried(op.id)) {
    const row = db
      .prepare("SELECT fact_value AS u FROM facts WHERE operator_id = ? AND fact_key = 'booking_url' LIMIT 1")
      .get(op.id) as { u: string } | undefined;
    return { ...base, vendor: "cached", bookingUrl: row?.u ?? null, readable: !!row && READABLE.test(row.u), outcome: "cached" };
  }
  if (!op.website) return { ...base, vendor: "none", bookingUrl: null, readable: false, outcome: "none" };

  const until = Date.now() + (opts.budgetMs ?? 9000);
  let root: string;
  try {
    root = new URL(op.website).origin;
  } catch {
    return { ...base, vendor: "none", bookingUrl: null, readable: false, outcome: "unreachable" };
  }

  let reached = false;
  for (const path of LIKELY_PATHS) {
    if (Date.now() > until) break;
    const url = path ? root + path : op.website;
    const html = await fetchText(url, Math.min(6000, Math.max(1500, until - Date.now())));
    if (!html) continue;
    reached = true;

    const hit = detectVendor(html);
    if (hit.vendor === "unknown") continue;

    /**
     * The vendor's own hosted page when the embed gave up an account id, because that is the thing a reader
     * can actually read; otherwise the page we found it on, which at least opens their real booking flow.
     */
    const bookingUrl = hit.hostedUrl ?? url;
    remember(op.id, hit, bookingUrl, url);
    return { ...base, vendor: hit.vendor, bookingUrl, readable: READABLE.test(bookingUrl), outcome: "found" };
  }

  // Looked and found nothing, or could not reach them at all. Either way, written down so we do not repeat it.
  remember(op.id, null, null, op.website);
  return { ...base, vendor: "none", bookingUrl: null, readable: false, outcome: reached ? "none" : "unreachable" };
}

/**
 * Resolve several shops at once, which is how the concierge uses this: the handful it is about to show.
 *
 * Bounded twice over — by how many shops and by a wall-clock budget for the lot — because this sits between
 * a guest and their answer. A shop that does not resolve in time is simply not resolved this turn; the next
 * person to ask about that town will have it, and nothing is lost but one guest's chance at a live time.
 */
export async function resolveMany(
  ops: { id: string; domain: string; website: string | null }[],
  opts: { budgetMs?: number; max?: number } = {},
): Promise<Map<string, Resolved>> {
  const max = opts.max ?? 6;
  const until = Date.now() + (opts.budgetMs ?? 9000);
  const out = new Map<string, Resolved>();
  await Promise.all(
    ops.slice(0, max).map(async (op) => {
      const left = until - Date.now();
      if (left < 1200) return;
      const r = await resolveBooking(op, { budgetMs: left }).catch((e) => {
        // Say so. A silent catch here reported a crash as "this shop has no booking system".
        console.warn("resolve failed for " + op.domain + ": " + (e as Error).message.slice(0, 100));
        return null;
      });
      if (r) out.set(op.id, r);
    }),
  );
  return out;
}

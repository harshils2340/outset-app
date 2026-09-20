import { randomUUID } from "node:crypto";
import { db } from "../db/client.ts";
import { detectVendor, type VendorHit } from "./vendors.ts";
import { isReadable, READER_GENERATION } from "./readable.ts";

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

/**
 * Where a booking page lives, when it is not on the front page. Ordered by how often they pay off.
 *
 * A fixed list only ever covers the spellings somebody thought to add: adventurerooms.ca books at `/booknow/`,
 * no hyphen, which sat one character outside `/book-now` for as long as this list had one shape per idea. It
 * still stays short — every path costs a fetch out of the same per-shop time budget — but the real fix for
 * the shapes nobody enumerated is `linksTo` below, which reads the shop's own nav instead of guessing it.
 */
const LIKELY_PATHS = ["", "/book", "/booking", "/booknow", "/book-now", "/reservations", "/reserve", "/book-online", "/tickets"];

/**
 * Booking-shaped links out of a page we already fetched, for the paths no fixed list will ever enumerate.
 *
 * Read off the homepage's own nav rather than guessed, so "Reserve Your Spot", "Plan Your Visit" and every
 * other house style a shop picks for its own booking link is followed on its own terms. Kept to the first
 * three so a page with fifty links to "book a demo" and "book a call" in its footer does not turn one fetch
 * into fifty.
 */
function linksTo(html: string, root: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 3) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ");
    if (!/book|reserv|schedul|ticket/i.test(href) && !/book|reserv|schedul|ticket/i.test(text)) continue;
    if (/^(?:mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let url: string;
    try {
      url = new URL(href, root).toString();
    } catch {
      continue;
    }
    if (new URL(url).origin !== root) continue; // their booking page, not somebody else's
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

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


/**
 * What was found last time, if anything, and how strong the reader was when it was found.
 *
 * A shop already resolved to a readable booking link is done — never re-fetched, whatever `READER_GENERATION`
 * says, because it already works. A shop resolved to nothing readable (no booking link, or one none of our
 * readers know) is only done as of the generation that looked at it: `resolveBooking` below re-checks it once
 * the rules have gotten wider than that, on the theory that a fresh fetch against smarter detection may now
 * find the embed a younger reader could not.
 */
function cached(operatorId: string): { bookingUrl: string | null; gen: number } | null {
  const row = db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = 'booking_resolved' LIMIT 1").get(operatorId);
  if (!row) return null;
  const url = db.prepare("SELECT fact_value AS u FROM facts WHERE operator_id = ? AND fact_key = 'booking_url' LIMIT 1").get(operatorId) as
    | { u: string }
    | undefined;
  const gen = db.prepare("SELECT fact_value AS g FROM facts WHERE operator_id = ? AND fact_key = 'resolve_gen' LIMIT 1").get(operatorId) as
    | { g: string }
    | undefined;
  // A row written before this column existed is generation zero: older than anything `READER_GENERATION` is now.
  return { bookingUrl: url?.u ?? null, gen: gen ? Number(gen.g) : 0 };
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
  // A re-resolve replaces the old row rather than piling a second one beside it, so the `LIMIT 1` reads above
  // always see the latest attempt, not whichever of two rows the database happens to return first.
  const del = db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key = ?");
  for (const key of ["booking_resolved", "booking_vendor", "booking_url", "resolve_gen"]) del.run(operatorId, key);
  // The marker is written even for a miss, so a shop with no booking system is never fetched twice.
  ins.run(randomUUID(), operatorId, "booking_resolved", hit?.vendor ?? "none", source, "resolve");
  if (hit && hit.vendor !== "unknown") ins.run(randomUUID(), operatorId, "booking_vendor", hit.vendor, source, "resolve");
  if (bookingUrl) ins.run(randomUUID(), operatorId, "booking_url", bookingUrl, source, "resolve");
  ins.run(randomUUID(), operatorId, "resolve_gen", String(READER_GENERATION), source, "resolve");
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
  const prior = cached(op.id);
  if (prior) {
    const readableNow = isReadable(prior.bookingUrl);
    if (readableNow || prior.gen >= READER_GENERATION) {
      return { ...base, vendor: "cached", bookingUrl: prior.bookingUrl, readable: readableNow, outcome: "cached" };
    }
    // A past miss, at an older reader generation than today's: worth one more fetch, below, before giving up.
  }
  if (!op.website) return { ...base, vendor: "none", bookingUrl: prior?.bookingUrl ?? null, readable: false, outcome: "none" };

  const until = Date.now() + (opts.budgetMs ?? 9000);
  let root: string;
  try {
    root = new URL(op.website).origin;
  } catch {
    return { ...base, vendor: "none", bookingUrl: prior?.bookingUrl ?? null, readable: false, outcome: "unreachable" };
  }

  let reached = false;
  const tried = new Set<string>();
  // A queue rather than a fixed loop: the homepage's own nav can add stops no fixed path list enumerated.
  const queue = LIKELY_PATHS.map((path) => (path ? root + path : op.website!));
  for (let i = 0; i < queue.length && i < LIKELY_PATHS.length + 3; i++) {
    if (Date.now() > until) break;
    const url = queue[i];
    if (tried.has(url)) continue;
    tried.add(url);
    const html = await fetchText(url, Math.min(6000, Math.max(1500, until - Date.now())));
    if (!html) continue;
    reached = true;

    if (i === 0) for (const link of linksTo(html, root)) if (!tried.has(link)) queue.push(link);

    const hit = detectVendor(html);
    if (hit.vendor === "unknown") continue;

    /**
     * The vendor's own hosted page when the embed gave up an account id, because that is the thing a reader
     * can actually read; otherwise the page we found it on, which at least opens their real booking flow.
     */
    const bookingUrl = hit.hostedUrl ?? url;
    remember(op.id, hit, bookingUrl, url);
    return { ...base, vendor: hit.vendor, bookingUrl, readable: isReadable(bookingUrl), outcome: "found" };
  }

  /**
   * A re-check that finds nothing must not erase what an earlier one did. `prior.bookingUrl` here is only ever
   * a past miss's link (a readable one returned above, before this loop ever ran) — the shop's own page, or an
   * account-less embed, that no reader knows yet. Losing it would turn "we cannot read their times" into "they
   * have no booking system at all", which is false and steers a guest to call a shop that books online. So a
   * fetch that timed out, or a page that no longer mentions a vendor, keeps the link it already had; only a
   * shop resolved for the first time is ever written down as having none.
   */
  remember(op.id, null, prior?.bookingUrl ?? null, op.website);
  return {
    ...base,
    vendor: "none",
    bookingUrl: prior?.bookingUrl ?? null,
    readable: false,
    outcome: reached ? "none" : "unreachable",
  };
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

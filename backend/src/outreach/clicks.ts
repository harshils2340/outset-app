import { pgConfigured, query } from "../db/pg.ts";
import { emailHash } from "../lib/unsub.ts";

/**
 * What a business did with the pitch after it landed: opened the recording's page, pressed play, listened past
 * thirty seconds, clicked "Book a demo". Until 7 October 2026 nothing past "sent" was measured, so 865
 * businesses mailed and two replies were the whole funnel, with no way to tell a pitch nobody opened from a
 * recording nobody liked (Harshil: "fix the funnel before adding more traffic").
 *
 * The pitch's recording link carries `r`, the first twelve hex characters of the recipient's emailHash: no
 * address in the URL, and the daily run maps it back by hashing the addresses it mailed. The page reports
 * through POST /t (src/api/track.ts) from its own script, so a mail scanner that fetches every link without
 * running it counts for nothing, and only a person can press play.
 */
export const SITE_EVENTS = ["view", "play", "listen30", "demo"] as const;
export type SiteEvent = (typeof SITE_EVENTS)[number];

export function clickToken(email: string): string {
  return emailHash(email).slice(0, 12);
}

let ready: Promise<void> | null = null;
export function ensureSiteEvents(): Promise<void> {
  ready ||= (async () => {
    await query(`create table if not exists site_events (
      at timestamptz not null default now(),
      event text not null,
      r text,
      path text,
      ref text
    )`);
    await query("create index if not exists site_events_at on site_events (at)");
    await query("create index if not exists site_events_r on site_events (r) where r is not null");
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export async function recordSiteEvent(e: { event: SiteEvent; r: string | null; path: string | null; ref: string | null }): Promise<void> {
  if (!pgConfigured()) return;
  await ensureSiteEvents();
  await query("insert into site_events (event, r, path, ref) values ($1, $2, $3, $4)", [e.event, e.r, e.path, e.ref]);
}

/** Every recipient token seen since `since`, with what it did and when it first did it. */
export async function recentClicks(since: string): Promise<{ r: string; events: string[]; first_at: string }[]> {
  await ensureSiteEvents();
  return query<{ r: string; events: string[]; first_at: string }>(
    "select r, array_agg(distinct event) as events, min(at)::text as first_at from site_events where r is not null and at >= $1::timestamptz group by r",
    [since],
  );
}

/** How strongly a set of events says "interested": a demo click beats listening, listening beats a page view. */
export function clickStrength(events: string[]): number {
  return events.includes("demo") ? 4 : events.includes("listen30") ? 3 : events.includes("play") ? 2 : events.includes("view") ? 1 : 0;
}

export type HotLead = { operator_id: string; name: string; email: string; phone: string | null; city: string | null; region: string | null; events: string[]; first_at: string };

/**
 * The businesses whose recipients opened the recording's page since `since`, strongest first, leaving out any
 * in `skip` (already replied: Harshil has those). The SQL computes each mailed address's token the same way
 * clickToken does (sha256 of the trimmed lowercase address, first twelve hex characters).
 */
export async function hotLeads(since: string, skip: Set<string>): Promise<HotLead[]> {
  await ensureSiteEvents();
  const rows = await query<HotLead>(
    `with clicked as (
       select r, array_agg(distinct event) as events, min(at)::text as first_at from site_events
        where r is not null and at >= $1::timestamptz group by r
     ), mailed as (
       select distinct on (lower(s.email)) lower(s.email) as email, s.operator_id,
              left(encode(sha256(convert_to(lower(trim(s.email)), 'UTF8')), 'hex'), 12) as r
         from outreach_sends s where s.status = 'sent' order by lower(s.email), s.at
     )
     select m.operator_id, p.name, m.email, p.phone, p.city, p.region, c.events, c.first_at
       from clicked c join mailed m on m.r = c.r join outreach_pool p on p.operator_id = m.operator_id`,
    [since],
  );
  return rows.filter((l) => !skip.has(l.operator_id)).sort((a, b) => clickStrength(b.events) - clickStrength(a.events) || a.first_at.localeCompare(b.first_at));
}

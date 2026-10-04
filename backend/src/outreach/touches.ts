import { pgConfigured, query } from "../db/pg.ts";
import { emailHash } from "../lib/unsub.ts";
import type { RampState } from "./ramp.ts";

/**
 * Outreach state that has to be the same everywhere: in Postgres, the one database every machine can reach.
 *
 * Until 28 September 2026 the Otto campaign lived in the laptop's SQLite (the queue, what was sent, what was
 * handed to a friend) and ran from the laptop's launchd, which meant a laptop asleep or a Wi-Fi that came up
 * late after wake was a day with no mail. Harshil: "have it so it sends via cloud, regardless it runs". A
 * cloud sender has no disk of its own, and the catalog it needs (every eligible operator, any family since 30
 * September 2026, their best address,
 * the owner's first name) is 1.2 GB of SQLite on the laptop. So three small tables carry exactly what the
 * sender needs and nothing else:
 *
 *   outreach_pool   the candidates, in send order, published from the laptop whenever the catalog or the
 *                   owner lookups change (scripts/outreach-pool-sync.mts). A snapshot, not the catalog.
 *   outreach_sends  every touch on a business: sent, failed, handoff (a friend or a platform mails it),
 *                   replied, bounce. The dedup that every sender and every export reads, wherever it runs.
 *   outreach_ramp   the warm-up state per campaign (the same shape otto-ramp.mts keeps in a file), so the
 *                   cloud run continues each mailbox at its rung instead of starting over.
 *
 * outreach_log (outreachLog.ts) stays what it is: hashed, for the API's funnel numbers. This table keeps the
 * address in clear because the sender has to know whom it wrote to; it is the same data the laptop's SQLite
 * already holds, moved to where every machine can see it.
 */

export type TouchStatus = "sent" | "failed" | "handoff" | "replied" | "bounce";

export type PoolRow = {
  operator_id: string;
  catalog_id: string;
  domain: string;
  name: string;
  website: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  region: string | null;
  calendar_vendor: string | null;
  completeness: number | null;
  greet: string | null;
  /** The operator's category family (water, wellness, outdoor, ...), added 30 September 2026 once Otto opened
   * to every family instead of just water, so reply rate can be compared by vertical: `outreach_sends` joined
   * back to this column by `operator_id` is that comparison, no new table needed. */
  family: string | null;
  /** The front desk the pitch would have gone to, kept when the owners lookup (scripts/owners-pool.mts) found a better mailbox. */
  desk_email?: string | null;
  /** When the owners lookup read this business's own site, set whether or not it found anyone, so a rerun skips it. */
  owners_checked_at?: string | null;
  /** The page on the business's own site the owner's mailbox or name came from. Set means every later sync keeps email and greet. */
  owner_source?: string | null;
};

/**
 * Written by the owners lookup, which reads each business's own About, Team and Contact pages from a Render job
 * and puts the owner's mailbox and first name straight into the pool (3 October 2026: greet was empty on all
 * 161,368 rows and about half the sends went to info@ or bookings@).
 */
export const OWNER_COLUMNS_DDL = [
  "alter table outreach_pool add column if not exists desk_email text",
  "alter table outreach_pool add column if not exists owners_checked_at timestamptz",
  "alter table outreach_pool add column if not exists owner_source text",
];

const DDL = [
  `create table if not exists outreach_pool (
    operator_id text primary key,
    catalog_id text not null,
    domain text not null,
    name text not null,
    website text,
    email text not null,
    phone text,
    city text,
    region text,
    calendar_vendor text,
    completeness real,
    greet text,
    family text,
    synced_at timestamptz not null default now()
  )`,
  "alter table outreach_pool add column if not exists family text",
  ...OWNER_COLUMNS_DDL,
  "create index if not exists outreach_pool_order on outreach_pool (completeness desc nulls last)",
  `create table if not exists outreach_sends (
    operator_id text not null,
    email text not null,
    kind text not null default 'otto',
    status text not null,
    mailbox text,
    variant text,
    at timestamptz not null default now(),
    primary key (operator_id, email, kind, status)
  )`,
  // variant: which copy version the operator got (COPY_VERSION in ottoDrafts.ts), so reply rate by version
  // is a group-by on this column. Dedup stays keyed on kind alone, so no business is mailed twice.
  "alter table outreach_sends add column if not exists variant text",
  "create index if not exists outreach_sends_email on outreach_sends (email)",
  "create index if not exists outreach_sends_at on outreach_sends (at)",
  `create table if not exists outreach_ramp (
    campaign text primary key,
    state jsonb not null,
    updated_at timestamptz not null default now()
  )`,
];

let ready: Promise<void> | null = null;
export function ensureTouchTables(): Promise<void> {
  ready ||= (async () => {
    for (const sql of DDL) await query(sql);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** A touch on a business. Idempotent: the same status for the same address is one row however often it is recorded. */
export async function recordTouch(t: { operatorId: string; email: string; status: TouchStatus; mailbox?: string | null; at?: string | null; kind?: string; variant?: string | null }): Promise<void> {
  if (!pgConfigured()) return;
  const email = t.email.trim().toLowerCase();
  if (!email.includes("@")) return;
  await ensureTouchTables();
  await query(
    "insert into outreach_sends (operator_id, email, kind, status, mailbox, variant, at) values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now())) on conflict do nothing",
    [t.operatorId, email, t.kind || "otto", t.status, t.mailbox || null, t.variant || null, t.at || null],
  );
}

/**
 * Who must not be written to again, from every machine's sends: a business already mailed, handed off or in
 * conversation (by operator, since its address can change once the owner is found), and every address that
 * was ever sent to, bounced or failed (by address, since one address can sit on two records).
 */
export async function touched(kind = "otto"): Promise<{ operators: Set<string>; emails: Set<string> }> {
  const operators = new Set<string>();
  const emails = new Set<string>();
  if (!pgConfigured()) return { operators, emails };
  await ensureTouchTables();
  const rows = await query<{ operator_id: string; email: string; status: string }>("select operator_id, email, status from outreach_sends where kind = $1", [kind]);
  for (const r of rows) {
    emails.add(r.email);
    if (r.status === "sent" || r.status === "handoff" || r.status === "replied") operators.add(r.operator_id);
  }
  return { operators, emails };
}

/**
 * Sent today, per mailbox, from the shared record; `dayStart` is the campaign day's first instant as ISO.
 * Counts first touches and resends together: both come out of the same mailbox's daily allowance, so a
 * resend day must never let a mailbox go over its cap.
 */
export async function sentTodayByMailbox(dayStart: string, kinds: string[] = ["otto", RESEND_KIND]): Promise<Record<string, number>> {
  await ensureTouchTables();
  const rows = await query<{ mailbox: string | null; n: number }>("select mailbox, count(*)::int as n from outreach_sends where kind = any($1::text[]) and status = 'sent' and at >= $2::timestamptz group by mailbox", [kinds, dayStart]);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.mailbox || ""] = r.n;
  return out;
}

export async function loadRamp<S extends RampState>(campaign: string): Promise<S | null> {
  await ensureTouchTables();
  const rows = await query<{ state: S }>("select state from outreach_ramp where campaign = $1", [campaign]);
  return rows[0]?.state ?? null;
}

export async function saveRamp(campaign: string, state: RampState): Promise<void> {
  await ensureTouchTables();
  await query("insert into outreach_ramp (campaign, state, updated_at) values ($1, $2::jsonb, now()) on conflict (campaign) do update set state = excluded.state, updated_at = now()", [campaign, JSON.stringify(state)]);
}

/** The next candidates in send order that no machine has touched, with every suppression check still to come. */
/**
 * Who goes first. Harshil, 3 October 2026: 421 of the first 701 sends went to water-sports shops, out of season
 * by October, and one human replied. So the queue now leads with the businesses whose phones ring in the cold
 * months, escape rooms first (they have their own page, onoutset.com/for/escape-rooms), then the rest of indoor,
 * karting, indoor play, wellness and food experiences, with water and air last until spring. Inside a family a
 * named mailbox (jeff@, a personal gmail) goes before a desk inbox (info@, bookings@): the owner decides, the
 * front desk forwards. Completeness breaks the remaining ties, as before.
 */
export const FAMILY_ORDER = ["indoor", "motorsport", "play", "wellness", "food", "outdoor", "water", "air"];
export const DESK_INBOX = "^(info|hello|hi|contact|contactus|book|booknow|booking|bookings|reservation|reservations|res|sales|office|admin|support|help|team|staff|mail|email|events|inquiries|enquiries|general|frontdesk|guestservices|customerservice|service)$";

/**
 * Never written to as kind `$2`: the business not mailed, handed off or in conversation, and the address never
 * used. Shared with the owners lookup's queue (ownersPool.ts), which reads sites in exactly this send order.
 */
export const POOL_UNTOUCHED = `not exists (select 1 from outreach_sends s where s.kind = $2 and s.operator_id = p.operator_id and s.status in ('sent', 'handoff', 'replied'))
        and not exists (select 1 from outreach_sends s where s.kind = $2 and s.email = p.email)`;
/** The send order above. `$3` is FAMILY_ORDER, `$4` is DESK_INBOX. */
export const POOL_ORDER = `coalesce(array_position($3::text[], p.family), 99),
        coalesce(p.family = 'indoor' and (p.name ilike '%escape%' or p.website ilike '%escape%'), false) desc,
        (split_part(p.email, '@', 1) ~* $4),
        p.completeness desc nulls last, p.operator_id`;

export async function poolCandidates(limit: number, kind = "otto"): Promise<PoolRow[]> {
  await ensureTouchTables();
  return query<PoolRow>(
    `select p.* from outreach_pool p
      where ${POOL_UNTOUCHED}
      order by ${POOL_ORDER}
      limit $1`,
    [limit, kind, FAMILY_ORDER, DESK_INBOX],
  );
}

/** What scripts/outreach-pool-sync.mts publishes for each candidate, in this order. */
export const POOL_COLUMNS = ["operator_id", "catalog_id", "domain", "name", "website", "email", "phone", "city", "region", "calendar_vendor", "completeness", "greet", "family"] as const;

/**
 * A row the owners lookup wrote to: it read the business's own site and found the owner's mailbox or name there.
 * `owners_checked_at` alone is not enough, since a site that named nobody is checked too and has nothing to keep.
 */
const OWNER_WORK = "outreach_pool.owners_checked_at is not null and outreach_pool.owner_source is not null";

/**
 * The pool sync's upsert for `rows` candidates, parameters `$1` up in POOL_COLUMNS order, row after row.
 *
 * The sync publishes from the laptop's catalog, whose address and greeting come from its own owner facts. For a
 * business the owners lookup already found the owner for, a catalog without those facts would put the front
 * desk back and drop the "Hi Jeff,", so on such a row email and greet stay as the lookup left them, and
 * desk_email and owner_source are never written by a sync at all. Every other column is refreshed as before.
 */
export function poolUpsertSql(rows: number): string {
  const n = POOL_COLUMNS.length;
  const tuples = Array.from({ length: rows }, (_, k) => "(" + Array.from({ length: n }, (_, j) => "$" + (k * n + j + 1)).join(", ") + ", now())");
  const keep = (col: string) => `${col} = case when ${OWNER_WORK} then outreach_pool.${col} else excluded.${col} end`;
  return `insert into outreach_pool (${POOL_COLUMNS.join(", ")}, synced_at)
       values ${tuples.join(", ")}
       on conflict (operator_id) do update set catalog_id = excluded.catalog_id, domain = excluded.domain, name = excluded.name, website = excluded.website,
         ${keep("email")}, phone = excluded.phone, city = excluded.city, region = excluded.region, calendar_vendor = excluded.calendar_vendor,
         completeness = excluded.completeness, ${keep("greet")}, family = excluded.family, synced_at = now()`;
}

/**
 * The 2 October 2026 resend. The ~580 businesses that got the 1 October copy got it in Gmail's Promotions
 * tab (ottoDrafts.ts has the test), so each gets the new note once, under its own kind so it never counts as
 * a first touch and is never sent twice. Most recently mailed first, at Harshil's word, and only once the
 * first email is at least two days old.
 */
export const RESEND_KIND = "otto_resend";

/**
 * The first copy that landed in Primary. A business whose email was this copy or any later one (or one of the
 * hand-written follow-ups) already has a pitch it could see, so it never gets the resend. Keyed on this date rather
 * than on today's COPY_VERSION: bumping the copy on 3 October made the 52 businesses that got the 2 October copy
 * the day before look due for a resend, a near-duplicate two days after the first.
 */
export const RESEND_BEFORE = "2026-10-02";

/**
 * Who should get the resend, newest first. Skips any business that replied, bounced, was handed to a friend
 * to send, or already got a resend; skips an address that ever bounced, failed or replied (the pool may hold
 * a better address than the one first mailed, which is then the one used); and skips anyone who already got a
 * copy from RESEND_BEFORE on.
 */
export const RESEND_SEEN = "coalesce(bool_or(variant >= $2 or variant like 'followup-%'), false)";

export async function resendCandidates(limit: number, primarySince: string = RESEND_BEFORE): Promise<(PoolRow & { last_at: string })[]> {
  await ensureTouchTables();
  return query<PoolRow & { last_at: string }>(
    `with first as (
       select operator_id, max(at) as last_at, ${RESEND_SEEN} as had_current
         from outreach_sends where kind = 'otto' and status = 'sent' group by operator_id
     )
     select p.*, first.last_at from first join outreach_pool p on p.operator_id = first.operator_id
      where not first.had_current
        and first.last_at < now() - interval '2 days'
        and not exists (select 1 from outreach_sends s where s.operator_id = first.operator_id
                          and (s.kind = '${RESEND_KIND}' or s.status in ('replied', 'bounce', 'handoff')))
        and not exists (select 1 from outreach_sends s where s.email = p.email and s.status in ('bounce', 'failed', 'replied'))
      order by first.last_at desc, p.operator_id
      limit $1`,
    [limit, primarySince],
  );
}

/** Operators already handed to Harshil by hand, so a redirecting auto-reply is reported once, not every day. */
export async function handedOffOperators(): Promise<Set<string>> {
  if (!pgConfigured()) return new Set();
  await ensureTouchTables();
  const rows = await query<{ operator_id: string }>("select distinct operator_id from outreach_sends where status = 'handoff'");
  return new Set(rows.map((r) => r.operator_id));
}

/** Operators already marked replied, so a reply sweep can tell a new reply from one it already reported. */
export async function repliedOperators(): Promise<Set<string>> {
  await ensureTouchTables();
  const rows = await query<{ operator_id: string }>("select distinct operator_id from outreach_sends where status = 'replied'");
  return new Set(rows.map((r) => r.operator_id));
}

/** Every address and domain mailed so far, mapped back to its businesses, for matching replies. */
export async function mailedIndex(): Promise<{ byEmail: Map<string, Set<string>>; byDomain: Map<string, Set<string>> }> {
  await ensureTouchTables();
  const rows = await query<{ operator_id: string; email: string }>(
    "select distinct operator_id, lower(email) as email from outreach_sends where kind in ('otto', $1) and status = 'sent'", [RESEND_KIND]);
  const byEmail = new Map<string, Set<string>>(), byDomain = new Map<string, Set<string>>();
  const FREE = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|msn|comcast|proton|protonmail|shaw|rogers|sympatico|bell)\./;
  for (const r of rows) {
    (byEmail.get(r.email) || byEmail.set(r.email, new Set()).get(r.email)!).add(r.operator_id);
    const d = r.email.split("@")[1] || "";
    if (d && !FREE.test(d)) (byDomain.get(d) || byDomain.set(d, new Set()).get(d)!).add(r.operator_id);
  }
  return { byEmail, byDomain };
}

/** Suppression-list key for an address, the same one unsub.ts and outreachLog.ts use. */
export const touchHash = emailHash;

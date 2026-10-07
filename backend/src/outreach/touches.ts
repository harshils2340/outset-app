import { pgConfigured, query } from "../db/pg.ts";
import { emailHash } from "../lib/unsub.ts";
import { plainName } from "./ottoDrafts.ts";
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
 * What the other campaign's shared record says this one may not touch, for a campaign whose own queue lives
 * on a disk the cloud sender has never seen.
 *
 * `spacing.ts` is the rule: one pitch per address per campaign for good, and another campaign's send bars an
 * address until the cool-off passes. Both campaigns enforced it by reading `outreach_drafts`, which is the
 * laptop's SQLite, and that was enough for exactly as long as both ran from the laptop. The Otto campaign
 * moved to the cloud on 28 September 2026 and records itself here instead, so from the listing campaign's
 * side those sends stopped existing: a business the cloud pitched Otto to this morning was back at the top of
 * the listing queue, eligible for a second cold pitch from the same personal Gmail inside the week the rule
 * names, and a business that replied "stop" to the Otto note was never marked on that disk at all and so was
 * never out of the other campaign's reach.
 *
 * `holds` is the week; `done` is for good (it answered, or a person was handed it to mail by hand).
 */
export type CampaignHolds = { holds: { operators: Set<string>; emails: Set<string> }; done: { operators: Set<string>; emails: Set<string> } };

/** Which rows this reads: a reply or a handoff whenever it happened, another campaign's send inside the window. */
export const OTHER_CAMPAIGN_SQL = `select operator_id, email, status from outreach_sends
      where status in ('replied', 'handoff')
         or (status = 'sent' and kind <> $1 and at >= $2::timestamptz)`;

/** The halves those rows fall into, apart from the query so the rule can be driven without a database. */
export function splitCampaignHolds(rows: { operator_id: string; email: string; status: string }[]): CampaignHolds {
  const empty = () => ({ operators: new Set<string>(), emails: new Set<string>() });
  const out: CampaignHolds = { holds: empty(), done: empty() };
  for (const r of rows) {
    // Only 'sent' is the week. A reply or a handoff is the business out of this campaign's reach for good.
    const side = r.status === "sent" ? out.holds : out.done;
    side.operators.add(r.operator_id);
    side.emails.add(String(r.email || "").trim().toLowerCase());
  }
  return out;
}

export async function otherCampaignHolds(ownKind: string, since: string): Promise<CampaignHolds> {
  if (!pgConfigured()) return splitCampaignHolds([]);
  await ensureTouchTables();
  return splitCampaignHolds(await query<{ operator_id: string; email: string; status: string }>(OTHER_CAMPAIGN_SQL, [ownKind, since]));
}

/**
 * Sent today, per mailbox, from the shared record; `dayStart` is the campaign day's first instant as ISO.
 *
 * Every send out of a mailbox counts, whatever kind of mail it was: the first pitch, the resend and the
 * follow-up all leave the same Gmail and all come out of its daily allowance, which is what the warm-up ramp
 * is protecting. This used to name the kinds it counted ('otto' and the resend), and the follow-up landed on
 * 4 October 2026 without being added to the list, so ten emails out of one mailbox read as six: a `--resume`
 * or a second round was handed the difference again, 40% over the rung on a day the follow-up took its full
 * share, and a day spent entirely on follow-ups recorded as a day that sent nothing, so the rung never moved.
 * Counting every kind is also what `sentToday` in sendOtto.ts does, and it cannot go stale when a kind is
 * added. `kinds` narrows it for a caller that really wants one campaign's count.
 */
export const SENT_TODAY_BY_MAILBOX = `select mailbox, count(*)::int as n from outreach_sends
      where status = 'sent' and at >= $1::timestamptz group by mailbox`;

export async function sentTodayByMailbox(dayStart: string, kinds?: string[]): Promise<Record<string, number>> {
  await ensureTouchTables();
  const rows = kinds
    ? await query<{ mailbox: string | null; n: number }>("select mailbox, count(*)::int as n from outreach_sends where kind = any($2::text[]) and status = 'sent' and at >= $1::timestamptz group by mailbox", [dayStart, kinds])
    : await query<{ mailbox: string | null; n: number }>(SENT_TODAY_BY_MAILBOX, [dayStart]);
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
 * The follow-up: one short note in the same thread, a few days after a first email that landed in Primary
 * (RESEND_BEFORE on, the hand-written follow-ups of 1 October aside) and drew nothing back. Its own kind, so it
 * never counts as a first touch and goes once. Never after a resend: those businesses have had two already.
 */
export const BUMP_KIND = "otto_bump";

/**
 * Who is due the follow-up, oldest first: the address and mailbox the first email went from, so it can answer
 * that email in its thread. 66 hours, so whatever went out at any hour three days ago is due by today's batch.
 * Skips a business that replied, bounced, was handed off or already got one, and an address that ever bounced,
 * failed or replied.
 */
export async function bumpCandidates(limit: number): Promise<(PoolRow & { sent_to: string; sent_from: string | null; last_at: string; first_variant: string | null })[]> {
  await ensureTouchTables();
  // The A/B/C test's "forgot" arm (ottoDrafts.ts ARMS) follows up the next day, since a slip-up noticed three days
  // later is not a slip-up, and goes first so a day's budget cannot push it back; every other arm waits 66 hours.
  return query<PoolRow & { sent_to: string; sent_from: string | null; last_at: string; first_variant: string | null }>(
    `with firsts as (
       select distinct on (operator_id) operator_id, lower(email) as sent_to, mailbox as sent_from, at as last_at, variant as first_variant
         from outreach_sends
        where kind = 'otto' and status = 'sent' and variant >= $2 and variant not like 'followup-%'
        order by operator_id, at desc
     )
     select p.*, f.sent_to, f.sent_from, f.last_at::text as last_at, f.first_variant
       from firsts f join outreach_pool p on p.operator_id = f.operator_id
      where f.last_at < now() - (case when f.first_variant like '%-forgot' then interval '18 hours' else interval '66 hours' end)
        and not exists (select 1 from outreach_sends s where s.operator_id = f.operator_id and (s.kind in ($3, $4) or s.status in ('replied', 'bounce', 'handoff')))
        and not exists (select 1 from outreach_sends s where s.email = f.sent_to and s.status in ('bounce', 'failed', 'replied'))
      order by (f.first_variant like '%-forgot') desc, f.last_at, p.operator_id
      limit $1`,
    [limit, RESEND_BEFORE, BUMP_KIND, RESEND_KIND],
  );
}

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

/**
 * The A/B/C test's numbers: every business whose first email went out from `since`, by arm, with how many bounced,
 * got their follow-up, and replied (a human reply, any answer). Replies are listed by business so Harshil can read
 * which were interested.
 */
export async function armStats(since: string): Promise<{ arm: string; sent: number; bounced: number; followed: number; replied: number; names: string[] }[]> {
  await ensureTouchTables();
  return query<{ arm: string; sent: number; bounced: number; followed: number; replied: number; names: string[] }>(
    `with firsts as (
       select distinct on (operator_id) operator_id, variant from outreach_sends
        where kind = 'otto' and status = 'sent' and at >= $1::timestamptz order by operator_id, at
     ), tagged as (
       select f.operator_id,
              case when f.variant like 'manual-%' then 'sent by hand' when f.variant like '%-ask' then 'B ask' when f.variant like '%-forgot' then 'C forgot' when f.variant like '%-nolink' or f.variant like '%-min' then 'fallback' else 'A full' end as arm,
              exists (select 1 from outreach_sends s where s.operator_id = f.operator_id and s.status = 'bounce') as bounced,
              exists (select 1 from outreach_sends s where s.operator_id = f.operator_id and s.kind = $2 and s.status = 'sent') as followed,
              exists (select 1 from outreach_sends s where s.operator_id = f.operator_id and s.status = 'replied') as replied
         from firsts f
     )
     select t.arm, count(*)::int as sent, count(*) filter (where t.bounced)::int as bounced,
            count(*) filter (where t.followed)::int as followed, count(*) filter (where t.replied)::int as replied,
            coalesce(array_agg(p.name) filter (where t.replied), '{}') as names
       from tagged t left join outreach_pool p on p.operator_id = t.operator_id
      group by t.arm order by t.arm`,
    [since, BUMP_KIND],
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

/**
 * The keys a business's name is matched on when a reply names it in its subject (bounceSweep.ts).
 *
 * Both spellings, because the subject carries the one the owner reads and the pool holds the one the registry
 * wrote: the pitch is addressed to `plainName(name)`, so "House of Clues, LLC" went out as "Missed calls at
 * House of Clues" and a reply naming that matched nothing. 645 of the 46,324 operator listings the catalog
 * ships differ that way, and each one was an owner who answered from a mailbox we never wrote to, was never
 * counted, and was followed up three days later with "in case this got buried".
 */
export function nameKeys(name: string): string[] {
  return [...new Set([name, plainName(name)].map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/** Every address and domain mailed so far, mapped back to its businesses, for matching replies. */
export async function mailedIndex(): Promise<{ byEmail: Map<string, Set<string>>; byDomain: Map<string, Set<string>>; byName: Map<string, Set<string>> }> {
  await ensureTouchTables();
  const rows = await query<{ operator_id: string; email: string; name: string | null }>(
    `select distinct s.operator_id, lower(s.email) as email, lower(p.name) as name
       from outreach_sends s left join outreach_pool p on p.operator_id = s.operator_id
      where s.kind in ('otto', $1, $2) and s.status = 'sent'`, [RESEND_KIND, BUMP_KIND]);
  const byEmail = new Map<string, Set<string>>(), byDomain = new Map<string, Set<string>>(), byName = new Map<string, Set<string>>();
  // The business by name, for a reply whose subject names it but whose sender we never wrote to (bounceSweep.ts).
  for (const r of rows) if (r.name) for (const k of nameKeys(r.name)) (byName.get(k) || byName.set(k, new Set()).get(k)!).add(r.operator_id);
  const FREE = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|msn|comcast|proton|protonmail|shaw|rogers|sympatico|bell)\./;
  for (const r of rows) {
    (byEmail.get(r.email) || byEmail.set(r.email, new Set()).get(r.email)!).add(r.operator_id);
    const d = r.email.split("@")[1] || "";
    if (d && !FREE.test(d)) (byDomain.get(d) || byDomain.set(d, new Set()).get(d)!).add(r.operator_id);
  }
  return { byEmail, byDomain, byName };
}

/** Suppression-list key for an address, the same one unsub.ts and outreachLog.ts use. */
export const touchHash = emailHash;

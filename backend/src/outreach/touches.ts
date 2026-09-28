import { pgConfigured, query } from "../db/pg.ts";
import { emailHash } from "../lib/unsub.ts";
import type { RampState } from "./ramp.ts";

/**
 * Outreach state that has to be the same everywhere: in Postgres, the one database every machine can reach.
 *
 * Until 28 September 2026 the Otto campaign lived in the laptop's SQLite (the queue, what was sent, what was
 * handed to a friend) and ran from the laptop's launchd, which meant a laptop asleep or a Wi-Fi that came up
 * late after wake was a day with no mail. Harshil: "have it so it sends via cloud, regardless it runs". A
 * cloud sender has no disk of its own, and the catalog it needs (14,000 water operators, their best address,
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
};

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
    synced_at timestamptz not null default now()
  )`,
  "create index if not exists outreach_pool_order on outreach_pool (completeness desc nulls last)",
  `create table if not exists outreach_sends (
    operator_id text not null,
    email text not null,
    kind text not null default 'otto',
    status text not null,
    mailbox text,
    at timestamptz not null default now(),
    primary key (operator_id, email, kind, status)
  )`,
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
export async function recordTouch(t: { operatorId: string; email: string; status: TouchStatus; mailbox?: string | null; at?: string | null; kind?: string }): Promise<void> {
  if (!pgConfigured()) return;
  const email = t.email.trim().toLowerCase();
  if (!email.includes("@")) return;
  await ensureTouchTables();
  await query(
    "insert into outreach_sends (operator_id, email, kind, status, mailbox, at) values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now())) on conflict do nothing",
    [t.operatorId, email, t.kind || "otto", t.status, t.mailbox || null, t.at || null],
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

/** Sent today, per mailbox, from the shared record; `dayStart` is the campaign day's first instant as ISO. */
export async function sentTodayByMailbox(dayStart: string, kind = "otto"): Promise<Record<string, number>> {
  await ensureTouchTables();
  const rows = await query<{ mailbox: string | null; n: number }>("select mailbox, count(*)::int as n from outreach_sends where kind = $1 and status = 'sent' and at >= $2::timestamptz group by mailbox", [kind, dayStart]);
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
export async function poolCandidates(limit: number, kind = "otto"): Promise<PoolRow[]> {
  await ensureTouchTables();
  return query<PoolRow>(
    `select p.* from outreach_pool p
      where not exists (select 1 from outreach_sends s where s.kind = $2 and s.operator_id = p.operator_id and s.status in ('sent', 'handoff', 'replied'))
        and not exists (select 1 from outreach_sends s where s.kind = $2 and s.email = p.email)
      order by p.completeness desc nulls last, p.operator_id
      limit $1`,
    [limit, kind],
  );
}

/** Suppression-list key for an address, the same one unsub.ts and outreachLog.ts use. */
export const touchHash = emailHash;

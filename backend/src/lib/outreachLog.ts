import { pgConfigured, query } from "../db/pg.ts";
import { emailHash } from "./unsub.ts";

/**
 * What outreach actually did, in Postgres, so the deployed API can report it.
 *
 * A send is recorded in SQLite today (`outreach_drafts.status = 'sent'`), on whichever machine sent it. That
 * disk is the laptop's or the pipeline worker's; the API host has neither, so from the API's side a thousand
 * emails and none look identical. This is the same dual-write unsub.ts already does for suppressions: the local
 * row stays where it is, and a copy of the fact lands in Postgres.
 *
 * Only a hash of the address is stored. This is a marketing list, so the row must not be able to become one.
 * Same hash function as the suppression list, so a bounce recorded here and a suppression recorded there are
 * the same key.
 *
 * Nothing here may throw into a send: an email that went out and a database that did not answer is still an
 * email that went out, and the send loop must carry on exactly as recordUnsub lets it.
 */

export type OutreachKind = "sent" | "bounce" | "complaint";

const DDL = `create table if not exists outreach_log (
  email_hash text not null,
  kind text not null,
  listing text,
  at timestamptz not null default now(),
  primary key (email_hash, kind)
)`;
const INDEX = "create index if not exists outreach_log_at on outreach_log (at)";

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  ready ||= (async () => {
    await query(DDL);
    await query(INDEX);
  })().catch((e) => {
    // A failed create must not be remembered as done, or every later write fails against a missing table.
    ready = null;
    throw e;
  });
  return ready;
}

/**
 * One row per address per kind. The send loop already refuses to mail an address twice, and a mailbox that
 * bounces twice is still one dead address, so `on conflict do nothing` keeps these counts as counts of
 * addresses, which is what "emailed" means in the funnel.
 */
async function record(kind: OutreachKind, email: string, listing: string | null, at: string | null): Promise<void> {
  if (!pgConfigured()) return;
  const e = (email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return;
  try {
    await ensure();
    await query("insert into outreach_log (email_hash, kind, listing, at) values ($1, $2, $3, coalesce($4::timestamptz, now())) on conflict do nothing", [
      emailHash(e),
      kind,
      listing || null,
      at || null,
    ]);
  } catch (err) {
    console.error("outreach log " + kind + ": " + (err as Error).message);
  }
}

/** An outreach email went out. `listing` is the catalog id it was about, kept for "which shops were mailed". */
export async function recordSend(r: { email: string; listing?: string | null; at?: string | null }): Promise<void> {
  await record("sent", r.email, r.listing ?? null, r.at ?? null);
}

/** A hard bounce or a spam complaint, from the Resend webhook, beside the suppression it already writes. */
export async function recordOutreachEvent(email: string, kind: "bounce" | "complaint", at?: string | null): Promise<void> {
  await record(kind, email, null, at ?? null);
}

export type OutreachTotals = { sent: number; bounced: number; complained: number };
export type OutreachDay = { day: string; sent: number; bounced: number };

/** Counts per kind, over everything ever sent (the totals the page shows are lifetime, not windowed). */
export async function outreachTotals(): Promise<OutreachTotals> {
  await ensure();
  const rows = await query<{ kind: string; n: string }>("select kind, count(*)::text as n from outreach_log group by kind");
  const by = new Map(rows.map((r) => [r.kind, Number(r.n) || 0]));
  return { sent: by.get("sent") || 0, bounced: by.get("bounce") || 0, complained: by.get("complaint") || 0 };
}

/** Per-UTC-day counts inside the window. Days with nothing are filled in by the caller. */
export async function outreachDays(sinceIso: string): Promise<OutreachDay[]> {
  await ensure();
  const rows = await query<{ day: string; kind: string; n: string }>(
    `select to_char(at at time zone 'UTC', 'YYYY-MM-DD') as day, kind, count(*)::text as n
       from outreach_log where at >= $1 group by 1, 2`,
    [sinceIso],
  );
  const days = new Map<string, OutreachDay>();
  for (const r of rows) {
    const d = days.get(r.day) || { day: r.day, sent: 0, bounced: 0 };
    if (r.kind === "sent") d.sent += Number(r.n) || 0;
    if (r.kind === "bounce") d.bounced += Number(r.n) || 0;
    days.set(r.day, d);
  }
  return [...days.values()];
}

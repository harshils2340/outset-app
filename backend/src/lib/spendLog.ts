import { pgConfigured, query } from "../db/pg.ts";

/**
 * What the pipeline worker has spent, in Postgres, so the deployed API can report it.
 *
 * The money Outset spends on discovery and extraction is counted on the worker: two ledger files beside the
 * clone (`backend/data/aisearch-ledger.txt` and `backend/data/searchapi-ledger.txt`) and the `extract_spend`
 * table in the SQLite database on its disk. The API host has none of those, exactly the wall that made outreach
 * sends invisible, so the same answer applies: the worker posts a snapshot and Postgres keeps it.
 *
 * One row, replaced each time. This is a running total, not an event log: yesterday's snapshot is not a fact
 * worth keeping once today's arrives, and a table that only ever grows would be a second thing to prune. The
 * per-day breakdown the worker computes rides along in `by_day`, so the page can still draw spend over time.
 *
 * Nothing here may throw into the caller. On the worker a failed post is a line in the log and a pipeline that
 * carries on; on the API an unreadable snapshot is `null`, which the page renders as "not reported yet" rather
 * than as zero dollars spent.
 */

export type SpendDay = { day: string; discovery: number; extraction: number };
export type SpendSnapshot = {
  discovery: number;
  extraction: number;
  total: number;
  /** The worker's PAID_CAP_USD, so the page can show how much of the budget is gone. Null if it did not say. */
  capUsd: number | null;
  /** When the worker read its ledgers, not when this row was written. */
  at: string;
  byDay: SpendDay[];
};

const DDL = `create table if not exists spend_snapshot (
  id text primary key,
  discovery numeric not null default 0,
  extraction numeric not null default 0,
  cap_usd numeric,
  at timestamptz not null,
  by_day jsonb not null default '[]'::jsonb,
  updated timestamptz not null default now()
)`;

/** One writer (the pipeline worker), one row. A second source would need its own id and a sum on the way out. */
const ROW = "worker";
/** A year of days is more than any chart asks for and keeps one bad post from writing a megabyte of jsonb. */
const MAX_DAYS = 400;

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  ready ||= query(DDL)
    .then(() => undefined)
    .catch((e) => {
      // A failed create must not be remembered as done, or every later read fails against a missing table.
      ready = null;
      throw e;
    });
  return ready;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A number that is really a number: no NaN, no Infinity, no negative dollars, and rounded to the cent. */
function dollars(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * The posted body, checked before it is stored. The endpoint is behind the admin gate, so this is not a trust
 * boundary so much as a correctness one: a snapshot with a NaN in it would put a NaN on the page, and "total"
 * is recomputed from the two parts rather than believed, so the three figures can never disagree.
 */
export function parseSnapshot(body: unknown): { ok: true; value: SpendSnapshot } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "expected an object" };
  const b = body as Record<string, unknown>;
  const discovery = dollars(b.discovery ?? 0);
  const extraction = dollars(b.extraction ?? 0);
  if (discovery === null || extraction === null) return { ok: false, error: "discovery and extraction must be non-negative numbers" };
  const capUsd = b.capUsd == null ? null : dollars(b.capUsd);
  const at = typeof b.at === "string" && !Number.isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : new Date().toISOString();

  const rawDays = Array.isArray(b.byDay) ? b.byDay : [];
  if (rawDays.length > MAX_DAYS) return { ok: false, error: "byDay has more than " + MAX_DAYS + " entries" };
  const byDay: SpendDay[] = [];
  for (const raw of rawDays) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    const day = typeof d.day === "string" && DAY_RE.test(d.day) ? d.day : null;
    const dd = dollars(d.discovery ?? 0);
    const de = dollars(d.extraction ?? 0);
    if (!day || dd === null || de === null) continue;
    byDay.push({ day, discovery: dd, extraction: de });
  }
  byDay.sort((a, b2) => a.day.localeCompare(b2.day));

  return { ok: true, value: { discovery, extraction, total: Math.round((discovery + extraction) * 100) / 100, capUsd, at, byDay } };
}

/** Store the snapshot, replacing the one before it. */
export async function putSpend(s: SpendSnapshot): Promise<void> {
  await ensure();
  await query(
    `insert into spend_snapshot (id, discovery, extraction, cap_usd, at, by_day, updated)
       values ($1, $2, $3, $4, $5, $6::jsonb, now())
     on conflict (id) do update set discovery = excluded.discovery, extraction = excluded.extraction,
       cap_usd = excluded.cap_usd, at = excluded.at, by_day = excluded.by_day, updated = now()`,
    [ROW, s.discovery, s.extraction, s.capUsd, s.at, JSON.stringify(s.byDay)],
  );
}

/**
 * The stored snapshot, or null when there is none. Null is the honest answer for "the worker has not reported
 * yet" and the page must say so; a zero here would read as "Outset has spent nothing", which is a different
 * and false statement.
 */
export async function readSpend(): Promise<SpendSnapshot | null> {
  if (!pgConfigured()) return null;
  try {
    await ensure();
    const rows = await query<{ discovery: string; extraction: string; cap_usd: string | null; at: string | Date; by_day: SpendDay[] | null }>(
      "select discovery, extraction, cap_usd, at, by_day from spend_snapshot where id = $1",
      [ROW],
    );
    const r = rows[0];
    if (!r) return null;
    const parsed = parseSnapshot({
      discovery: Number(r.discovery),
      extraction: Number(r.extraction),
      capUsd: r.cap_usd === null ? null : Number(r.cap_usd),
      at: new Date(r.at).toISOString(),
      byDay: Array.isArray(r.by_day) ? r.by_day : [],
    });
    return parsed.ok ? parsed.value : null;
  } catch (e) {
    console.error("spend snapshot read: " + (e as Error).message);
    return null;
  }
}

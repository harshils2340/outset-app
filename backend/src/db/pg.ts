import pg from "pg";

/**
 * Postgres (Neon) is the store for everything an operator or guest creates: claimed profiles, the email-to-listing
 * index behind sign-in codes, bookings, payouts and the mail suppression list. The catalog itself stays static
 * (public/o/*.json and catalog.json are generated files on the CDN). DATABASE_URL switches this on; with it unset
 * the API refuses to serve, because a booking that lands nowhere is worse than an error.
 */

let pool: pg.Pool | null = null;

export const pgConfigured = () => !!(process.env.DATABASE_URL || "").trim();

/**
 * How long anything is allowed to hold a connection. Nothing bounded this before, and the pool is five wide,
 * so five slow queries wedged the whole API: a guest reading a listing waited the full
 * `connectionTimeoutMillis` and got a 500, and a database that had stopped answering rather than refusing
 * connections held every request for as long as it liked. Ten seconds is far above any query here (the
 * slowest, `/listing-edits`, reads 5,000 small rows), so this only ever turns "hangs" into "fails and frees
 * the connection".
 *
 * The transaction timeout is the same argument for locks: `insertBookingChecked` holds an advisory lock on
 * the listing for its transaction, so a connection left open mid-transaction stops every other booking for
 * that shop until the backend is reaped.
 */
export const POOL_TIMEOUTS = {
  /** Postgres cancels the query itself. */
  statement_timeout: 10_000,
  /** The client's own backstop, for a server that never answers at all. */
  query_timeout: 12_000,
  idle_in_transaction_session_timeout: 15_000,
} as const;

export function db(): pg.Pool {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DATABASE_URL is not set");
  // Neon requires TLS. Setting ssl here (rather than through the URL) keeps pg from warning about sslmode aliases.
  const clean = url.replace(/[?&](sslmode|channel_binding)=[^&]*/g, "").replace(/\?&/, "?").replace(/\?$/, "");
  pool = new pg.Pool({ connectionString: clean, ssl: { rejectUnauthorized: true }, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000, ...POOL_TIMEOUTS });
  pool.on("error", (e) => console.error("[pg] idle client error: " + e.message));
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await db().query<T>(text, params);
  return r.rows;
}

/** One transaction; the callback's client holds any row locks it takes until commit. */
export async function withTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

const SCHEMA = `
create table if not exists profiles (
  id text primary key,
  doc jsonb not null,
  owner_email text,
  published boolean not null default true,
  claimed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists profiles_owner_email on profiles (owner_email);

create table if not exists profile_emails (
  email_hash text not null,
  listing text not null,
  linked_at timestamptz not null default now(),
  primary key (email_hash, listing)
);
create index if not exists profile_emails_listing on profile_emails (listing);

create table if not exists bookings (
  code text primary key,
  listing text not null,
  status text not null,
  date date,
  created timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  doc jsonb not null
);
create index if not exists bookings_listing_created on bookings (listing, created desc);
create index if not exists bookings_status on bookings (status);
create index if not exists bookings_payout_state on bookings ((doc->'payout'->>'state'));

create table if not exists documents (
  key text primary key,
  doc jsonb not null,
  updated_at timestamptz not null default now()
);
`;

let migrated: Promise<void> | null = null;
/** Creates what is missing. Safe to run on every boot; every statement is idempotent. */
export function migratePg(): Promise<void> {
  migrated ||= (async () => {
    for (const stmt of SCHEMA.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await db().query(stmt);
  })();
  return migrated;
}

export async function closePg(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

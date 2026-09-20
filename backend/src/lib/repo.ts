import { query, withTx } from "../db/pg.ts";

/**
 * The private store, on Postgres. Each function is the shape the routes need: read a record, change it under a
 * row lock, list a listing's bookings. Documents keep their JSON shape in a jsonb column, so the types the API
 * already uses (StoredProfile, StoredBooking) are what goes in and comes out; the real columns beside them
 * (owner_email, status, date, payout state) exist for lookups and reports.
 */

/* ---------- profiles ---------- */

type ProfileDoc = { id: string; claimedAt: string; updatedAt: string; owner: { name: string; email: string; phone: string }; published: boolean; [k: string]: unknown };

const profileCols = (p: ProfileDoc) => [p.id, JSON.stringify(p), (p.owner?.email || "").trim().toLowerCase() || null, p.published !== false, p.claimedAt || null, p.updatedAt || new Date().toISOString()];

export async function getProfile<T extends ProfileDoc>(id: string): Promise<T | null> {
  const rows = await query<{ doc: T }>("select doc from profiles where id = $1", [id]);
  return rows[0]?.doc ?? null;
}

/** Read, transform, write, with the row locked for the duration, so two edits cannot overwrite each other. */
export async function updateProfile<T extends ProfileDoc>(id: string, initial: T, fn: (cur: T) => T): Promise<T> {
  return withTx(async (c) => {
    const r = await c.query<{ doc: T }>("select doc from profiles where id = $1 for update", [id]);
    const next = fn(r.rows[0]?.doc ?? initial);
    await c.query(
      `insert into profiles (id, doc, owner_email, published, claimed_at, updated_at) values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set doc = excluded.doc, owner_email = excluded.owner_email, published = excluded.published, claimed_at = excluded.claimed_at, updated_at = excluded.updated_at`,
      profileCols(next),
    );
    return next;
  });
}

/** Write a whole profile as it is (the migration and tests). */
export async function putProfile(p: ProfileDoc): Promise<void> {
  await query(
    `insert into profiles (id, doc, owner_email, published, claimed_at, updated_at) values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do update set doc = excluded.doc, owner_email = excluded.owner_email, published = excluded.published, claimed_at = excluded.claimed_at, updated_at = excluded.updated_at`,
    profileCols(p),
  );
}

export type ProfileEdit = { id: string; published: boolean; patch: Record<string, unknown>; updatedAt: string };

/** What every claimed listing shows guests: the operator's patch and the publish switch. Nothing about the owner. */
export async function listProfileEdits(limit = 5000): Promise<ProfileEdit[]> {
  const rows = await query<{ id: string; published: boolean; patch: Record<string, unknown> | null; updated_at: string }>(
    "select id, published, doc->'patch' as patch, (doc->>'updatedAt') as updated_at from profiles order by updated_at desc limit $1",
    [limit],
  );
  return rows.map((r) => ({ id: r.id, published: r.published !== false, patch: r.patch || {}, updatedAt: r.updated_at || "" }));
}

export async function deleteProfile(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>("delete from profiles where id = $1 returning id", [id]);
  return rows.length > 0;
}

/* ---------- which listings an email may sign in to ---------- */

export async function listingsForEmailHash(hash: string): Promise<string[]> {
  const rows = await query<{ listing: string }>("select listing from profile_emails where email_hash = $1 order by linked_at", [hash]);
  return rows.map((r) => r.listing);
}

export async function linkEmailHash(hash: string, listing: string): Promise<void> {
  await query("insert into profile_emails (email_hash, listing) values ($1, $2) on conflict do nothing", [hash, listing]);
}

/** Forget every email that could sign in to this listing. Returns how many links went. */
export async function unlinkListing(listing: string): Promise<number> {
  const rows = await query<{ email_hash: string }>("delete from profile_emails where listing = $1 returning email_hash", [listing]);
  return rows.length;
}

/* ---------- bookings ---------- */

type BookingDoc = { code: string; listing: string; status: string; date: string; created: string; [k: string]: unknown };

const bookingCols = (b: BookingDoc) => [b.code, b.listing, b.status, /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null, b.created || new Date().toISOString(), JSON.stringify(b)];

/** A listing's bookings, newest first, the order the dashboard shows them. */
export async function listBookings<T extends BookingDoc>(listing: string, limit = 2000): Promise<T[]> {
  const rows = await query<{ doc: T }>("select doc from bookings where listing = $1 order by created desc limit $2", [listing, limit]);
  return rows.map((r) => r.doc);
}

export async function getBooking<T extends BookingDoc>(listing: string, code: string): Promise<T | null> {
  const rows = await query<{ doc: T }>("select doc from bookings where listing = $1 and code = $2", [listing, code]);
  return rows[0]?.doc ?? null;
}

/** True when the row was new. A second booking with the same code is left alone and reported. */
export async function insertBooking(b: BookingDoc): Promise<boolean> {
  const rows = await query<{ code: string }>(
    "insert into bookings (code, listing, status, date, created, doc) values ($1, $2, $3, $4, $5, $6) on conflict (code) do nothing returning code",
    bookingCols(b),
  );
  return rows.length > 0;
}

/**
 * Insert a booking only if `open(existing)` still says the time has room, judged on the listing's bookings as
 * they are at that moment. An advisory lock on the listing serialises this with every other insert for it, so
 * two guests racing for the last spot cannot both get it. "duplicate" means the code already exists.
 */
export async function insertBookingChecked<T extends BookingDoc>(b: T, open: (existing: T[]) => boolean): Promise<"inserted" | "duplicate" | "refused"> {
  return withTx(async (c) => {
    await c.query("select pg_advisory_xact_lock(hashtext($1))", [b.listing]);
    const dup = await c.query("select 1 from bookings where code = $1", [b.code]);
    if (dup.rows.length) return "duplicate";
    const cur = await c.query<{ doc: T }>("select doc from bookings where listing = $1 order by created desc limit 2000", [b.listing]);
    if (!open(cur.rows.map((r) => r.doc))) return "refused";
    await c.query("insert into bookings (code, listing, status, date, created, doc) values ($1, $2, $3, $4, $5, $6)", bookingCols(b));
    return "inserted";
  });
}

/**
 * Change one booking under the listing's advisory lock, with every other booking for the listing available to
 * `fn`. The same lock `insertBookingChecked` takes for a fresh booking, so a capacity check made here (an
 * operator reinstating a declined booking) is serialised against a guest racing a new booking into the same
 * time, not read before that insert's own lock is even taken. `fn` returning "refused" writes nothing;
 * returning its argument unchanged writes nothing either, which is what a decide that changes nothing means.
 */
export async function updateBookingChecked<T extends BookingDoc>(listing: string, code: string, fn: (cur: T, others: T[]) => T | "refused"): Promise<T | null | "refused"> {
  return withTx(async (c) => {
    await c.query("select pg_advisory_xact_lock(hashtext($1))", [listing]);
    const r = await c.query<{ doc: T }>("select doc from bookings where listing = $1 and code = $2 for update", [listing, code]);
    const cur = r.rows[0]?.doc;
    if (!cur) return null;
    const others = await c.query<{ doc: T }>("select doc from bookings where listing = $1 and code <> $2 order by created desc limit 2000", [listing, code]);
    const next = fn(cur, others.rows.map((x) => x.doc));
    if (next === "refused") return "refused";
    if (next !== cur) await c.query("update bookings set status = $3, date = $4, doc = $5, updated_at = now() where listing = $1 and code = $2", [listing, code, next.status, /^\d{4}-\d{2}-\d{2}$/.test(next.date) ? next.date : null, JSON.stringify(next)]);
    return next;
  });
}

/** Write a booking as it is, replacing any row with that code (the migration). */
export async function putBooking(b: BookingDoc): Promise<void> {
  await query(
    `insert into bookings (code, listing, status, date, created, doc) values ($1, $2, $3, $4, $5, $6)
     on conflict (code) do update set listing = excluded.listing, status = excluded.status, date = excluded.date, created = excluded.created, doc = excluded.doc, updated_at = now()`,
    bookingCols(b),
  );
}

/**
 * Change one booking under a row lock. `fn` gets the current record and returns the next one, or the same object
 * to leave it alone. Resolves to the record after the call, or null when there is no such booking.
 */
export async function updateBooking<T extends BookingDoc>(listing: string, code: string, fn: (cur: T) => T): Promise<T | null> {
  return withTx(async (c) => {
    const r = await c.query<{ doc: T }>("select doc from bookings where listing = $1 and code = $2 for update", [listing, code]);
    const cur = r.rows[0]?.doc;
    if (!cur) return null;
    const next = fn(cur);
    if (next !== cur) await c.query("update bookings set status = $3, date = $4, doc = $5, updated_at = now() where listing = $1 and code = $2", [listing, code, next.status, /^\d{4}-\d{2}-\d{2}$/.test(next.date) ? next.date : null, JSON.stringify(next)]);
    return next;
  });
}

/** Listings with money scheduled or paid, the ones a payout run has to look at. */
export async function listingsWithPayouts(): Promise<string[]> {
  const rows = await query<{ listing: string }>("select distinct listing from bookings where doc->'payout'->>'state' in ('scheduled', 'paid') order by listing");
  return rows.map((r) => r.listing);
}

export async function deleteBookingsForListing(listing: string): Promise<number> {
  const rows = await query<{ code: string }>("delete from bookings where listing = $1 returning code", [listing]);
  return rows.length;
}

/* ---------- small documents (the mail suppression list and the like) ---------- */

export async function getDoc<T>(key: string): Promise<T | null> {
  const rows = await query<{ doc: T }>("select doc from documents where key = $1", [key]);
  return rows[0]?.doc ?? null;
}

/* ---------- guest wallets (saved card + Otto spend cap) ---------- */

export type GuestWalletRow = {
  id: string;
  stripe_customer: string | null;
  payment_method: string | null;
  brand: string | null;
  last4: string | null;
  max_cents: number;
  otto: boolean;
  email: string | null;
  setup_session: string | null;
};

function walletFrom(r: GuestWalletRow): GuestWalletRow {
  return {
    id: r.id,
    stripe_customer: r.stripe_customer || null,
    payment_method: r.payment_method || null,
    brand: r.brand || null,
    last4: r.last4 || null,
    max_cents: Number(r.max_cents) || 25000,
    otto: r.otto !== false,
    email: r.email || null,
    setup_session: r.setup_session || null,
  };
}

export async function getWallet(id: string): Promise<GuestWalletRow | null> {
  const rows = await query<GuestWalletRow>("select id, stripe_customer, payment_method, brand, last4, max_cents, otto, email, setup_session from guest_wallets where id = $1", [id]);
  return rows[0] ? walletFrom(rows[0]) : null;
}

export async function insertWallet(id: string): Promise<GuestWalletRow> {
  const rows = await query<GuestWalletRow>(
    `insert into guest_wallets (id) values ($1)
     returning id, stripe_customer, payment_method, brand, last4, max_cents, otto, email, setup_session`,
    [id],
  );
  return walletFrom(rows[0]!);
}

export async function patchWallet(id: string, patch: Partial<Omit<GuestWalletRow, "id">>): Promise<GuestWalletRow | null> {
  const cur = await getWallet(id);
  if (!cur) return null;
  const next: GuestWalletRow = { ...cur, ...patch, id };
  await query(
    `update guest_wallets set stripe_customer = $2, payment_method = $3, brand = $4, last4 = $5, max_cents = $6, otto = $7, email = $8, setup_session = $9, updated_at = now() where id = $1`,
    [id, next.stripe_customer, next.payment_method, next.brand, next.last4, next.max_cents, next.otto, next.email, next.setup_session],
  );
  return next;
}

export async function updateDoc<T>(key: string, initial: T, fn: (cur: T) => T): Promise<T> {
  return withTx(async (c) => {
    const r = await c.query<{ doc: T }>("select doc from documents where key = $1 for update", [key]);
    const next = fn(r.rows[0]?.doc ?? initial);
    await c.query("insert into documents (key, doc) values ($1, $2) on conflict (key) do update set doc = excluded.doc, updated_at = now()", [key, JSON.stringify(next)]);
    return next;
  });
}

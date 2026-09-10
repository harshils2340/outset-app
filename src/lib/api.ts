import type { Unclaimed } from "../data/types";

/**
 * The hosted API that makes the product real: sign-in, persistent operator profiles, bookings that reach
 * the operator. Every call degrades cleanly when the API is unreachable, so the site never breaks, but
 * with VITE_API_URL set this is the production path.
 */
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || "").replace(/\/$/, "");
export const hasApi = () => !!API_URL;

const TOKEN_PREFIX = "outset.claimtoken.";
const SESSION_KEY = "outset.session.v1";

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string | null): void {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

export function rememberClaimToken(id: string, token: string): void {
  lsSet(TOKEN_PREFIX + id, token);
}
export function claimTokenFor(id: string): string | null {
  return lsGet(TOKEN_PREFIX + id);
}

export type ApiSession = { token: string; ids: string[]; email: string; exp: number };
export function loadApiSession(): ApiSession | null {
  try {
    const s = JSON.parse(lsGet(SESSION_KEY) || "null") as ApiSession | null;
    return s && s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}
export function saveApiSession(s: ApiSession | null): void {
  lsSet(SESSION_KEY, s ? JSON.stringify(s) : null);
}

/** Headers that prove we may edit a listing: its claim token if we have one, else the session. */
function authHeaders(id: string): Record<string, string> {
  const h: Record<string, string> = {};
  const t = claimTokenFor(id);
  if (t) h["x-claim-token"] = t;
  const s = loadApiSession();
  if (s) h["x-session"] = s.token;
  return h;
}

async function call<T>(path: string, init: RequestInit & { timeout?: number } = {}): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  if (!API_URL) return { ok: false, status: 0, data: null, error: "no api" };
  try {
    const res = await fetch(API_URL + path, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(init.timeout ?? 12000) });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    return { ok: res.ok, status: res.status, data: res.ok ? data : null, error: data?.error };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message };
  }
}

/* ---------- profiles ---------- */

export type RemoteProfile = { id: string; published: boolean; patch: Partial<Unclaimed>; updatedAt: string; profile?: unknown; owner?: { name: string; email: string; phone: string }; session?: string };

/** The operator's saved state from the API (with auth) or the static site (guest view). */
export async function fetchRemoteProfile(id: string): Promise<RemoteProfile | null> {
  if (API_URL) {
    const r = await call<RemoteProfile>(`/profiles/${encodeURIComponent(id)}`, { headers: authHeaders(id), timeout: 6000 });
    if (r.ok) return r.data;
    if (r.status === 404) return null;
  }
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}profiles/${encodeURIComponent(id)}.json`, { cache: "no-cache", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return (await res.json()) as RemoteProfile;
  } catch {
    return null;
  }
}

/** Records the claim on the server and stores the session it hands back. */
export async function claimRemote(id: string, token: string, owner: { name: string; email: string; phone: string }): Promise<boolean> {
  const r = await call<RemoteProfile>(`/claims/${encodeURIComponent(id)}`, { method: "POST", headers: { "x-claim-token": token }, body: JSON.stringify({ owner }) });
  if (r.ok && r.data?.session) {
    const prior = loadApiSession();
    saveApiSession({ token: r.data.session, ids: Array.from(new Set([...(prior?.ids || []), id])), email: owner.email || prior?.email || "", exp: Date.now() + 29 * 86400000 });
  }
  return r.ok;
}

let pending: ReturnType<typeof setTimeout> | null = null;
let queued: { id: string; body: unknown } | null = null;

/** Debounced: the dashboard saves on every keystroke, the API hears about it once a second. */
export function saveRemoteProfile(id: string, body: { profile: unknown; patch: Partial<Unclaimed>; published: boolean; owner: { name: string; email: string; phone: string } }): void {
  if (!API_URL) return;
  const h = authHeaders(id);
  if (!h["x-claim-token"] && !h["x-session"]) return;
  queued = { id, body };
  if (pending) clearTimeout(pending);
  pending = setTimeout(async () => {
    pending = null;
    const q = queued;
    queued = null;
    if (!q) return;
    await call(`/profiles/${encodeURIComponent(q.id)}`, { method: "PUT", headers: authHeaders(q.id), body: JSON.stringify(q.body), timeout: 15000 });
  }, 1200);
}

/* ---------- sign-in by email code ---------- */

export async function requestSignInCode(email: string): Promise<{ ok: boolean; error?: string }> {
  const r = await call(`/auth/request-code`, { method: "POST", body: JSON.stringify({ email }) });
  return { ok: r.ok, error: r.error };
}

export async function verifySignInCode(email: string, code: string): Promise<{ ok: boolean; ids: string[]; error?: string }> {
  const r = await call<{ session: string; ids: string[]; exp: number }>(`/auth/verify`, { method: "POST", body: JSON.stringify({ email, code }) });
  if (!r.ok || !r.data) return { ok: false, ids: [], error: r.error };
  saveApiSession({ token: r.data.session, ids: r.data.ids, email, exp: r.data.exp });
  return { ok: true, ids: r.data.ids };
}

export function signOutApi(): void {
  saveApiSession(null);
}

/* ---------- config ---------- */

let configCache: { payments: boolean; mail: boolean } | null = null;
/** What the API has switched on. Cached for the session; false for everything when there is no API. */
export async function apiConfig(): Promise<{ payments: boolean; mail: boolean }> {
  if (configCache) return configCache;
  const r = await call<{ payments: boolean; mail: boolean }>(`/config`, { timeout: 5000 });
  configCache = r.ok && r.data ? r.data : { payments: false, mail: false };
  return configCache;
}

/* ---------- bookings ---------- */

export type RemoteBooking = {
  code: string;
  listing: string;
  date: string;
  slot: string;
  qty: number;
  service: string;
  variant: string;
  addons: string[];
  total: number | null;
  guest: { name: string; phone: string; email: string };
  status: "pending" | "new" | "accepted" | "declined" | "completed" | "noshow" | "cancelled";
  created: string;
  decidedAt?: string;
  note?: string;
  payment?: { session: string; intent: string | null; state: "authorized" | "captured" | "released" | "unpaid" };
};

/** The guest's request goes to the operator. Resolves the server's status ("new" or "accepted" for instant book). */
export async function submitBooking(b: Omit<RemoteBooking, "status" | "created">): Promise<{ ok: boolean; status?: RemoteBooking["status"]; checkoutUrl?: string; error?: string }> {
  const r = await call<{ ok: boolean; status: RemoteBooking["status"]; checkoutUrl?: string }>(`/bookings`, { method: "POST", body: JSON.stringify(b), timeout: 25000 });
  return { ok: r.ok, status: r.data?.status, checkoutUrl: r.data?.checkoutUrl, error: r.error };
}

/** After Stripe sends the guest back: confirm the payment landed. */
export async function confirmPaid(listing: string, code: string): Promise<{ status?: string; paid: boolean }> {
  const r = await call<{ status: string; paid: boolean }>(`/bookings/paid/${encodeURIComponent(listing)}/${encodeURIComponent(code)}`, { timeout: 15000 });
  return r.ok && r.data ? r.data : { paid: false };
}

export async function fetchBookings(listing: string): Promise<RemoteBooking[] | null> {
  const r = await call<{ bookings: RemoteBooking[] }>(`/bookings/${encodeURIComponent(listing)}`, { headers: authHeaders(listing) });
  return r.ok && r.data ? r.data.bookings : null;
}

export async function decideBooking(listing: string, code: string, status: RemoteBooking["status"], note?: string): Promise<boolean> {
  const r = await call(`/bookings/${encodeURIComponent(listing)}/${encodeURIComponent(code)}`, { method: "PATCH", headers: authHeaders(listing), body: JSON.stringify({ status, note }) });
  return r.ok;
}

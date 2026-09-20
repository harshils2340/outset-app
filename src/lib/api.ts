import type { Unclaimed } from "../data/types";
import { isHttpsUrlOnHost } from "./urlSafety";

/**
 * The hosted API that makes the product real: sign-in, persistent operator profiles, bookings that reach
 * the operator. Every call degrades cleanly when the API is unreachable, so the site never breaks, but
 * with VITE_API_URL set this is the production path.
 */
// `?.` so this module, and everything under src/lib that imports it, can be loaded by a plain node test run,
// where import.meta.env does not exist. Vite still replaces the whole expression at build time.
export const API_URL = ((import.meta.env?.VITE_API_URL as string | undefined) || "").replace(/\/$/, "");
export const hasApi = () => !!API_URL;

const TOKEN_PREFIX = "outset.claimtoken.";
const SESSION_KEY = "outset.session.v1";
const WALLET_KEY = "outset.wallet.v1";

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

export function loadWalletId(): string | null {
  const id = (lsGet(WALLET_KEY) || "").trim().toLowerCase();
  return /^[a-f0-9]{48}$/.test(id) ? id : null;
}

export function saveWalletId(id: string | null): void {
  lsSet(WALLET_KEY, id);
}

export function rememberClaimToken(id: string, token: string): void {
  lsSet(TOKEN_PREFIX + id, token);
}
export function claimTokenFor(id: string): string | null {
  return lsGet(TOKEN_PREFIX + id);
}
/** Drop this device's proof that it may edit a listing: the claim token and the listing's slot in the session. */
export function forgetClaim(id: string): void {
  lsSet(TOKEN_PREFIX + id, null);
  const s = loadApiSession();
  if (!s) return;
  const ids = s.ids.filter((x) => x !== id);
  saveApiSession(ids.length ? { ...s, ids } : null);
}

export type ApiSession = { token: string; ids: string[]; email: string; exp: number };
export function loadApiSession(): ApiSession | null {
  try {
    const raw: unknown = JSON.parse(lsGet(SESSION_KEY) || "null");
    if (!raw || typeof raw !== "object") return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.token !== "string" || typeof s.email !== "string" || typeof s.exp !== "number") return null;
    if (!Array.isArray(s.ids) || !s.ids.every((x) => typeof x === "string")) return null;
    return s.exp > Date.now() ? (s as unknown as ApiSession) : null;
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

/**
 * The dashboard, told when the API stops accepting this device.
 *
 * A session lasts thirty days and nothing renews it, and the claim link's own token expires too, so every
 * operator who claimed a month ago reaches this state. Nothing used to notice: the profile save is debounced
 * and fire-and-forget, so a 403 was thrown away, and the header went on reading "Saved" because that word is
 * about this browser's storage. The operator went on fixing prices, hours and photos for as long as they liked
 * and not one of those edits reached a guest, while new booking requests stopped arriving just as quietly.
 *
 * It carries the listing the refusal was about, because a device holds a profile per business it has ever
 * claimed plus the demo one, and `applyStoredProfiles` pushes every one of them on each app load. A session
 * for one shop is refused for another by design, so a dashboard that took any refusal as its own would tell an
 * operator with a perfectly good session that they had been signed out.
 */
let onAuthLost: ((id: string) => void) | null = null;
export function onOperatorAuthLost(fn: ((id: string) => void) | null): void {
  onAuthLost = fn;
}
/**
 * What an authenticated operator call's status means for the session behind it. 401 and 403 are the API
 * saying this device may not edit the listing, which is a session or a link that has run out. Everything
 * else, a network failure included, is not a reason to tell somebody they have been signed out.
 */
export function authLost(status: number): boolean {
  return status === 401 || status === 403;
}
const noteStatus = (id: string, status: number) => {
  if (authLost(status)) onAuthLost?.(id);
};

async function call<T>(path: string, init: RequestInit & { timeout?: number } = {}): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  if (!API_URL) return { ok: false, status: 0, data: null, error: "no api" };
  try {
    const res = await fetch(API_URL + path, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(init.timeout ?? 12000) });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    return { ok: res.ok, status: res.status, data: res.ok ? data : null, error: data?.error };
  } catch (e) {
    // `error` is what the screens print, and what the API sends back is written for a guest to read. What
    // fetch throws is not: a guest who pressed "Request to book" while the API was down or slow was shown a
    // toast that read "Failed to fetch." or "signal timed out.", and the claim screen said "Could not send the
    // link: Failed to fetch". Every caller already has its own sentence for an API it could not reach, so leave
    // them to it and put the real reason in the console.
    console.warn(`[api] ${(init.method || "GET") + " " + path}: ${(e as Error).message}`);
    return { ok: false, status: 0, data: null };
  }
}

/* ---------- profiles ---------- */

export type RemoteProfile = { id: string; published: boolean; patch: Partial<Unclaimed>; updatedAt: string; profile?: unknown; owner?: { name: string; email: string; phone: string }; session?: string; alreadyClaimed?: string; claimedAt?: string };

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
/**
 * Someone else may already have claimed this listing, usually a colleague, occasionally a forwarded email.
 * The server says so; the dashboard shows it once. Held here rather than passed down because the screen
 * that claims unmounts the moment the dashboard opens.
 */
let claimNotice: { email: string; at?: string } | null = null;
export function takeClaimNotice(): { email: string; at?: string } | null {
  const n = claimNotice;
  claimNotice = null;
  return n;
}

export async function claimRemote(id: string, token: string, owner?: { name: string; email: string; phone: string }): Promise<boolean> {
  // Send the session too. An expiring link is exchanged for one first, and the raw v2 token on its own is
  // not something the server can check here, so a claim posted with only the token came back 403 and the
  // owner's address was never recorded, which is what sign-in codes and booking alerts run on.
  const r = await call<RemoteProfile>(`/claims/${encodeURIComponent(id)}`, { method: "POST", headers: { ...authHeaders(id), "x-claim-token": token }, body: JSON.stringify(owner ? { owner } : {}) });
  if (r.ok && r.data?.session) {
    const prior = loadApiSession();
    saveApiSession({ token: r.data.session, ids: Array.from(new Set([...(prior?.ids || []), id])), email: owner?.email || prior?.email || "", exp: Date.now() + 29 * 86400000 });
  }
  if (r.ok && r.data?.alreadyClaimed) claimNotice = { email: r.data.alreadyClaimed, at: r.data.claimedAt };
  return r.ok;
}

// One slot per listing, not one for the whole module. An owner of two shops who edits both inside the same
// debounce window used to have the first shop's write silently overwritten by the second's: `queued` held only
// one id at a time, so applyStoredProfiles() looping over every claimed business, or a quick switch between
// two dashboards, sent the last listing touched and dropped every other one for that cycle.
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const queued = new Map<string, unknown>();

/** Debounced per listing: the dashboard saves on every keystroke, the API hears about each business once a second. */
export function saveRemoteProfile(id: string, body: { profile: unknown; patch: Partial<Unclaimed>; published: boolean; owner: { name: string; email: string; phone: string } }): void {
  if (!API_URL) return;
  const h = authHeaders(id);
  // Nothing to prove this device may edit the listing. The session has run out, or this is the demo dashboard
  // a visitor sees before claiming. Either way the edit is going no further than this browser, and the
  // dashboard says which of the two it is, because only it knows whether the profile is the demo one.
  if (!h["x-claim-token"] && !h["x-session"]) {
    onAuthLost?.(id);
    return;
  }
  queued.set(id, body);
  const t = pending.get(id);
  if (t) clearTimeout(t);
  pending.set(id, setTimeout(async () => {
    pending.delete(id);
    const q = queued.get(id);
    queued.delete(id);
    if (q === undefined) return;
    const r = await call(`/profiles/${encodeURIComponent(id)}`, { method: "PUT", headers: authHeaders(id), body: JSON.stringify(q), timeout: 15000 });
    noteStatus(id, r.status);
  }, 1200));
}

/**
 * "Release this listing" in Settings: drop the profile row and every email link, so the listing is unclaimed
 * for guests and on the owner's other devices, not only in this browser.
 *
 * Any save still sitting in the debounce above is thrown away first. A keystroke a second before the press
 * would otherwise land as a PUT after this DELETE and write the whole profile straight back.
 *
 * `false` means the server still holds it, and the caller has to say so rather than report a clean release.
 */
export async function releaseRemoteProfile(id: string): Promise<boolean> {
  const t = pending.get(id);
  if (t) clearTimeout(t);
  pending.delete(id);
  queued.delete(id);
  if (!API_URL) return false;
  const h = authHeaders(id);
  if (!h["x-claim-token"] && !h["x-session"]) return false;
  const r = await call(`/profiles/${encodeURIComponent(id)}`, { method: "DELETE", headers: h, timeout: 10000 });
  return r.ok;
}

/* ---------- claiming from the operator site ---------- */

export type ClaimRule = { known: boolean; hasEmail: boolean; hint: string | null; domains: string[] };

/** Which address a listing's claim link may go to: the one on the operator's site, or any at their domain. */
export async function fetchClaimRule(id: string): Promise<ClaimRule | null> {
  const r = await call<ClaimRule>(`/claims/${encodeURIComponent(id)}/rule`, { timeout: 8000 });
  return r.ok ? r.data : null;
}

export type ClaimRequest =
  // `bypass` and `link` only ever come back for the test bypass (see backend/src/lib/testClaim.ts).
  | { ok: true; sent: boolean; to: string; bypass?: boolean; link?: string }
  | { ok: false; reason: "mismatch" | "none" | "unknown" | "error"; hint?: string | null; domains?: string[]; error?: string };

/** Asks the API to email the signed claim link. The API sends it only to an address it can tie to the business. */
export async function requestClaimLink(id: string, owner: { name: string; email: string; phone: string }): Promise<ClaimRequest> {
  const r = await call<ClaimRequest>(`/claims/${encodeURIComponent(id)}/request`, { method: "POST", body: JSON.stringify(owner), timeout: 25000 });
  if (!r.ok || !r.data) return { ok: false, reason: "error", error: r.error };
  return r.data;
}

/** Owner details carried by a claim link (#claim=<id>&k=<token>&o=<payload>), as typed on the claim screen. */
export function ownerFromHash(hash: string): { name: string; email: string; phone: string } | null {
  const m = hash.match(/[&#]o=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(bytes)) as { n?: unknown; e?: unknown; p?: unknown };
    // The payload is not signed, so hold it to the same bounds the API applies when it mints a link: a hand-edited
    // hash could otherwise seed the profile with a 3000-character name or an address in capitals that never
    // matches the one the server linked for sign-in codes.
    const email = String(o.e || "").trim().toLowerCase().slice(0, 200);
    return { name: String(o.n || "").trim().slice(0, 120), email: EMAIL_RE.test(email) ? email : "", phone: String(o.p || "").trim().slice(0, 40) };
  } catch {
    return null;
  }
}

/* ---------- test bypass, testing only ----------
 * The API only answers these when someone has set OUTSET_TEST_CLAIM_EMAILS on that host and the address
 * asked about is on the list. Everywhere else `testClaimActive` is false and `testUnclaim` fails, so the
 * test UI never renders for a normal visitor or a real operator. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when the API will let this exact address claim and release any listing. False with no API. */
export async function testClaimActive(email: string): Promise<boolean> {
  if (!EMAIL_RE.test(email.trim())) return false;
  const r = await call<{ active: boolean }>(`/claims/test-status?email=${encodeURIComponent(email.trim())}`, { timeout: 8000 });
  return !!(r.ok && r.data?.active);
}

/** A link minted since expiring links landed. It carries its own expiry, so only the API can check it. */
export const isExpiringClaimToken = (token: string) => token.startsWith("v2.");

/**
 * Trades a claim link for a session. An expiring token is signed over the listing id and its expiry, so
 * the static claimKey in the catalog cannot check it and the API has to. Returns "expired" separately so
 * the screen can offer a fresh link rather than calling a perfectly genuine link a bad one.
 */
export async function exchangeClaimToken(id: string, token: string): Promise<{ ok: boolean; expired?: boolean; error?: string }> {
  const r = await call<{ ok: boolean; session: string; exp: number }>(`/claims/${encodeURIComponent(id)}/exchange`, { method: "POST", body: JSON.stringify({ token }), timeout: 15000 });
  if (r.ok && r.data?.session) {
    const prior = loadApiSession();
    saveApiSession({ token: r.data.session, ids: Array.from(new Set([...(prior?.ids || []), id])), email: prior?.email || "", exp: r.data.exp });
    return { ok: true };
  }
  return { ok: false, expired: r.status === 410, error: r.error };
}

/**
 * Enters a dashboard without a claim link and stores the session the API hands back.
 *
 * A claim link is only good if its token matches the claimKey the production sync wrote into the catalog,
 * so on a host without the production CLAIM_SECRET every link is rejected. This asks the API for an
 * ordinary session scoped to the one listing instead, which is signed and verified by that same API.
 * It answers 404 unless the bypass is switched on there for this exact address.
 */
export async function testEnter(id: string, email: string): Promise<{ ok: boolean; error?: string }> {
  const em = email.trim();
  if (!EMAIL_RE.test(em)) return { ok: false, error: "bad email" };
  const r = await call<{ ok: boolean; session: string; exp: number }>(`/claims/${encodeURIComponent(id)}/test-enter`, { method: "POST", body: JSON.stringify({ email: em }), timeout: 20000 });
  if (!r.ok || !r.data?.session) return { ok: false, error: r.error || "the API would not allow that" };
  const prior = loadApiSession();
  saveApiSession({ token: r.data.session, ids: Array.from(new Set([...(prior?.ids || []), id])), email: em, exp: r.data.exp });
  return { ok: true };
}

/** Releases the listing server-side so it is unclaimed again. The caller clears this device separately. */
export async function testUnclaim(id: string, email: string): Promise<{ ok: boolean; removed?: boolean; error?: string }> {
  const r = await call<{ ok: boolean; removed: boolean }>(`/claims/${encodeURIComponent(id)}/test-unclaim`, { method: "POST", body: JSON.stringify({ email: email.trim() }), timeout: 20000 });
  return { ok: r.ok, removed: r.data?.removed, error: r.error };
}

/* ---------- sign-in by email code ---------- */

export async function requestSignInCode(email: string): Promise<{ ok: boolean; error?: string }> {
  const r = await call(`/auth/request-code`, { method: "POST", body: JSON.stringify({ email }) });
  return { ok: r.ok, error: r.error };
}

export async function verifySignInCode(email: string, code: string): Promise<{ ok: boolean; ids: string[]; error?: string }> {
  // Send the session this device already holds. A claim link only ever goes to the address on that business's
  // own website, so an owner of two shops holds one address per shop: without this, signing in with either one
  // came back scoped to that address's listings alone and dropped the other shop, which stayed in the
  // dashboard's switcher and answered 403 on every save. The API verifies the token before it keeps anything
  // from it, so this cannot widen a session beyond what the device already had.
  const prior = loadApiSession();
  const r = await call<{ session: string; ids: string[]; exp: number }>(`/auth/verify`, { method: "POST", headers: prior ? { "x-session": prior.token } : {}, body: JSON.stringify({ email, code }) });
  if (!r.ok || !r.data) return { ok: false, ids: [], error: r.error };
  saveApiSession({ token: r.data.session, ids: r.data.ids, email, exp: r.data.exp });
  return { ok: true, ids: r.data.ids };
}

export function signOutApi(): void {
  saveApiSession(null);
}

/* ---------- warm-up ---------- */

let warmedAt = 0;
/** Wakes the API before it is needed. The host sleeps when idle and the first request after that can take many seconds. */
export function warmApi(): void {
  if (!API_URL || Date.now() - warmedAt < 5 * 60 * 1000) return;
  warmedAt = Date.now();
  void fetch(API_URL + "/health", { signal: AbortSignal.timeout(60000), keepalive: true }).catch(() => undefined);
}

/* ---------- config ---------- */

export type ApiConfig = { payments: boolean; mail: boolean; stripePublishableKey?: string | null };
/** What a page assumes while it has no answer: nothing is switched on. Never remembered as one. */
export const NO_CONFIG: ApiConfig = { payments: false, mail: false, stripePublishableKey: null };
/** An answer worth remembering, read defensively: this is JSON from the network. */
export function normalizeConfig(data: ApiConfig): ApiConfig {
  return { payments: !!data.payments, mail: !!data.mail, stripePublishableKey: data.stripePublishableKey || null };
}
let configCache: ApiConfig | null = null;
let configInFlight: Promise<ApiConfig> | null = null;
/**
 * What the API has switched on. A real answer is remembered for the session; a failure is not.
 *
 * It used to remember the failure too, and the API host sleeps when idle: one `/config` that ran past its five
 * seconds while the host woke up left the listing reading "You won't be charged yet" under a button saying
 * "Request to book · $213", for the rest of that visit, on a shop whose card payments are switched on. Pressing
 * it created a Stripe session all the same, because the API decides that from the listing's own price, so the
 * guest was sent to a card form after being told they would not be charged. It also cost the embedded form, which
 * needs the publishable key from here and quietly fell back to Stripe's hosted page.
 */
export async function apiConfig(): Promise<ApiConfig> {
  if (configCache) return configCache;
  // One read, however many callers: the listing page and the booking both ask as the page opens.
  configInFlight ??= readConfig();
  return configInFlight;
}
async function readConfig(): Promise<ApiConfig> {
  const r = await call<ApiConfig>(`/config`, { timeout: 5000 });
  configInFlight = null;
  if (!r.ok || !r.data) return NO_CONFIG;
  configCache = normalizeConfig(r.data);
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
  /** The API's split of `total`: the operator's price and the guest's service fee, in dollars. */
  pricing?: { subtotal: number; fee: number };
};

/**
 * The guest's request goes to the operator. Resolves the server's status ("new" or "accepted" for instant book).
 * `taken` is true when the API refused because that time filled up while the guest was looking at it.
 */
export async function submitBooking(b: Omit<RemoteBooking, "status" | "created"> & { embedded?: boolean; wallet?: string }): Promise<{ ok: boolean; status?: RemoteBooking["status"]; checkoutUrl?: string; checkoutClientSecret?: string; charged?: boolean; error?: string; taken?: boolean }> {
  const r = await call<{ ok: boolean; status: RemoteBooking["status"]; checkoutUrl?: string; checkoutClientSecret?: string; charged?: boolean }>(`/bookings`, { method: "POST", body: JSON.stringify(b), timeout: 25000, headers: b.wallet ? { "x-wallet": b.wallet } : {} });
  // Every refusal about the time itself, so the page can drop it and reload the picker. "spots left" and "holds
  // N guests" are the API saying the time is there but the party does not fit, which is still a time problem.
  return { ok: r.ok, status: r.data?.status, checkoutUrl: r.data?.checkoutUrl, checkoutClientSecret: r.data?.checkoutClientSecret, charged: !!r.data?.charged, error: r.error, taken: r.status === 409 && /just booked|not open|not enough room|not available|spots? left|holds \d+ guest/i.test(r.error || "") };
}

export type GuestWallet = { ready: boolean; brand: string | null; last4: string | null; maxDollars: number; otto: boolean };

function walletHeaders(): Record<string, string> {
  const id = loadWalletId();
  return id ? { "x-wallet": id } : {};
}

export async function createGuestWallet(): Promise<string | null> {
  const r = await call<{ id: string }>("/wallet", { method: "POST" });
  if (!r.ok || !r.data?.id) return null;
  saveWalletId(r.data.id);
  return r.data.id;
}

export async function fetchGuestWallet(): Promise<GuestWallet | null> {
  if (!loadWalletId()) return null;
  const r = await call<GuestWallet>("/wallet", { headers: walletHeaders() });
  return r.ok && r.data ? r.data : null;
}

export async function setupGuestWallet(email?: string): Promise<string | null> {
  if (!loadWalletId() && !(await createGuestWallet())) return null;
  const r = await call<{ url: string }>("/wallet/setup", { method: "POST", headers: walletHeaders(), body: JSON.stringify({ email: email || undefined }), timeout: 25000 });
  return r.ok && r.data?.url && isHttpsUrlOnHost(r.data.url, "checkout.stripe.com") ? r.data.url : null;
}

export async function readyGuestWallet(): Promise<GuestWallet | null> {
  if (!loadWalletId()) return null;
  const r = await call<GuestWallet>("/wallet/ready", { method: "POST", headers: walletHeaders(), timeout: 20000 });
  return r.ok && r.data ? r.data : null;
}

export async function patchGuestWallet(patch: { maxDollars?: number; otto?: boolean }): Promise<GuestWallet | null> {
  if (!loadWalletId()) return null;
  const r = await call<GuestWallet>("/wallet", { method: "PATCH", headers: walletHeaders(), body: JSON.stringify(patch) });
  return r.ok && r.data ? r.data : null;
}

export async function revokeGuestWallet(): Promise<GuestWallet | null> {
  if (!loadWalletId()) return null;
  const r = await call<GuestWallet>("/wallet", { method: "DELETE", headers: walletHeaders() });
  return r.ok && r.data ? r.data : null;
}

export type OpenSlots = { known: boolean; claimed: boolean; days: { date: string; slots: string[] }[] };

/**
 * Which start times a guest may still book: the shop's hours, notice and days off when it has claimed, the
 * standard times otherwise, minus every time that is already taken. `known: false` with no API, and the page
 * keeps its published times.
 *
 * `guests` is the party the page is about to book for. Capacity is per time, so a time with one seat left is
 * open to one guest and not to two; without it the picker offered such a time to a family of four, who were
 * refused, reloaded, and saw it offered again.
 */
export async function fetchOpenSlots(id: string, from: string, days = 14, service?: string, guests?: number): Promise<OpenSlots> {
  const q = new URLSearchParams({ from, days: String(days) });
  if (service) q.set("service", service);
  if (guests && guests > 1) q.set("guests", String(Math.min(Math.round(guests), 60)));
  const r = await call<OpenSlots>(`/bookings/open/${encodeURIComponent(id)}?${q}`, { timeout: 12000 });
  return r.ok && r.data?.known ? { ...r.data, days: r.data.days || [] } : { known: false, claimed: false, days: [] };
}

/** After Stripe sends the guest back: confirm the payment landed. */
export async function confirmPaid(listing: string, code: string): Promise<{ status?: string; paid: boolean }> {
  const r = await call<{ status: string; paid: boolean }>(`/bookings/paid/${encodeURIComponent(listing)}/${encodeURIComponent(code)}`, { timeout: 15000 });
  return r.ok && r.data ? r.data : { paid: false };
}

/**
 * What the operator has done with one booking: "new" while it is still a request, then "accepted",
 * "declined", "cancelled" or "completed". The same public route the Stripe return reads, which answers a
 * plain status when there is no payment to check.
 *
 * The guest's own device knows only that it sent the booking. Without this the Trips tab listed a request the
 * operator had declined as an upcoming trip, with a code and a time, on a day the shop was not expecting them.
 */
export async function bookingStatus(listing: string, code: string): Promise<string | null> {
  const r = await call<{ status: string }>(`/bookings/paid/${encodeURIComponent(listing)}/${encodeURIComponent(code)}`, { timeout: 12000 });
  return r.ok && r.data?.status ? r.data.status : null;
}

export async function fetchBookings(listing: string): Promise<RemoteBooking[] | null> {
  // Without a claim token or a session the API answers 403 every time, and the demo dashboard a visitor sees
  // before claiming has neither: it was asking for the demo shop's bookings every 45 seconds and logging a 403 each.
  if (!claimTokenFor(listing) && !loadApiSession()) return null;
  const r = await call<{ bookings: RemoteBooking[] }>(`/bookings/${encodeURIComponent(listing)}`, { headers: authHeaders(listing) });
  // A refused poll is how an expired session shows up first: new requests simply stop arriving in the feed.
  noteStatus(listing, r.status);
  return r.ok && r.data ? r.data.bookings : null;
}

export async function decideBooking(listing: string, code: string, status: RemoteBooking["status"], note?: string): Promise<boolean> {
  const r = await call(`/bookings/${encodeURIComponent(listing)}/${encodeURIComponent(code)}`, { method: "PATCH", headers: authHeaders(listing), body: JSON.stringify({ status, note }) });
  noteStatus(listing, r.status);
  return r.ok;
}

/* ---------- live availability ---------- */

/**
 * `timeUnknown` marks a row that only says the date is open: the vendor's own times were never read, so its
 * `startsAt` carries a midnight that means nothing. See `liveTimes.ts`, which drops them.
 */
export type AvailabilitySlot = { startsAt: string; label: string; priceCents?: number; seatsLeft?: number; bookUrl: string; timeUnknown?: true };
export type AvailabilityDay = { date: string; slots: AvailabilitySlot[] };
export type LiveAvailability = { vendor: "fareharbor" | "peek" | "xola" | null; live: boolean; updatedAt?: string; days: AvailabilityDay[]; partial?: boolean; note?: string };

/**
 * The operator's real open dates and times, read from their own booking system (FareHarbor, Peek, Xola).
 * Always resolves: with no API, an unsupported booking system or a vendor that did not answer it comes
 * back `live: false` with no days, and the caller keeps showing whatever it showed before.
 */
/**
 * One listing view asks for the same dates from three places at once: the booking box, the phone sheet and the
 * assistant. Those were three requests to the same URL, and with the API's per-caller limit now actually
 * counting, a guest opening a few listings could be rate-limited out of the times they came to see. Calls in
 * flight share one promise, and an answer is kept for five minutes, well inside the API's own ten-minute cache.
 */
const availCache = new Map<string, { at: number; value: Promise<LiveAvailability> }>();
const AVAIL_TTL_MS = 5 * 60 * 1000;

export async function fetchAvailability(id: string, from?: string, days = 14): Promise<LiveAvailability> {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  q.set("days", String(days));
  const key = `${id}|${from || ""}|${days}`;
  const hit = availCache.get(key);
  if (hit && Date.now() - hit.at < AVAIL_TTL_MS) return hit.value;
  const value = (async () => {
    const r = await call<LiveAvailability>(`/availability/${encodeURIComponent(id)}?${q}`, { timeout: 15000 });
    return r.ok && r.data?.live ? { ...r.data, days: r.data.days || [] } : { vendor: r.data?.vendor ?? null, live: false, days: [] };
  })();
  availCache.set(key, { at: Date.now(), value });
  // A failed lookup must not be pinned for five minutes; only a real answer is worth keeping.
  void value.catch(() => availCache.delete(key));
  if (availCache.size > 40) for (const [k, v] of availCache) if (Date.now() - v.at > AVAIL_TTL_MS) availCache.delete(k);
  return value;
}

/* ---------- photo uploads ---------- */

/**
 * The API refuses anything over 1.8 MB of JPEG. Aim under it with room to spare, because base64 and the JSON
 * wrapper travel with the bytes.
 */
const UPLOAD_MAX_BYTES = 1_700_000;

/** Bytes a data URL carries, from the length of its base64 tail. */
export function dataUrlBytes(url: string): number {
  const b64 = url.slice(url.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/**
 * The passes the browser tries, in order, until one fits. 1600px at good quality is what a listing photo
 * wants; a detailed photograph (spray, foliage, a crowd) can still come out of that pass over the cap, and
 * the operator can do nothing about it, because this code made the file, not them. Telling them to "keep it
 * under 1.8 MB" was advice for a file they never had. Shrink it here instead, and only give up when even the
 * smallest pass is too big.
 */
const UPLOAD_PASSES: { max: number; quality: number }[] = [
  { max: 1600, quality: 0.86 },
  { max: 1600, quality: 0.72 },
  { max: 1280, quality: 0.68 },
  { max: 1024, quality: 0.62 },
];

/** Resize in the browser, send JPEG bytes, get back a URL on the site. */
export async function uploadPhoto(listing: string, file: File): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!API_URL) return { ok: false, error: "Uploads switch on once the API is connected." };
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    const src = URL.createObjectURL(file);
    const done = (run: () => void) => { URL.revokeObjectURL(src); run(); };
    el.onload = () => done(() => resolve(el));
    // Every browser reads JPEG and PNG; a phone's HEIC or a RAW file lands here, and so does a renamed PDF.
    el.onerror = () => done(() => reject(new Error("We couldn't read that file. JPEG or PNG works best.")));
    el.src = src;
  });
  let data = "";
  for (const pass of UPLOAD_PASSES) {
    const scale = Math.min(1, pass.max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    // Without this the drawImage below threw inside an onload handler and the promise never settled, so the
    // button sat on "Uploading 1..." for the rest of the session.
    if (!ctx) return { ok: false, error: "This browser can't resize photos. Try another one." };
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    data = canvas.toDataURL("image/jpeg", pass.quality);
    if (dataUrlBytes(data) <= UPLOAD_MAX_BYTES) break;
  }
  if (!data || dataUrlBytes(data) > UPLOAD_MAX_BYTES) return { ok: false, error: "That photo is too detailed to send. Try a smaller one." };
  const r = await call<{ ok: boolean; url: string }>(`/uploads/${encodeURIComponent(listing)}`, { method: "POST", headers: authHeaders(listing), body: JSON.stringify({ data, type: "image/jpeg" }), timeout: 45000 });
  return { ok: r.ok, url: r.data?.url, error: r.error };
}

/* ---------- payouts ---------- */

export type PayoutInterval = "weekly" | "biweekly";
export type PayoutState = "scheduled" | "paid" | "reversed" | "cancelled";
export type PayoutLine = { code: string; date: string; amount: number; currency: string; state: PayoutState; paidAt?: string };

/**
 * A connected account also carries its ledger. Amounts are in cents. nextPayoutOn is a Monday (YYYY-MM-DD);
 * nextAmount goes out that day, upcoming waits on later trip dates, paidTotal has already been sent.
 */
export type PayoutStatus = {
  available: boolean;
  connected?: boolean;
  enabled?: boolean;
  detailsSubmitted?: boolean;
  interval?: PayoutInterval;
  currency?: string;
  nextPayoutOn?: string;
  nextAmount?: number;
  upcoming?: number;
  paidTotal?: number;
  /** One line per currency the listing has been paid in; the fields above are the first (main) one. */
  totals?: { currency: string; nextAmount: number; upcoming: number; paidTotal: number }[];
  history?: PayoutLine[];
};

export async function payoutStatus(listing: string): Promise<PayoutStatus> {
  // Same as fetchBookings: with nothing to authorise the request, the API answers 403 and the demo dashboard logged one.
  if (!claimTokenFor(listing) && !loadApiSession()) return { available: false };
  const r = await call<PayoutStatus>(`/payouts/${encodeURIComponent(listing)}`, { headers: authHeaders(listing), timeout: 15000 });
  return r.ok && r.data ? r.data : { available: false };
}

/** Weekly or every two weeks, both paid on Mondays. */
export async function setPayoutSchedule(listing: string, interval: PayoutInterval): Promise<{ ok: boolean; interval?: PayoutInterval; error?: string }> {
  const r = await call<{ ok: boolean; interval: PayoutInterval }>(`/payouts/${encodeURIComponent(listing)}/schedule`, { method: "PUT", headers: authHeaders(listing), body: JSON.stringify({ interval }), timeout: 15000 });
  return { ok: r.ok && !!r.data?.ok, interval: r.data?.interval, error: r.error };
}

/** Sends the operator to Stripe's hosted onboarding; they come back to the Payouts page. */
export async function connectPayouts(listing: string): Promise<{ url?: string; error?: string }> {
  const r = await call<{ url: string }>(`/payouts/${encodeURIComponent(listing)}/connect`, { method: "POST", headers: authHeaders(listing), timeout: 25000 });
  return { url: r.data?.url, error: r.error };
}

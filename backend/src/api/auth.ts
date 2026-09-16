import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type Next } from "hono";
import { claimKeyHash, claimSecret } from "../lib/claim.ts";
import { sendMail } from "../lib/mail.ts";
import { renderEmail } from "../lib/emailTemplate.ts";
import { linkEmailHash, listingsForEmailHash } from "../lib/repo.ts";

/**
 * Operator sign-in without passwords.
 *  - A signed claim link (token in the email) proves ownership of one listing.
 *  - Returning operators ask for a 6-digit code by email; it maps to every listing that email has claimed.
 *  - Both hand out a session: an HMAC-signed, expiring token bound to the listing ids it may edit.
 */

export const ID = /^[a-z0-9-]{3,80}$/;
const SESSION_DAYS = 30;

export type Session = { ids: string[]; email: string; exp: number };

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (payload: string) => createHmac("sha256", claimSecret()).update(payload).digest("base64url");

export function signSession(s: Session): string {
  const payload = b64(JSON.stringify(s));
  return payload + "." + sign(payload);
}

export function verifySession(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = sign(payload);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!Array.isArray(s.ids) || typeof s.exp !== "number" || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * The listings a freshly minted session should cover: the one the caller just proved, plus everything the
 * session they arrived with already held. A session is one token for every listing it may edit, so a route
 * that mints one without this signs the operator out of their other shops.
 */
export function idsWith(prior: Session | null, id: string): string[] {
  return Array.from(new Set([...(prior?.ids || []), id]));
}

/**
 * The request's JSON body as an object, always. `c.req.json()` resolves to null for a body of `null`, which is
 * valid JSON, and every route then read a field off it and answered 500 to what is only bad input. Anything that
 * is not a plain object (null, a number, a string, an array) comes back as {} so the route's own checks run.
 */
export async function jsonBody<T extends object>(c: Context): Promise<Partial<T>> {
  const v = await c.req.json().catch(() => null);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<T>) : {};
}

/** True when the request may edit listing `id`: a valid claim token for it, or a session that lists it. */
export function mayEdit(c: Context, id: string): boolean {
  if (!ID.test(id)) return false;
  const claim = c.req.header("x-claim-token");
  if (claim && claim.length < 200) {
    const h = createHash("sha256").update(claim).digest("hex");
    const want = claimKeyHash(id);
    if (h.length === want.length && timingSafeEqual(Buffer.from(h), Buffer.from(want))) return true;
  }
  const s = verifySession(c.req.header("x-session"));
  return !!s && s.ids.includes(id);
}

export const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);

/** Which listings an email has claimed (profile_emails, keyed by a hash of the address). */
export async function idsForEmail(email: string): Promise<string[]> {
  return listingsForEmailHash(emailHash(email));
}

export async function linkEmailToListing(email: string, id: string): Promise<void> {
  if (!email.trim() || !ID.test(id)) return;
  await linkEmailHash(emailHash(email), id);
}

/* ---------- rate limiting, in memory, per IP and per route ---------- */

const hits = new Map<string, number[]>();
/**
 * Who to count a request against. X-Forwarded-For is a list the caller starts and each proxy appends to, so
 * the first entry is whatever the caller typed: rotating a spoofed one walked straight through the ten-an-hour
 * claim limit in testing. The last entry is the one our own proxy wrote and is the only one a caller cannot
 * choose, so that is the one we trust.
 */
export function clientIp(c: Context): string {
  const chain = (c.req.header("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return chain[chain.length - 1] || c.req.header("x-real-ip") || "local";
}
export function rateLimit(limit: number, windowMs: number) {
  return async (c: Context, next: Next) => {
    const key = clientIp(c) + "|" + c.req.routePath;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) return c.json({ error: "too many requests, try again later" }, 429);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 50000) hits.clear();
    await next();
  };
}

/* ---------- email codes ---------- */

const codes = new Map<string, { hash: string; exp: number; tries: number }>();

/**
 * The per-IP limit does not protect one address: a code is six digits and lives ten minutes, so guessing from
 * many addresses never trips a per-account ceiling, and asking for a code in a loop both floods the owner's
 * inbox from our sending domain and overwrites the real code they are trying to type. Counted per email too.
 */
const perEmail = new Map<string, number[]>();
export function emailLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (perEmail.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) return false;
  arr.push(now);
  perEmail.set(key, arr);
  if (perEmail.size > 20000) perEmail.clear();
  return true;
}
const codeHash = (email: string, code: string) => createHmac("sha256", claimSecret()).update(email.toLowerCase() + ":" + code).digest("hex");

export const auth = new Hono();

auth.post("/auth/request-code", rateLimit(20, 60 * 60 * 1000), async (c) => {
  const body = await jsonBody<{ email: string }>(c);
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "enter a valid email" }, 400);
  // Same answer either way, so this cannot be probed for whether an address has an account.
  if (!emailLimit("req:" + email, 5, 60 * 60 * 1000)) return c.json({ ok: true });
  const ids = await idsForEmail(email);
  if (ids.length) {
    const code = String(randomInt(100000, 999999));
    codes.set(email, { hash: codeHash(email, code), exp: Date.now() + 10 * 60 * 1000, tries: 0 });
    await sendMail({
      to: email,
      subject: "Your Outset sign-in code: " + code,
      ...renderEmail({
        eyebrow: "Sign in",
        heading: `Your code is ${code}`,
        intro: ["Type it on the sign-in screen. It works for 10 minutes."],
        after: ["If you did not ask for it, ignore this email and nothing changes."],
      }),
    });
  }
  return c.json({ ok: true });
});

auth.post("/auth/verify", rateLimit(30, 60 * 60 * 1000), async (c) => {
  const body = await jsonBody<{ email: string; code: string }>(c);
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").replace(/\D/g, "");
  if (!emailLimit("ver:" + email, 15, 60 * 60 * 1000)) return c.json({ error: "too many attempts, try again later" }, 429);
  const rec = codes.get(email);
  if (!rec || rec.exp < Date.now()) return c.json({ error: "code expired, request a new one" }, 400);
  rec.tries += 1;
  if (rec.tries > 5) {
    codes.delete(email);
    return c.json({ error: "too many attempts, request a new code" }, 400);
  }
  const want = codeHash(email, code);
  if (want.length !== rec.hash.length || !timingSafeEqual(Buffer.from(want), Buffer.from(rec.hash))) return c.json({ error: "that code does not match" }, 400);
  codes.delete(email);
  const ids = await idsForEmail(email);
  const session: Session = { ids, email, exp: Date.now() + SESSION_DAYS * 86400000 };
  return c.json({ session: signSession(session), ids, exp: session.exp });
});

auth.get("/auth/session", (c) => {
  const s = verifySession(c.req.header("x-session"));
  return s ? c.json({ ids: s.ids, email: s.email, exp: s.exp }) : c.json({ error: "no session" }, 401);
});

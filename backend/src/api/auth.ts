import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type Next } from "hono";
import { claimKeyHash, claimSecret } from "../lib/claim.ts";
import { sendMail } from "../lib/mail.ts";
import { readJson, updateJson } from "../lib/store.ts";

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

/** Which listings an email has claimed. profiles/index.json: { [emailHash]: ids[] }. */
export async function idsForEmail(email: string): Promise<string[]> {
  const idx = (await readJson<Record<string, string[]>>("profiles/index.json")) || {};
  return idx[emailHash(email)] || [];
}

export async function linkEmailToListing(email: string, id: string): Promise<void> {
  if (!email.trim() || !ID.test(id)) return;
  const h = emailHash(email);
  await updateJson<Record<string, string[]>>(
    "profiles/index.json",
    {},
    (idx) => {
      const cur = new Set(idx[h] || []);
      cur.add(id);
      return { ...idx, [h]: Array.from(cur) };
    },
    `Claim index: ${id}`,
  );
}

/* ---------- rate limiting, in memory, per IP and per route ---------- */

const hits = new Map<string, number[]>();
export function clientIp(c: Context): string {
  return (c.req.header("x-forwarded-for") || "").split(",")[0].trim() || c.req.header("x-real-ip") || "local";
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
const codeHash = (email: string, code: string) => createHmac("sha256", claimSecret()).update(email.toLowerCase() + ":" + code).digest("hex");

export const auth = new Hono();

auth.post("/auth/request-code", rateLimit(20, 60 * 60 * 1000), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "enter a valid email" }, 400);
  const ids = await idsForEmail(email);
  // Always answer the same way so an address cannot be probed for accounts.
  if (ids.length) {
    const code = String(randomInt(100000, 999999));
    codes.set(email, { hash: codeHash(email, code), exp: Date.now() + 10 * 60 * 1000, tries: 0 });
    await sendMail({ to: email, subject: "Your Outset sign-in code: " + code, text: `Your Outset sign-in code is ${code}. It works for 10 minutes.\n\nIf you did not ask for it, ignore this email.` });
  }
  return c.json({ ok: true });
});

auth.post("/auth/verify", rateLimit(30, 60 * 60 * 1000), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").replace(/\D/g, "");
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

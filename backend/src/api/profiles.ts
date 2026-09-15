import { Hono } from "hono";
import { ID, idsWith, jsonBody, linkEmailToListing, mayEdit, rateLimit, signSession, verifySession } from "./auth.ts";
import { maskEmail } from "../lib/claimIndex.ts";
import { getProfile, listProfileEdits, updateProfile } from "../lib/repo.ts";

/**
 * Operator profiles, one row per listing in Postgres. Guests read the `patch` (title, photos, menu, hours...) and
 * the publish switch through GET /profiles/:id when a listing opens, and the nightly catalog sync reads them all
 * through GET /listing-edits to bake them into the rails. The owner's device restores the full `profile` from the
 * API. Writes need a claim token for that listing or a session that lists it. Nothing here touches a repository.
 */

export type StoredProfile = {
  id: string;
  claimedAt: string;
  updatedAt: string;
  owner: { name: string; email: string; phone: string };
  published: boolean;
  profile: unknown;
  patch: Record<string, unknown>;
  /** Addresses that claimed this listing after the first one; a forwarded link leaves a trace here. */
  alsoClaimedBy?: string[];
};

const fresh = (id: string, now: string): StoredProfile => ({ id, claimedAt: now, updatedAt: now, owner: { name: "", email: "", phone: "" }, published: true, profile: null, patch: {} });
const cleanOwner = (o: Partial<StoredProfile["owner"]> | undefined, cur: StoredProfile["owner"]) =>
  o ? { name: String(o.name ?? cur.name).slice(0, 120), email: String(o.email ?? cur.email).trim().toLowerCase().slice(0, 200), phone: String(o.phone ?? cur.phone).slice(0, 40) } : cur;

export const profiles = new Hono();

/** Every claimed listing's guest-visible edits, for the nightly catalog sync. Nothing about the owners. */
profiles.get("/listing-edits", rateLimit(60, 60 * 60 * 1000), async (c) => c.json({ edits: await listProfileEdits() }));

profiles.get("/profiles/:id", async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const rec = await getProfile<StoredProfile>(id);
  if (!rec) return c.json({ error: "not found" }, 404);
  if (mayEdit(c, id)) return c.json(rec);
  return c.json({ id: rec.id, published: rec.published, patch: rec.patch, updatedAt: rec.updatedAt });
});

/** The email link. Records the claim and hands back a session so the device no longer needs the token. */
profiles.post("/claims/:id", rateLimit(30, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!mayEdit(c, id)) return c.json({ error: "invalid claim link" }, 403);
  const body = await jsonBody<{ owner: Partial<StoredProfile["owner"]> }>(c);
  const now = new Date().toISOString();
  let priorEmail = "";
  let takenOver = false;
  /**
   * A claim link is a bearer token: whoever holds it gets in. A forwarded email therefore reaches a stranger,
   * and before this the second claimer silently became a second owner with permanent sign-in-by-code access
   * while the real owner was told nothing. Access still follows the token, because locking out an owner who
   * claims from a second address of their own would be worse; but the first claim is remembered, every later
   * address is recorded, and the answer says so, so the dashboard can warn and a human can see it happen.
   */
  // Read and write under one lock, so a claim cannot overwrite a payout or profile saved a moment earlier.
  const rec = await updateProfile<StoredProfile>(id, fresh(id, now), (cur) => {
    const next = { ...cur };
    priorEmail = cur.owner.email;
    next.owner = cleanOwner(body.owner, cur.owner);
    takenOver = !!priorEmail && !!next.owner.email && priorEmail.toLowerCase() !== next.owner.email.toLowerCase();
    if (takenOver) next.alsoClaimedBy = Array.from(new Set([...(cur.alsoClaimedBy || []), next.owner.email.toLowerCase()]));
    next.updatedAt = now;
    return next;
  });
  if (takenOver) console.warn(`[claim] ${id} first claimed by ${maskEmail(priorEmail)} on ${rec.claimedAt}, now also claimed by ${maskEmail(rec.owner.email)}`);
  if (rec.owner.email) await linkEmailToListing(rec.owner.email, id);
  const prior = verifySession(c.req.header("x-session"));
  const session = signSession({ ids: idsWith(prior, id), email: rec.owner.email || prior?.email || "", exp: Date.now() + 30 * 86400000 });
  return c.json({ ...rec, session, ...(takenOver ? { alreadyClaimed: maskEmail(priorEmail), claimedAt: rec.claimedAt } : {}) });
});

profiles.put("/profiles/:id", rateLimit(600, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  const text = await c.req.text();
  if (text.length > 600_000) return c.json({ error: "too large" }, 413);
  let body: { profile?: unknown; patch?: Record<string, unknown>; published?: boolean; owner?: Partial<StoredProfile["owner"]> };
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  // `null`, a number and an array are all valid JSON and none of them is a profile. Reading a field off one
  // answered 500 to what is only a bad request.
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "bad json" }, 400);
  const now = new Date().toISOString();
  let before = "";
  const rec = await updateProfile<StoredProfile>(id, fresh(id, now), (cur) => {
    const next = { ...cur };
    if (body.profile !== undefined) next.profile = body.profile;
    if (body.patch && typeof body.patch === "object") next.patch = body.patch;
    if (typeof body.published === "boolean") next.published = body.published;
    before = cur.owner.email;
    next.owner = cleanOwner(body.owner, cur.owner);
    next.updatedAt = now;
    return next;
  });
  if (rec.owner.email && rec.owner.email !== before) await linkEmailToListing(rec.owner.email, id);
  return c.json({ ok: true, updatedAt: now });
});

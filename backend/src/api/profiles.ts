import { Hono } from "hono";
import { ID, linkEmailToListing, mayEdit, rateLimit, signSession, verifySession } from "./auth.ts";
import { readJson, writeJson } from "../lib/store.ts";

/**
 * Operator profiles: one JSON document per listing under public/profiles/. The guest site reads the
 * `patch` (title, photos, menu, hours...) at build time and on listing open; the owner's device restores
 * the full `profile`. Writes need a claim token for that listing or a session that lists it.
 */

export type StoredProfile = {
  id: string;
  claimedAt: string;
  updatedAt: string;
  owner: { name: string; email: string; phone: string };
  published: boolean;
  profile: unknown;
  patch: Record<string, unknown>;
};

const path = (id: string) => `profiles/${id}.json`;
const fresh = (id: string, now: string): StoredProfile => ({ id, claimedAt: now, updatedAt: now, owner: { name: "", email: "", phone: "" }, published: true, profile: null, patch: {} });
const cleanOwner = (o: Partial<StoredProfile["owner"]> | undefined, cur: StoredProfile["owner"]) =>
  o ? { name: String(o.name ?? cur.name).slice(0, 120), email: String(o.email ?? cur.email).trim().toLowerCase().slice(0, 200), phone: String(o.phone ?? cur.phone).slice(0, 40) } : cur;

export const profiles = new Hono();

profiles.get("/profiles/:id", async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const rec = await readJson<StoredProfile>(path(id));
  if (!rec) return c.json({ error: "not found" }, 404);
  if (mayEdit(c, id)) return c.json(rec);
  return c.json({ id: rec.id, published: rec.published, patch: rec.patch, updatedAt: rec.updatedAt });
});

/** The email link. Records the claim and hands back a session so the device no longer needs the token. */
profiles.post("/claims/:id", rateLimit(30, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!mayEdit(c, id)) return c.json({ error: "invalid claim link" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { owner?: Partial<StoredProfile["owner"]> };
  const now = new Date().toISOString();
  const rec = (await readJson<StoredProfile>(path(id))) || fresh(id, now);
  rec.owner = cleanOwner(body.owner, rec.owner);
  rec.updatedAt = now;
  await writeJson(path(id), rec, `Claim: ${id}`);
  if (rec.owner.email) await linkEmailToListing(rec.owner.email, id);
  const prior = verifySession(c.req.header("x-session"));
  const ids = Array.from(new Set([...(prior?.ids || []), id]));
  const session = signSession({ ids, email: rec.owner.email || prior?.email || "", exp: Date.now() + 30 * 86400000 });
  return c.json({ ...rec, session });
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
  const now = new Date().toISOString();
  const rec = (await readJson<StoredProfile>(path(id))) || fresh(id, now);
  if (body.profile !== undefined) rec.profile = body.profile;
  if (body.patch && typeof body.patch === "object") rec.patch = body.patch;
  if (typeof body.published === "boolean") rec.published = body.published;
  const before = rec.owner.email;
  rec.owner = cleanOwner(body.owner, rec.owner);
  rec.updatedAt = now;
  await writeJson(path(id), rec, `Profile: ${id} edited by the operator`);
  if (rec.owner.email && rec.owner.email !== before) await linkEmailToListing(rec.owner.email, id);
  return c.json({ ok: true, updatedAt: now });
});

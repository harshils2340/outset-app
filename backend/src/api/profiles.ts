import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { claimKeyHash } from "../lib/claim.ts";

/**
 * Persistent operator profiles with no database to host. A claimed operator's edits are one JSON file per
 * listing under public/profiles/. Written to the GitHub repo when GITHUB_TOKEN is set (so the static site
 * rebuilds and guests see the edits), or to the local checkout when running on the laptop.
 * Auth is the signed claim token from the email: its SHA-256 must match the hash derived from the secret.
 */

const here = dirname(fileURLToPath(import.meta.url));
const localDir = join(here, "../../../public/profiles");
const REPO = process.env.GITHUB_REPO || "harshils2340/outset-app";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const ID = /^[a-z0-9-]{3,80}$/;

export type StoredProfile = {
  id: string;
  claimedAt: string;
  updatedAt: string;
  owner: { name: string; email: string; phone: string };
  published: boolean;
  /** The operator's full dashboard state, so any device with the link resumes where they left off. */
  profile: unknown;
  /** The guest-facing overlay the app computes from the profile: title, blurb, cover, photos, options, services... */
  patch: Record<string, unknown>;
};

function authorized(id: string, token: string | undefined): boolean {
  if (!token || !ID.test(id)) return false;
  return createHash("sha256").update(token).digest("hex") === claimKeyHash(id);
}

async function github(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch("https://api.github.com/repos/" + REPO + "/contents/" + path, {
    ...init,
    headers: { authorization: "Bearer " + process.env.GITHUB_TOKEN, accept: "application/vnd.github+json", "user-agent": "outset-api", ...(init.headers || {}) },
  });
}

export async function readStored(id: string): Promise<StoredProfile | null> {
  const local = join(localDir, id + ".json");
  if (existsSync(local)) return JSON.parse(readFileSync(local, "utf8")) as StoredProfile;
  if (process.env.GITHUB_TOKEN) {
    const res = await github(`public/profiles/${id}.json?ref=${BRANCH}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { content: string };
    return JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) as StoredProfile;
  }
  return null;
}

export async function writeStored(rec: StoredProfile): Promise<void> {
  const body = JSON.stringify(rec, null, 1);
  if (process.env.GITHUB_TOKEN) {
    const path = `public/profiles/${rec.id}.json`;
    const cur = await github(`${path}?ref=${BRANCH}`);
    const sha = cur.ok ? ((await cur.json()) as { sha: string }).sha : undefined;
    const res = await github(path, {
      method: "PUT",
      body: JSON.stringify({ message: `Profile: ${rec.id} edited by the operator`, content: Buffer.from(body).toString("base64"), branch: BRANCH, sha }),
    });
    if (!res.ok) throw new Error("GitHub write failed " + res.status + " " + (await res.text()).slice(0, 200));
    return;
  }
  mkdirSync(localDir, { recursive: true });
  writeFileSync(join(localDir, rec.id + ".json"), body);
}

export const profiles = new Hono();
profiles.use("*", cors({ origin: "*", allowHeaders: ["content-type", "x-claim-token"], allowMethods: ["GET", "PUT", "POST", "OPTIONS"] }));

profiles.get("/profiles/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const rec = await readStored(id);
  if (!rec) return c.json({ error: "not found" }, 404);
  // Guests only get the overlay; the owner (with the token) gets everything.
  if (authorized(id, c.req.header("x-claim-token"))) return c.json(rec);
  return c.json({ id: rec.id, published: rec.published, patch: rec.patch, updatedAt: rec.updatedAt });
});

profiles.post("/claims/:id", async (c) => {
  const id = c.req.param("id");
  if (!authorized(id, c.req.header("x-claim-token"))) return c.json({ error: "invalid claim link" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { owner?: StoredProfile["owner"] };
  const cur = await readStored(id);
  const now = new Date().toISOString();
  const rec: StoredProfile = cur || { id, claimedAt: now, updatedAt: now, owner: { name: "", email: "", phone: "" }, published: true, profile: null, patch: {} };
  if (body.owner) rec.owner = { name: String(body.owner.name || "").slice(0, 120), email: String(body.owner.email || "").slice(0, 200), phone: String(body.owner.phone || "").slice(0, 40) };
  rec.updatedAt = now;
  await writeStored(rec);
  return c.json(rec);
});

profiles.put("/profiles/:id", async (c) => {
  const id = c.req.param("id");
  if (!authorized(id, c.req.header("x-claim-token"))) return c.json({ error: "invalid claim link" }, 403);
  const text = await c.req.text();
  if (text.length > 400_000) return c.json({ error: "too large" }, 413);
  const body = JSON.parse(text) as { profile?: unknown; patch?: Record<string, unknown>; published?: boolean; owner?: StoredProfile["owner"] };
  const cur = await readStored(id);
  const now = new Date().toISOString();
  const rec: StoredProfile = cur || { id, claimedAt: now, updatedAt: now, owner: { name: "", email: "", phone: "" }, published: true, profile: null, patch: {} };
  if (body.profile !== undefined) rec.profile = body.profile;
  if (body.patch) rec.patch = body.patch;
  if (typeof body.published === "boolean") rec.published = body.published;
  if (body.owner) rec.owner = body.owner;
  rec.updatedAt = now;
  await writeStored(rec);
  return c.json({ ok: true, updatedAt: now });
});

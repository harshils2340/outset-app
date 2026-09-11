import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { ID, mayEdit, rateLimit } from "./auth.ts";

/**
 * Operator photo uploads. The browser resizes to 1600px and sends JPEG bytes as base64; the file is committed
 * to public/uploads/<listing>/<sha>.jpg through the GitHub contents API (or written locally), so it is served
 * by the site itself with no image host to run. Content-addressed: uploading the same photo twice is a no-op.
 */

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../../../public");
const REPO = process.env.GITHUB_REPO || "harshils2340/outset-app";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const SITE = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/");
const MAX_BYTES = 1_800_000;

async function github(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch("https://api.github.com/repos/" + REPO + "/contents/" + path, {
    ...init,
    signal: AbortSignal.timeout(20000),
    headers: { authorization: "Bearer " + process.env.GITHUB_TOKEN, accept: "application/vnd.github+json", "user-agent": "outset-api", ...(init.headers || {}) },
  });
}

async function storeBinary(relPath: string, bytes: Buffer, message: string): Promise<void> {
  if (process.env.GITHUB_TOKEN) {
    const path = `public/${relPath}`;
    const cur = await github(`${path}?ref=${BRANCH}`);
    if (cur.ok) return; // same content hash already committed
    const res = await github(path, { method: "PUT", body: JSON.stringify({ message, content: bytes.toString("base64"), branch: BRANCH }) });
    if (!res.ok) throw new Error("GitHub write failed " + res.status + " " + (await res.text()).slice(0, 200));
    return;
  }
  const local = join(publicDir, relPath);
  if (existsSync(local)) return;
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, bytes);
}

export const uploads = new Hono();

uploads.post("/uploads/:id", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id) || !mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  const body = (await c.req.json().catch(() => null)) as { data?: string; type?: string } | null;
  if (!body?.data || typeof body.data !== "string") return c.json({ error: "no image" }, 400);
  const b64 = body.data.replace(/^data:image\/\w+;base64,/, "");
  if (b64.length > MAX_BYTES * 1.4) return c.json({ error: "image too large; keep it under 1.8 MB" }, 413);
  const bytes = Buffer.from(b64, "base64");
  // Only real JPEG or PNG bytes get stored, whatever the client claimed.
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!jpeg && !png) return c.json({ error: "only JPEG or PNG" }, 415);
  if (bytes.length > MAX_BYTES) return c.json({ error: "image too large; keep it under 1.8 MB" }, 413);
  const sha = createHash("sha256").update(bytes).digest("hex").slice(0, 20);
  const rel = `uploads/${id}/${sha}.${jpeg ? "jpg" : "png"}`;
  try {
    await storeBinary(rel, bytes, `Photo upload for ${id}`);
  } catch (e) {
    return c.json({ error: (e as Error).message.slice(0, 160) }, 502);
  }
  return c.json({ ok: true, url: SITE + rel });
});

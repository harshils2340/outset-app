import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { ID, mayEdit, rateLimit } from "./auth.ts";
import { dimensionsTooLarge, stripImageMetadata } from "./imageSanitize.ts";

/**
 * Operator photo uploads. The browser resizes to 1600px and sends JPEG bytes as base64; the file is committed
 * to public/uploads/<listing>/<sha>.jpg through the GitHub contents API (or written locally), so it is served
 * by the site itself with no image host to run. Content-addressed: uploading the same photo twice is a no-op.
 *
 * The site only has the file after Render rebuilds, which is minutes away, so the operator who just uploaded a
 * photo saw a broken image and reasonably concluded it had failed. GET /uploads/:id/:file serves the same bytes
 * straight from the store in the meantime; the guest site keeps the canonical URL and serves it from the CDN
 * once the deploy lands. The name is a hash of the bytes, so the answer can be cached for ever.
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

const FILE = /^[a-f0-9]{20}\.(jpg|png)$/;

/** Read the bytes back, from the repository when there is a token, from disk otherwise. */
async function readBinary(relPath: string): Promise<Buffer | null> {
  if (process.env.GITHUB_TOKEN) {
    const res = await github(`public/${relPath}?ref=${BRANCH}`).catch(() => null);
    if (!res || !res.ok) return null;
    const j = (await res.json().catch(() => null)) as { content?: string } | null;
    return j?.content ? Buffer.from(j.content, "base64") : null;
  }
  const local = join(publicDir, relPath);
  return existsSync(local) ? readFileSync(local) : null;
}

/**
 * The photo, for the minutes between the upload and the deploy that puts it on the site. Public on purpose: it
 * is the same image the listing shows, and the name is a hash of the bytes, so it cannot be guessed or walked.
 */
uploads.get("/uploads/:id/:file", rateLimit(600, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  const file = String(c.req.param("file") ?? "");
  if (!ID.test(id) || !FILE.test(file)) return c.json({ error: "not found" }, 404);
  const bytes = await readBinary(`uploads/${id}/${file}`).catch(() => null);
  if (!bytes) return c.json({ error: "not found" }, 404);
  return c.body(bytes, 200, {
    "content-type": file.endsWith(".png") ? "image/png" : "image/jpeg",
    "cache-control": "public, max-age=31536000, immutable",
  });
});

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
  // A pixel size big enough to be a decompression-style hog is not ruled out by a magic byte or a file-size
  // cap; the browser already resizes to 1600px before sending, so anything this much bigger is not real.
  if (dimensionsTooLarge(bytes)) return c.json({ error: "that image's dimensions look wrong; try re-saving and uploading again" }, 415);
  // Strip EXIF/XMP (JPEG) or text/time metadata (PNG) before it rides into a public, permanent commit: a
  // phone photo's own EXIF carries GPS coordinates the uploader never chose to publish.
  const clean = stripImageMetadata(bytes, jpeg ? "jpeg" : "png");
  const sha = createHash("sha256").update(clean).digest("hex").slice(0, 20);
  const rel = `uploads/${id}/${sha}.${jpeg ? "jpg" : "png"}`;
  try {
    await storeBinary(rel, clean, `Photo upload for ${id}`);
  } catch (e) {
    // Every screen prints the API's own `error` straight onto the operator's toast, so this has to be written
    // for them. "GitHub write failed 401 {"message":"Bad credentials"...}" is for us, and it goes to the log.
    console.error("upload store failed for " + id + ": " + (e as Error).message.slice(0, 300));
    return c.json({ error: "We couldn't save that photo. Try again in a minute." }, 502);
  }
  return c.json({ ok: true, url: SITE + rel });
});

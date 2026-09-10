import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * JSON documents under public/ are the production store for operator profiles and bookings: one file per
 * listing, committed to the GitHub repo through the contents API when GITHUB_TOKEN is set (the site rebuilds
 * and guests see the change), or written to the local checkout on the laptop. No database to host.
 */

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../../../public");
const REPO = process.env.GITHUB_REPO || "harshils2340/outset-app";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const SAFE = /^[a-z0-9/_.-]{1,160}$/;

async function github(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch("https://api.github.com/repos/" + REPO + "/contents/" + path, {
    ...init,
    signal: AbortSignal.timeout(15000),
    headers: { authorization: "Bearer " + process.env.GITHUB_TOKEN, accept: "application/vnd.github+json", "user-agent": "outset-api", ...(init.headers || {}) },
  });
}

// Writes to one path must not interleave: the GitHub API needs the current sha.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(key, run.catch(() => undefined));
  return run;
}

/** relPath is relative to public/, e.g. "profiles/o-acme-com.json". */
export async function readJson<T>(relPath: string): Promise<T | null> {
  if (!SAFE.test(relPath)) throw new Error("bad path");
  const local = join(publicDir, relPath);
  if (existsSync(local)) return JSON.parse(readFileSync(local, "utf8")) as T;
  if (process.env.GITHUB_TOKEN) {
    const res = await github(`public/${relPath}?ref=${BRANCH}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { content: string };
    return JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) as T;
  }
  return null;
}

export async function writeJson(relPath: string, value: unknown, message: string): Promise<void> {
  if (!SAFE.test(relPath)) throw new Error("bad path");
  const body = JSON.stringify(value, null, 1);
  await withLock(relPath, async () => {
    if (process.env.GITHUB_TOKEN) {
      const path = `public/${relPath}`;
      const cur = await github(`${path}?ref=${BRANCH}`);
      const sha = cur.ok ? ((await cur.json()) as { sha: string }).sha : undefined;
      const res = await github(path, { method: "PUT", body: JSON.stringify({ message, content: Buffer.from(body).toString("base64"), branch: BRANCH, sha }) });
      if (!res.ok) throw new Error("GitHub write failed " + res.status + " " + (await res.text()).slice(0, 200));
      return;
    }
    const local = join(publicDir, relPath);
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, body);
  });
}

/** Read, transform, write, under the path lock. */
export async function updateJson<T>(relPath: string, initial: T, fn: (cur: T) => T, message: string): Promise<T> {
  const cur = (await readJson<T>(relPath)) ?? initial;
  const next = fn(cur);
  await writeJson(relPath, next, message);
  return next;
}

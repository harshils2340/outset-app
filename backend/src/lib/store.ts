import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Files under public/ that the API reads or publishes: the catalog detail files (o/<id>.json, read-only here) and
 * the scrubbed guest copy of each claimed profile (profiles/<id>.json), committed to the site repository through
 * the contents API when GITHUB_TOKEN is set so the site rebuilds and guests see the change. Profiles, bookings,
 * payouts and the mail list themselves live in Postgres (src/lib/repo.ts); nothing private is written here.
 */

const here = dirname(fileURLToPath(import.meta.url));
// STORE_DIR points the local store somewhere else, so a test can run the whole booking and payout flow without
// touching the checkout.
const publicDir = process.env.STORE_DIR || join(here, "../../../public");
const REPO = process.env.GITHUB_REPO || "harshils2340/outset-app";
const BRANCH = process.env.GITHUB_BRANCH || "main";

/**
 * The site repository is public and everything under public/ ships to onoutset.com, so guest names, phone
 * numbers, owner emails, Stripe account ids and payout records must not be written there. With DATA_REPO set
 * (a private repository the same token can write), those documents go to it instead; the guest site gets only
 * a scrubbed copy of each profile through writePublicJson.
 */
const DATA_REPO = (process.env.DATA_REPO || "").trim();
const DATA_BRANCH = process.env.DATA_BRANCH || "main";
const PRIVATE = /^(?:bookings|payouts|profiles)\//;
export const privateStoreConfigured = () => !!DATA_REPO;
const target = (relPath: string, forcePublic = false) =>
  !forcePublic && DATA_REPO && PRIVATE.test(relPath) ? { repo: DATA_REPO, branch: DATA_BRANCH, prefix: "" } : { repo: REPO, branch: BRANCH, prefix: "public/" };
const SAFE = /^[a-z0-9/_.-]{1,160}$/;

async function github(path: string, init: RequestInit = {}, repo = REPO): Promise<Response> {
  return fetch("https://api.github.com/repos/" + repo + "/contents/" + path, {
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

/**
 * relPath is relative to public/, e.g. "profiles/o-acme-com.json".
 *
 * Whichever store writes is the one that reads. With a token, writes go to the repository, so the repository
 * is the truth and the checkout on disk is only a deploy-time snapshot; reading that snapshot instead would
 * quietly lose data, because every write here is read-modify-write. A second booking read from a stale
 * `bookings/<id>.json` rebuilds the array as it was when the container started and overwrites the first.
 * The local copy is still the fallback for a path the repository does not have yet, and the only store at
 * all when there is no token.
 */
export async function readJson<T>(relPath: string): Promise<T | null> {
  if (!SAFE.test(relPath)) throw new Error("bad path");
  const local = join(publicDir, relPath);
  const onDisk = (): T | null => (existsSync(local) ? (JSON.parse(readFileSync(local, "utf8")) as T) : null);
  if (!process.env.GITHUB_TOKEN) return onDisk();
  const t = target(relPath);
  const res = await github(`${t.prefix}${relPath}?ref=${t.branch}`, {}, t.repo);
  if (res.status === 404) return onDisk();
  if (!res.ok) throw new Error("GitHub read failed " + res.status + " for " + relPath);
  const j = (await res.json()) as { content: string };
  return JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) as T;
}

/** A document the guest site is meant to read, always in the site repository. */
export async function writePublicJson(relPath: string, value: unknown, message: string): Promise<void> {
  return writeJson(relPath, value, message, true);
}

export async function writeJson(relPath: string, value: unknown, message: string, forcePublic = false): Promise<void> {
  if (!SAFE.test(relPath)) throw new Error("bad path");
  const t = target(relPath, forcePublic);
  await withLock(t.repo + ":" + relPath, () => writeUnlocked(relPath, value, message, forcePublic));
}

async function writeUnlocked(relPath: string, value: unknown, message: string, forcePublic = false): Promise<void> {
  const body = JSON.stringify(value, null, 1);
  const t = target(relPath, forcePublic);
  if (process.env.GITHUB_TOKEN) {
    const path = `${t.prefix}${relPath}`;
    const cur = await github(`${path}?ref=${t.branch}`, {}, t.repo);
    const sha = cur.ok ? ((await cur.json()) as { sha: string }).sha : undefined;
    const res = await github(path, { method: "PUT", body: JSON.stringify({ message, content: Buffer.from(body).toString("base64"), branch: t.branch, sha }) }, t.repo);
    if (!res.ok) throw new Error("GitHub write failed " + res.status + " " + (await res.text()).slice(0, 200));
    return;
  }
  const local = join(publicDir, relPath);
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, body);
}

/** Remove a document. Returns true when a file was there to remove. Same lock as writeJson. */
export async function deleteJson(relPath: string, message: string): Promise<boolean> {
  if (!SAFE.test(relPath)) throw new Error("bad path");
  const t = target(relPath);
  return withLock(t.repo + ":" + relPath, async () => {
    let removed = false;
    const local = join(publicDir, relPath);
    if (existsSync(local)) {
      rmSync(local);
      removed = true;
    }
    if (process.env.GITHUB_TOKEN) {
      const path = `${t.prefix}${relPath}`;
      const cur = await github(`${path}?ref=${t.branch}`, {}, t.repo);
      if (cur.ok) {
        const sha = ((await cur.json()) as { sha: string }).sha;
        const res = await github(path, { method: "DELETE", body: JSON.stringify({ message, branch: t.branch, sha }) }, t.repo);
        if (!res.ok) throw new Error("GitHub delete failed " + res.status + " " + (await res.text()).slice(0, 200));
        removed = true;
      }
    }
    return removed;
  });
}

/** Read, transform, write, under the path lock. */
export async function updateJson<T>(relPath: string, initial: T, fn: (cur: T) => T, message: string): Promise<T> {
  if (!SAFE.test(relPath)) throw new Error("bad path");
  const t = target(relPath);
  // The read belongs inside the lock too: two bookings read the same list, and the second write dropped the first.
  return withLock(t.repo + ":" + relPath, async () => {
    const cur = (await readJson<T>(relPath)) ?? initial;
    const next = fn(cur);
    await writeUnlocked(relPath, next, message);
    return next;
  });
}

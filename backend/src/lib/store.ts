import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read-only access to the generated catalog files under public/ (o/<id>.json and the like). They come from the
 * checkout on disk, or from the site repository through the contents API when GITHUB_TOKEN is set and the
 * checkout does not have the file yet. Nothing the API does writes to a repository: profiles, bookings, payouts
 * and the mail list live in Postgres (src/lib/repo.ts), and the nightly pipeline is the only thing that commits.
 */

const here = dirname(fileURLToPath(import.meta.url));
// STORE_DIR points at another folder of catalog files, so a test can run against a throwaway listing.
const publicDir = process.env.STORE_DIR || join(here, "../../../public");
const REPO = process.env.GITHUB_REPO || "harshils2340/outset-app";
const BRANCH = process.env.GITHUB_BRANCH || "main";
// Every caller already passes a fixed prefix plus an `ID`-validated catalog id (auth.ts: `/^[a-z0-9-]{3,80}$/`,
// no dot or slash), so this never sees attacker input today. Kept strict anyway, and ".." refused explicitly,
// since a relative path here reaches both the local checkout (fs.join) and, as a repo path, the GitHub API.
const SAFE = /^[a-z0-9/_.-]{1,160}$/;
function isSafeRelPath(p: string): boolean {
  return SAFE.test(p) && !p.split("/").includes("..");
}

async function github(path: string): Promise<Response> {
  return fetch("https://api.github.com/repos/" + REPO + "/contents/" + path, {
    signal: AbortSignal.timeout(15000),
    headers: { authorization: "Bearer " + process.env.GITHUB_TOKEN, accept: "application/vnd.github+json", "user-agent": "outset-api" },
  });
}

/**
 * Where a generated file sits on this host, or null when the checkout does not have it. For the one file too
 * big to parse into memory on a free instance (catalog.json is 23 MB), which is read as a stream instead.
 * Same path rules as readJson, so the two cannot disagree about what "public/" means.
 */
export function localPath(relPath: string): string | null {
  if (!isSafeRelPath(relPath)) throw new Error("bad path");
  const local = join(publicDir, relPath);
  return existsSync(local) ? local : null;
}

/** relPath is relative to public/, e.g. "o/o-acme-com.json". The checkout wins; the repository fills a gap. */
export async function readJson<T>(relPath: string): Promise<T | null> {
  if (!isSafeRelPath(relPath)) throw new Error("bad path");
  const local = join(publicDir, relPath);
  if (existsSync(local)) return JSON.parse(readFileSync(local, "utf8")) as T;
  if (!process.env.GITHUB_TOKEN) return null;
  const res = await github(`public/${relPath}?ref=${BRANCH}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("GitHub read failed " + res.status + " for " + relPath);
  const j = (await res.json()) as { content: string };
  return JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) as T;
}

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
const SAFE = /^[a-z0-9/_.-]{1,160}$/;

async function github(path: string): Promise<Response> {
  return fetch("https://api.github.com/repos/" + REPO + "/contents/" + path, {
    signal: AbortSignal.timeout(15000),
    headers: { authorization: "Bearer " + process.env.GITHUB_TOKEN, accept: "application/vnd.github+json", "user-agent": "outset-api" },
  });
}

/** relPath is relative to public/, e.g. "o/o-acme-com.json". The checkout wins; the repository fills a gap. */
export async function readJson<T>(relPath: string): Promise<T | null> {
  if (!SAFE.test(relPath)) throw new Error("bad path");
  const local = join(publicDir, relPath);
  if (existsSync(local)) return JSON.parse(readFileSync(local, "utf8")) as T;
  if (!process.env.GITHUB_TOKEN) return null;
  const res = await github(`public/${relPath}?ref=${BRANCH}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("GitHub read failed " + res.status + " for " + relPath);
  const j = (await res.json()) as { content: string };
  return JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) as T;
}

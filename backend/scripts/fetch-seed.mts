import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The catalog `outset-api` boots with, on a service that has no disk.
 *
 * `outset-api` runs with no persistent disk (`render.yaml` never gave it one), so `data/outset.db` starts
 * empty on every deploy: `migrate()` creates the schema and nothing else. The concierge and every browse route
 * then run real, correct queries against zero rows — "escape room near New York" answered "could not find
 * escape room near New York" not because the reader or the matching logic was wrong, but because there was
 * nothing in the table to match. `readIntent` still recognised "New York" (it is in the hard-coded `METROS`
 * list), which is what made this look like a data gap in one town rather than an empty catalog everywhere.
 *
 * `scripts/seed-db.mts` already publishes a compact snapshot to the private `outset-data` repo for exactly
 * this: a cloud service's first boot. Nothing before this script actually downloaded it, so the release existed
 * and nothing consumed it. This does, once, in the build step, so every deploy gets a populated catalog without
 * needing a disk at all: the database lives in the build's own filesystem for that instance's lifetime, which
 * is disposable and fine for a demo, and no different in kind from any other build artifact.
 *
 * Skips the download entirely when a database already sits at the target path (a local dev machine, or a
 * future service that does have a disk and has already been seeded), so this is safe to run in every
 * environment's build step rather than only production's.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dest = process.env.OUTSET_DB_PATH || process.env.OUTSET_DB || join(here, "../data/outset.db");
const ASSET_URL = "https://api.github.com/repos/harshils2340/outset-data/releases/assets/556385446";

async function main() {
  if (existsSync(dest)) {
    console.log(`[fetch-seed] ${dest} already exists; leaving it alone.`);
    return;
  }
  const token = (process.env.GITHUB_TOKEN || "").trim();
  if (!token) {
    console.warn("[fetch-seed] GITHUB_TOKEN is not set, so the private seed cannot be fetched. Booting with an empty catalog.");
    return;
  }
  console.log("[fetch-seed] downloading the catalog seed (356MB, private release)...");
  const res = await fetch(ASSET_URL, {
    headers: { authorization: `token ${token}`, accept: "application/octet-stream", "user-agent": "outset-fetch-seed" },
  });
  if (!res.ok || !res.body) {
    console.warn(`[fetch-seed] download failed (${res.status}); booting with an empty catalog rather than failing the build.`);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  await import("node:fs/promises").then((fs) => fs.writeFile(dest, buf));
  console.log(`[fetch-seed] wrote ${(buf.length / 1e6).toFixed(0)}MB to ${dest}`);
}

main().catch((e) => {
  // A failed seed must not fail the build: an empty catalog is a worse demo than a broken deploy.
  console.warn("[fetch-seed] " + (e as Error).message + " — booting with an empty catalog.");
});

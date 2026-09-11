import { existsSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/**
 * Make a clean, compact copy of the local database for the cloud worker's first boot, and print the commands
 * that publish it as a release asset on the private data repo (releases take files up to 2 GB). Nothing is uploaded here.
 *   npx tsx scripts/seed-db.mts [/path/to/outset.db]
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || process.env.OUTSET_DB_PATH || join(here, "../data/outset.db");
const out = "/tmp/outset-seed.db";
// The seed carries operator emails, so it goes to the PRIVATE data repo, never to the public app repo.
const repo = process.env.SEED_REPO || "harshils2340/outset-data";
if (!existsSync(src)) {
  console.error("no database at " + src);
  process.exit(1);
}
rmSync(out, { force: true });
const db = new DatabaseSync(src, { readOnly: true });
db.exec("PRAGMA busy_timeout = 120000");
db.exec(`VACUUM INTO '${out}'`);
db.close();
const mb = statSync(out).size / 1e6;
console.log(`Wrote ${out} (${mb.toFixed(0)} MB) from ${src}`);
console.log("\nPublish it once as a release asset (needs `gh auth login`), then set DB_SEED_URL on the outset-pipeline worker:\n");
console.log(`  gh release create db-seed --repo ${repo} --title "Database seed" --notes "SQLite seed for the cloud pipeline" || true`);
console.log(`  gh release upload db-seed ${out} --repo ${repo} --clobber`);
console.log(`  gh api repos/${repo}/releases/tags/db-seed -q '.assets[0].id'`);
console.log(`\n  DB_SEED_URL=https://api.github.com/repos/${repo}/releases/assets/<that id>`);
console.log("  (private repo, so the worker fetches it with GITHUB_TOKEN; that token needs Contents: read on " + repo + " as well)");
console.log("\nThe worker downloads it only when /var/data/outset.db is missing. After that the cloud copy is canonical; delete the release asset when you like.");

import "../src/env.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closePg, migratePg, query } from "../src/db/pg.ts";
import { insertBooking, linkEmailHash, putBooking, putProfile, updateDoc } from "../src/lib/repo.ts";

/**
 * Moves the JSON store into Postgres: profiles, the email-to-listing index, bookings and the mail suppression list.
 * Reads the site repository through the GitHub API when GITHUB_TOKEN is set (that is where the API wrote until
 * the cutover), else the checkout on disk.
 *
 *   npx tsx scripts/migrate-json-to-pg.mts --dry          count what would move, write nothing
 *   npx tsx scripts/migrate-json-to-pg.mts                full copy: rows are written or replaced
 *   npx tsx scripts/migrate-json-to-pg.mts --insert-only  second pass after the cutover: add what is missing, replace nothing
 */

const DRY = process.argv.includes("--dry");
const INSERT_ONLY = process.argv.includes("--insert-only");
const REPO = process.env.GITHUB_REPO || "harshils2340/outset-app";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../../public");

type Profile = { id: string; claimedAt: string; updatedAt: string; owner: { name: string; email: string; phone: string }; published: boolean; [k: string]: unknown };
type Booking = { code: string; listing: string; status: string; date: string; created: string; [k: string]: unknown };

const gh = async (path: string): Promise<Response> =>
  fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, {
    headers: { authorization: "Bearer " + process.env.GITHUB_TOKEN, accept: "application/vnd.github+json", "user-agent": "outset-migration" },
    signal: AbortSignal.timeout(20000),
  });

/** File names in a folder of the store, from the repository or the disk. */
async function list(dir: string): Promise<string[]> {
  if (process.env.GITHUB_TOKEN) {
    const r = await gh(`public/${dir}`);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`GitHub list failed ${r.status} for ${dir}`);
    return ((await r.json()) as { name: string; type: string }[]).filter((f) => f.type === "file" && f.name.endsWith(".json")).map((f) => f.name);
  }
  const d = join(publicDir, dir);
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")) : [];
}

async function read<T>(rel: string): Promise<T | null> {
  if (process.env.GITHUB_TOKEN) {
    const r = await gh(`public/${rel}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub read failed ${r.status} for ${rel}`);
    const j = (await r.json()) as { content: string };
    return JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) as T;
  }
  const f = join(publicDir, rel);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : null;
}

const source = process.env.GITHUB_TOKEN ? `github:${REPO}@${BRANCH}` : publicDir;
console.log(`${DRY ? "DRY RUN" : INSERT_ONLY ? "INSERT-ONLY" : "FULL COPY"} from ${source}`);

const out = { profiles: 0, profilesSkipped: 0, emails: 0, bookings: 0, bookingsSkipped: 0, unsub: 0, files: 0, badFiles: [] as string[] };

if (!DRY) await migratePg();
const exists = async (table: string, col: string, v: string) => (await query(`select 1 from ${table} where ${col} = $1`, [v])).length > 0;

// profiles/<id>.json, all but the email index
for (const f of await list("profiles")) {
  if (f === "index.json") continue;
  out.files++;
  const p = await read<Profile>(`profiles/${f}`);
  if (!p || typeof p.id !== "string") { out.badFiles.push("profiles/" + f); continue; }
  if (INSERT_ONLY && (await exists("profiles", "id", p.id))) { out.profilesSkipped++; continue; }
  if (!DRY) await putProfile(p);
  out.profiles++;
}

// profiles/index.json: { [emailHash]: listingIds[] }
const idx = (await read<Record<string, string[]>>("profiles/index.json")) || {};
for (const [hash, ids] of Object.entries(idx)) {
  for (const id of ids || []) {
    if (!DRY) await linkEmailHash(hash, id);
    out.emails++;
  }
}

// bookings/<listing>.json: StoredBooking[]
for (const f of await list("bookings")) {
  out.files++;
  const arr = await read<Booking[]>(`bookings/${f}`);
  if (!Array.isArray(arr)) { out.badFiles.push("bookings/" + f); continue; }
  for (const b of arr) {
    if (!b || typeof b.code !== "string" || typeof b.listing !== "string") { out.badFiles.push(`bookings/${f}#${String((b as { code?: string })?.code)}`); continue; }
    if (DRY) { out.bookings++; continue; }
    if (INSERT_ONLY) {
      if (await insertBooking(b)) out.bookings++;
      else out.bookingsSkipped++;
    } else {
      await putBooking(b);
      out.bookings++;
    }
  }
}

// mail/unsub.json: { hashes: { hash: at }, reasons?: { hash: reason } }
const unsub = await read<{ hashes?: Record<string, string>; reasons?: Record<string, string> }>("mail/unsub.json");
if (unsub?.hashes) {
  out.unsub = Object.keys(unsub.hashes).length;
  if (!DRY) await updateDoc("mail/unsub.json", { hashes: {} as Record<string, string> }, (cur: { hashes: Record<string, string>; reasons?: Record<string, string> }) => ({ hashes: { ...(unsub.hashes || {}), ...(cur.hashes || {}) }, reasons: { ...(unsub.reasons || {}), ...(cur.reasons || {}) } }));
}

console.log(JSON.stringify(out, null, 1));
if (!DRY) {
  const counts = await query<{ t: string; n: string }>("select 'profiles' as t, count(*)::text as n from profiles union all select 'profile_emails', count(*)::text from profile_emails union all select 'bookings', count(*)::text from bookings union all select 'documents', count(*)::text from documents");
  console.log("now in Postgres:", counts.map((r) => `${r.t}=${r.n}`).join(", "));
}
await closePg();
if (out.badFiles.length) process.exitCode = 2;

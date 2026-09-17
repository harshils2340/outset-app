/**
 * The whole operator and money path, end to end, on this machine only.
 *
 * It exists because the live system cannot be used for a rehearsal: the production API runs Stripe in LIVE mode
 * (a card test charges a real card), bookings and owner details live in the production database, and notification
 * mail goes to real inboxes. So this builds a throwaway copy
 * of everything and runs the real code against it:
 *
 *   - a temp database with the production schema and the fake listing from scripts/test-listing.mts in it
 *     (--full-db copies the real catalog instead, which is faithful but boots slowly)
 *   - the real API (src/index.ts serve) on http://localhost:8787 against a scratch Neon branch (E2E_DATABASE_URL,
 *     wiped of this listing first), with a temp STORE_DIR for the catalog files, no GitHub token, no data
 *     repository and no mail key, so every email is printed to the log instead of sent
 *   - the real site, built with VITE_API_URL pointing at that API and served from a temp dist on :5199
 *   - a headless browser that claims the listing, edits it, books it, accepts and declines
 *   - the payout path, through scripts/payout-e2e.mts's Stripe recorder, or through Stripe TEST mode when
 *     STRIPE_TEST_SECRET_KEY (sk_test_...) is set
 *   - the routes themselves, through scripts/store-e2e.mts, which drives them in process and reads the rows back
 *
 * Nothing is written to the repository: not public/, not dist/, not backend/data/outset.db. The only outbound
 * requests are the listing's own Unsplash photos, which the browser loads, and Stripe test mode when a test key
 * is given.
 *
 *   npx tsx scripts/e2e-local.mts            run everything and clean up
 *   npx tsx scripts/e2e-local.mts --keep     leave the API and the site running so you can click through
 *   npx tsx scripts/e2e-local.mts --full-db  copy the whole catalog database instead of starting empty
 *   npx tsx scripts/e2e-local.mts --no-browser  skip the headless-browser steps (6, the hosted Checkout, the
 *                                               mail render); the API, things-to-know, payout and route checks
 *                                               still run
 *
 * Step 6b, things to know: the operator's cancellation policy, requirements, what's included and FAQ go through
 * the same PUT /profiles/:id the dashboard uses and are read back the way a guest's browser and the nightly
 * sync read them, so a cleared cancellation line stays cleared instead of falling back to the scraped one.
 *
 * See docs/E2E-LOCAL.md.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(here, "..");
const ROOT = join(BACKEND, "..");
const KEEP = process.argv.includes("--keep");
/** No headless browser at all: the API-driven steps still run, the browser ones are recorded as skipped. */
const NO_BROWSER = process.argv.includes("--no-browser") || process.env.E2E_NO_BROWSER === "1";

const API_PORT = 8787;
const SITE_PORT = 5199;
const API_URL = `http://localhost:${API_PORT}`;
const SITE_URL = `http://localhost:${SITE_PORT}`;
/** The id scripts/test-listing.mts prints; read from its output so a rename there needs no change here. */
let LISTING_ID = "";
const OWNER_EMAIL = "harshils2340@gmail.com";
const CLAIM_SECRET = "e2e-local-claim-secret";
const ADMIN_KEY = "e2e-local-admin-key";
const WEBHOOK_SECRET = "whsec_e2e_local";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// The screenshot driver. The scratchpad copy is preferred; without it the flow file drives itself.
const DRIVER = process.env.SHOT_DRIVER || "/private/tmp/claude-501/-Users-harsh-Documents-outset-app/9090a951-0e5c-4bbe-bd30-6a14f52ae882/scratchpad/shot.mjs";

/* ---------------------------------------------------------------- results ---------------------------------- */

type Result = { step: string; ok: boolean | "warn"; note: string };
const results: Result[] = [];
function record(step: string, ok: boolean | "warn", note = ""): void {
  results.push({ step, ok, note });
  const mark = ok === "warn" ? "  WARN  " : ok ? "  pass  " : "  FAIL  ";
  console.log(mark + step + (note ? "  -> " + note.slice(0, 300) : ""));
}

/* ---------------------------------------------------------------- 1. refuse to touch production ------------- */

const testKey = (process.env.STRIPE_TEST_SECRET_KEY || "").trim();
/** The store is Postgres, so the rehearsal needs its own branch of it. Production is never used here. */
const E2E_DB = (process.env.E2E_DATABASE_URL || "").trim();
if (!E2E_DB) {
  console.log("E2E_DATABASE_URL is not set. The API keeps bookings in Postgres, so the rehearsal needs a scratch Neon branch (neon branches create --name scratch; neon connection-string scratch --pooled). Skipping.");
  process.exit(0);
}
{
  const problems: string[] = [];
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_TEST_SECRET_KEY"]) {
    const v = (process.env[name] || "").trim();
    if (v.startsWith("sk_live")) problems.push(`${name} in this shell is a LIVE Stripe key. A live key here would charge a real card. Unset it, or use a key from Stripe's Test mode.`);
  }
  if (testKey && !testKey.startsWith("sk_test")) problems.push("STRIPE_TEST_SECRET_KEY must start with sk_test_. Get it from the Stripe Dashboard with Test mode switched on.");
  if (problems.length) {
    console.error("\nRefusing to start:\n" + problems.map((p) => "  - " + p).join("\n") + "\n");
    process.exit(2);
  }
  console.log("Local end-to-end test. Nothing here reaches production.");
  console.log("  Stripe:    " + (testKey ? "TEST mode key given, real test Checkout will run" : "off (guests pay on site); payouts run through the recorder in payout-e2e.mts"));
  console.log("  GitHub:    no token, no DATA_REPO, so the store is a temp directory and nothing is committed");
  console.log("  Mail:      no RESEND_API_KEY and no SMTP, so every email is printed to the API log");
}

/* ---------------------------------------------------------------- temp world -------------------------------- */

const tmp = mkdtempSync(join(tmpdir(), "outset-e2e-"));
const store = join(tmp, "store");
const dist = join(tmp, "dist");
const shots = join(tmp, "shots");
const dbCopy = join(tmp, "outset.db");
const apiLogPath = join(tmp, "api.log");
const flowOut = join(tmp, "flow.json");
const mailDir = join(tmp, "mail");
for (const d of [store, dist, shots, mailDir]) mkdirSync(d, { recursive: true });
writeFileSync(apiLogPath, "");

const children: ChildProcess[] = [];
/**
 * The API and the site are started through npx, so the child here is a wrapper and the server itself is its
 * grandchild. Signalling only the wrapper left the real server holding :8787 and :5199, and the next run died
 * with EADDRINUSE. Both are started in their own process group (detached), so the whole group goes at once.
 */
function cleanup(): void {
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, "SIGTERM");
      else c.kill("SIGTERM");
    } catch {
      try {
        c.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  if (!KEEP) rmSync(tmp, { recursive: true, force: true });
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

/** Everything a backend child process is allowed to see. Empty strings beat backend/.env, which holds live keys. */
const childEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  OUTSET_DB: dbCopy,
  OUTSET_DB_PATH: dbCopy,
  STORE_DIR: store,
  DATABASE_URL: E2E_DB,
  E2E_DATABASE_URL: E2E_DB,
  CLAIM_SECRET,
  ADMIN_KEY,
  OUTSET_TEST_CLAIM_EMAILS: OWNER_EMAIL,
  BOOKING_ALERT_EMAIL: OWNER_EMAIL,
  MAIL_DUMP_DIR: mailDir,
  ALLOWED_ORIGINS: SITE_URL,
  SITE_URL: SITE_URL + "/",
  PORT: String(API_PORT),
  STRIPE_SECRET_KEY: testKey,
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_CURRENCY: "usd",
  // Never let the real ones through, whether they come from the shell or from backend/.env.
  GITHUB_TOKEN: "",
  DATA_REPO: "",
  RESEND_API_KEY: "",
  RESEND_WEBHOOK_SECRET: "",
  MAIL_SMTP_USER: "",
  MAIL_SMTP_PASS: "",
  MAIL_REPLY_TO: "",
  OPENAI_API_KEY: "",
  SEARCHAPI_KEYS: "",
  ...extra,
});

function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; quiet?: boolean } ): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: opts.cwd, env: opts.env || process.env });
    let out = "";
    c.stdout.on("data", (d) => {
      out += d;
      if (!opts.quiet) process.stdout.write("    " + String(d).replace(/\n(?!$)/g, "\n    "));
    });
    c.stderr.on("data", (d) => {
      out += d;
      if (!opts.quiet) process.stdout.write("    " + String(d).replace(/\n(?!$)/g, "\n    "));
    });
    c.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

function start(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; logTo?: string; tag: string }): ChildProcess {
  // Its own process group, so cleanup() can take the server down with its npx wrapper. See cleanup().
  const c = spawn(cmd, args, { cwd: opts.cwd, env: opts.env || process.env, detached: true });
  children.push(c);
  const write = (d: Buffer) => {
    if (opts.logTo) appendFileSync(opts.logTo, String(d));
  };
  c.stdout.on("data", write);
  c.stderr.on("data", write);
  c.on("close", (code) => {
    if (code && code !== 0 && !KEEP) appendFileSync(apiLogPath, `\n[${opts.tag}] exited with ${code}\n`);
  });
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url: string, ms = 60000): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    const ok = await fetch(url).then((r) => r.ok).catch(() => false);
    if (ok) return true;
    if (Date.now() > end) return false;
    await sleep(400);
  }
}

/* ---------------------------------------------------------------- 2. a copy of the database ----------------- */

console.log("\n1. Safety");
record("no live Stripe key, no GitHub token, no DATA_REPO and no mail key reach the API", true, testKey ? "Stripe test key will be used" : "payments off");

console.log("\n2. A throwaway copy of the catalog database");
{
  // The real file is 460 MB and `serve` re-scores every operator in it at boot (ingestAll -> refreshAllScores),
  // which takes over twelve minutes on the full catalog. A test that only ever opens one listing does not need
  // the other 140,000, so the default is an empty database with the real schema and the test listing in it, and
  // --full-db takes the faithful copy for anyone who wants the whole catalog and is willing to wait.
  const FULL = process.argv.includes("--full-db");
  const { DatabaseSync } = await import("node:sqlite");
  let how = "empty database with the production schema";
  if (FULL) {
    how = "VACUUM INTO";
    try {
      const src = new DatabaseSync(join(BACKEND, "data/outset.db"), { readOnly: true });
      src.exec("PRAGMA busy_timeout = 30000");
      src.exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);
      src.close();
    } catch (e) {
      how = "file copy (" + (e as Error).message.slice(0, 60) + ")";
      copyFileSync(join(BACKEND, "data/outset.db"), dbCopy);
    }
  } else {
    process.env.OUTSET_DB = dbCopy;
    process.env.OUTSET_DB_PATH = dbCopy;
    const { migrate } = await import("../src/db/client.ts");
    migrate();
    // operators.metro_id and category_id are foreign keys, so the taxonomy has to be there before any row is.
    const { seedTaxonomy } = await import("../src/ingest/load.ts");
    seedTaxonomy();
  }
  record("the API and every script run against a temp database, never backend/data/outset.db", existsSync(dbCopy), how + " -> " + dbCopy);

  const r = await run("npx", ["tsx", "scripts/test-listing.mts"], { cwd: BACKEND, env: childEnv(), quiet: true });
  LISTING_ID = (r.out.match(/Test listing ready:\s*(\S+)/) || [])[1] || "";
  record("created the fake listing in the copy", r.code === 0 && !!LISTING_ID, r.out.trim().split("\n")[0] || r.out.slice(-200));
  if (!LISTING_ID) process.exit(1);
}

/* ---------------------------------------------------------------- 3. the listing's own files ---------------- */

console.log("\n3. The listing's detail file, built by the real catalog code");
let detail: Record<string, unknown> = {};
{
  // The harness reads the copy, not the real database: these are set before anything imports db/client.ts.
  process.env.OUTSET_DB = dbCopy;
  process.env.OUTSET_DB_PATH = dbCopy;
  process.env.STORE_DIR = store;
  process.env.CLAIM_SECRET = CLAIM_SECRET;
  const { buildCatalogItems, contactFor } = await import("../src/sync/contacts.ts");
  const items = buildCatalogItems((r) => r.origin === "test");
  const item = items.find((i) => i.id === LISTING_ID);
  if (!item) {
    record("built the listing through toCatalogItem", false, "the test listing did not come out of buildCatalogItems");
    process.exit(1);
  }
  const c = contactFor(String(item.src));
  detail = { ...item, contact: c ? { domain: c.domain, phone: c.phone, street: c.street, city: c.city, region: c.region, postal: c.postal, hours: c.hours } : undefined };
  mkdirSync(join(store, "o"), { recursive: true });
  writeFileSync(join(store, "o", LISTING_ID + ".json"), JSON.stringify(detail));
  const opts = (detail.options as { price: number | null }[]) || [];
  const priced = opts.map((o) => o.price).filter((n): n is number => n != null && n > 0);
  const lite = {
    id: detail.id, title: detail.title, cat: detail.cat, art: detail.art, area: detail.area, metroId: detail.metroId, src: detail.src,
    rating: detail.rating, reviews: detail.reviews, lat: detail.lat, lon: detail.lon, cover: detail.cover,
    tags: ((detail.tags as string[]) || []).slice(0, 6), from: priced.length ? Math.min(...priced) : undefined, dur: detail.dur, fc: detail.fc,
    options: [], specs: [], includes: [], gap: "", lite: true, unlisted: true,
  };
  writeFileSync(join(tmp, "lite.json"), JSON.stringify(lite));
  const faqs = (detail.faq as { q: string }[]) || [];
  record(
    "the detail file and the lite record are built through toCatalogItem",
    !!detail.claimKey && opts.length > 0 && faqs.length > 0,
    `${opts.length} price rows, ${((detail.photos as string[]) || []).length} photos, ${faqs.length} FAQ, claimKey ${String(detail.claimKey).slice(0, 8)}…`,
  );
}

/* ---------------------------------------------------------------- 4. the site --------------------------------*/

console.log("\n4. The site, built against the local API");
{
  // vite build through its own API so public/ (331 MB, 59k files) is not copied into the temp dist; the few
  // root files the app actually asks for are copied by hand below. The repo's own dist/ is never touched.
  const script = `import { build } from "vite"; await build({ configFile: ${JSON.stringify(join(ROOT, "vite.config.ts"))}, root: ${JSON.stringify(ROOT)}, publicDir: false, logLevel: "warn", build: { outDir: ${JSON.stringify(dist)}, emptyOutDir: true } });`;
  const r = await run("node", ["--input-type=module", "-e", script], { cwd: ROOT, env: { ...process.env, VITE_API_URL: API_URL }, quiet: true });
  const built = existsSync(join(dist, "index.html"));
  // /operators is its own entry point on the deployed site (scripts/copy-operators.mjs does this in the real build).
  if (built) {
    mkdirSync(join(dist, "operators"), { recursive: true });
    copyFileSync(join(dist, "index.html"), join(dist, "operators", "index.html"));
  }
  for (const f of ["favicon.svg", "favicon-32.png", "apple-touch-icon.png", "robots.txt"]) {
    if (existsSync(join(ROOT, "public", f))) cpSync(join(ROOT, "public", f), join(dist, f));
  }
  // Only the test listing goes into the catalog: it is the only listing this test books, and a 23 MB catalog
  // would slow every page load down for nothing. Never written to public/.
  const lite = JSON.parse(readFileSync(join(tmp, "lite.json"), "utf8"));
  const catalog = { generatedAt: new Date().toISOString(), operators: [lite], contacts: {} };
  writeFileSync(join(dist, "catalog.json"), JSON.stringify(catalog));
  writeFileSync(join(dist, "catalog-lite.json"), JSON.stringify(catalog));
  mkdirSync(join(dist, "o"), { recursive: true });
  writeFileSync(join(dist, "o", LISTING_ID + ".json"), JSON.stringify(detail));
  record("built the site and injected the test listing into the temp dist", built && r.code === 0, built ? dist : "vite build failed: " + r.out.slice(-300));
}

/* ---------------------------------------------------------------- 5. the servers ---------------------------- */

console.log("\n5. The API and the site, both local");
{
  /* Nothing else may already hold either port. `vite preview --strictPort` exits when :5199 is taken, and the
     check below only asks whether the URL answers, so a dev server left running on that port made this step
     pass "the site is being served from the temp dist" and then drove that other build for the whole run:
     every dashboard step failed for reasons that had nothing to do with the code under test. Say so instead. */
  for (const [what, url] of [["The API port", `${API_URL}/health`], ["The site port", `${SITE_URL}/`]] as [string, string][]) {
    const busy = await fetch(url, { signal: AbortSignal.timeout(3000) }).then(() => true).catch(() => false);
    if (busy) {
      record(what + " is free", false, url + " is already answering. Stop whatever is on it: this run would test that server, not this build.");
      process.exit(1);
    }
  }
  // A fresh start on the scratch branch: this listing has no claim, no bookings and no sign-in links yet.
  process.env.DATABASE_URL = E2E_DB;
  const pg = await import("../src/db/pg.ts");
  await pg.migratePg();
  await pg.query("delete from bookings where listing = $1", [LISTING_ID]);
  await pg.query("delete from profile_emails where listing = $1", [LISTING_ID]);
  await pg.query("delete from profiles where id = $1", [LISTING_ID]);
  await pg.closePg();
  start("npx", ["tsx", "src/index.ts", "serve"], { cwd: BACKEND, env: childEnv(), logTo: apiLogPath, tag: "api" });
  const up = await waitFor(`${API_URL}/health`, 90000);
  if (!up) {
    record("the API started", false, "no answer on " + API_URL + "/health");
    console.log("\nAPI log:\n" + readFileSync(apiLogPath, "utf8").slice(-3000));
    process.exit(1);
  }
  const config = (await fetch(`${API_URL}/config`).then((r) => r.json())) as { payments: boolean; mail: boolean };
  // Loud check: if mail were on, this run would email real people.
  if (config.mail) {
    record("the API is running with mail off", false, "the API reports mail ON: a key leaked into its environment. Stopping.");
    process.exit(1);
  }
  record("the API is running with mail off and payments " + (config.payments ? "in Stripe test mode" : "off"), up, API_URL);

  start("npx", ["vite", "preview", "--port", String(SITE_PORT), "--strictPort", "--outDir", dist], { cwd: ROOT, env: process.env, logTo: join(tmp, "site.log"), tag: "site" });
  const siteUp = await waitFor(`${SITE_URL}/`, 60000);
  record("the site is being served from the temp dist", siteUp, SITE_URL);
  if (!up || !siteUp) {
    console.log("\nCould not start the servers. API log:\n" + readFileSync(apiLogPath, "utf8").slice(-2000));
    process.exit(1);
  }
}

/* ---------------------------------------------------------------- 6. the browser scenario ------------------- */

console.log("\n6. Claim, edit, book, accept and decline, in a headless browser");
{
  const env = {
    ...process.env,
    CHROME,
    W: "1440",
    H: "900",
    E2E_BASE: SITE_URL,
    E2E_API: API_URL,
    E2E_ID: LISTING_ID,
    E2E_EMAIL: OWNER_EMAIL,
    E2E_STORE: store,
    E2E_TITLE: String(detail.title || ""),
    E2E_APILOG: apiLogPath,
    // Every message the API wrote, as MAIL_DUMP_DIR left it: "To:" and "Subject:" and the body. The mail checks
    // read these rather than the API log, whose recipient is masked on purpose and cannot tell two of the
    // harness's guests at the same domain apart.
    E2E_MAIL_DIR: mailDir,
    E2E_OUT: flowOut,
    E2E_STRIPE: testKey ? "1" : "",
  };
  const flowFile = join(here, "e2e-local-flow.mjs");
  const useDriver = existsSync(DRIVER);
  if (NO_BROWSER) {
    record("(a-h3) the browser scenario", "warn", "skipped: --no-browser");
  } else {
    const r = useDriver ? await run("node", [DRIVER, shots, flowFile], { cwd: BACKEND, env }) : await run("node", [flowFile, shots], { cwd: BACKEND, env });
    if (r.code !== 0) console.log("    (the browser run exited " + r.code + ")");
    const steps = existsSync(flowOut) ? (JSON.parse(readFileSync(flowOut, "utf8")) as Result[]) : [];
    for (const s of steps) results.push(s);
    if (!steps.length) record("the browser scenario produced results", false, "no results file; see the output above");
  }
}

/* ---------------------------------------------------------------- 6b. things to know ----------------------- */

/**
 * The things-to-know fields (cancellation policy, requirements, what's included, check-in, FAQ), without a
 * browser. The profile is built and published by the same guest-side code the dashboard runs (defaultProfile,
 * toCatalog), saved through the same PUT /profiles/:id, and read back three ways: the guest's GET /profiles/:id,
 * the guest catalog layering that GET feeds (mergeCatalog + setOperatorOverride + experienceById, which is what
 * the listing page renders from), and the nightly sync's overlay (loadProfileOverlays + buildCatalogItems).
 *
 * The last two go through JSON, and that is the point of the clearing check: a patch key set to undefined does
 * not survive JSON, so `{ ...scraped, ...patch }` on the other side kept the scraped cancellation line after the
 * operator had removed theirs. toCatalog now publishes "" for a cleared field.
 */
console.log("\n6b. Things to know: cancellation, requirements, included, FAQ, through the API and the guest catalog code");
{
  type Unclaimed = import("../../src/data/types.ts").Unclaimed;
  const op = await import("../../src/lib/operator.ts");
  const cat = await import("../../src/lib/catalog.ts");
  const base = detail as unknown as Unclaimed;
  const owner = { name: "Harness Owner", email: OWNER_EMAIL, phone: "8135550100" };

  const enter = (await fetch(`${API_URL}/claims/${LISTING_ID}/test-enter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: OWNER_EMAIL }) }).then((r) => r.json())) as { session?: string };
  const session = enter.session || "";
  record("(k1) the operator enters the dashboard for the test listing", !!session, session ? "session issued" : JSON.stringify(enter));
  const auth = { "content-type": "application/json", "x-session": session };

  // The profile as the dashboard holds it: whatever an earlier step saved (the browser run adds a service), else
  // the one a fresh claim starts from. Either way it must start from the listing's published lines, not blanks.
  const held = (await fetch(`${API_URL}/profiles/${LISTING_ID}`, { headers: auth }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { profile?: unknown } | null;
  let p = op.normalizeProfile(held?.profile) || op.defaultProfile(base, owner);
  p = op.hydrateProfile(p, base);
  const scrapedCancel = String(base.cancellation || "");
  record(
    "(k2) the profile starts from the published things-to-know lines (knowFrom), never from blank boxes",
    !!scrapedCancel && p.cancellation === scrapedCancel && (p.includes || []).length === (base.includes || []).length && (p.faq || []).length === (base.faq || []).length,
    `cancellation "${p.cancellation || ""}", ${(p.includes || []).length} included, ${(p.faq || []).length} FAQ`,
  );

  const CANCEL = "Free cancellation up to 48 hours before your start time, set by the harness.";
  const REQ = "Bring a photo ID (harness requirement).";
  const INC = "A harness towel";
  const FAQ = { q: "Was this FAQ written by the harness?", a: "Yes. It proves an operator's own question and answer reach the guest listing." };
  p = { ...p, cancellation: CANCEL, requirements: [...(p.requirements || []), REQ], includes: [...(p.includes || []), INC], faq: [...(p.faq || []), FAQ] };
  const save = async (prof: typeof p) => {
    const patch = op.toCatalog(prof, base);
    const r = await fetch(`${API_URL}/profiles/${LISTING_ID}`, { method: "PUT", headers: auth, body: JSON.stringify({ profile: prof, patch, published: prof.published, owner }) });
    return { ok: r.ok, status: r.status, patch };
  };
  const guestPatch = async () => (await fetch(`${API_URL}/profiles/${LISTING_ID}`).then((r) => r.json())) as { published?: boolean; patch?: Partial<Unclaimed>; owner?: unknown };
  /** What the listing page renders from once GET /profiles/:id has answered: the API's patch layered over the detail file. */
  const guestSees = (remote: { published?: boolean; patch?: Partial<Unclaimed> }) => {
    cat.mergeCatalog([base], {});
    cat.setOperatorOverride(LISTING_ID, remote.patch || null, remote.published !== false);
    return cat.experienceById(LISTING_ID);
  };

  const saved = await save(p);
  record("(k3) the edit saves through PUT /profiles/:id like the dashboard's own save", saved.ok, "HTTP " + saved.status);
  let remote = await guestPatch();
  const rp = remote.patch || {};
  record(
    "(k4) the guest JSON the API serves carries the operator's cancellation, requirement, included item and FAQ pair, and no owner",
    rp.cancellation === CANCEL && !!rp.requirements?.includes(REQ) && !!rp.includes?.includes(INC) && !!rp.faq?.some((f) => f.q === FAQ.q && f.a === FAQ.a) && remote.owner === undefined,
    JSON.stringify({ cancellation: rp.cancellation, requirements: rp.requirements, includes: rp.includes, faq: (rp.faq || []).length, fc: rp.fc }).slice(0, 300),
  );
  let seen = guestSees(remote);
  record(
    "(k5) a guest opening the listing sees the operator's cancellation line instead of the scraped one",
    !!seen && seen.cancellation === CANCEL && seen.cancellation !== scrapedCancel && seen.fc === "Free cancellation up to 48 hours before" && !!seen.faq?.some((f) => f.q === FAQ.q),
    seen ? `cancellation "${seen.cancellation}", fc "${seen.fc}", ${(seen.faq || []).length} FAQ` : "no listing",
  );

  // Cleared on purpose. The listing must then show no cancellation line at all, not the scraped one again.
  const cleared = await save({ ...p, cancellation: "" });
  remote = await guestPatch();
  const has = remote.patch ? Object.prototype.hasOwnProperty.call(remote.patch, "cancellation") : false;
  record(
    "(k6) clearing the cancellation field publishes an empty line that survives JSON, not a missing key",
    cleared.ok && has && remote.patch?.cancellation === "" && remote.patch?.fc === "",
    `key present: ${has}, value ${JSON.stringify(remote.patch?.cancellation)}, fc ${JSON.stringify(remote.patch?.fc)}`,
  );
  seen = guestSees(remote);
  record(
    "(k7) the guest listing then shows no cancellation line rather than the scraped one, and no Free cancellation badge",
    !!seen && !seen.cancellation && !seen.fc && !!seen.requirements?.includes(REQ),
    seen ? `cancellation ${JSON.stringify(seen.cancellation)}, fc ${JSON.stringify(seen.fc)}` : "no listing",
  );
  // The nightly sync reads the same rows straight from Postgres and layers them the same way.
  {
    process.env.DATABASE_URL = E2E_DB;
    const sync = await import("../src/sync/contacts.ts");
    const loaded = await sync.loadProfileOverlays();
    const item = sync.buildCatalogItems((r) => r.origin === "test").find((i) => i.id === LISTING_ID) as { cancellation?: string; fc?: string; requirements?: string[] } | undefined;
    record(
      "(k8) the nightly sync builds the listing with the cleared line cleared too, and the operator's requirement in",
      loaded.count > 0 && !!item && !item.cancellation && !item.fc && !!item.requirements?.includes(REQ),
      `${loaded.count} overlays from ${loaded.source}; cancellation ${JSON.stringify(item?.cancellation)}, fc ${JSON.stringify(item?.fc)}`,
    );
  }
  // Put the operator's line back so the rest of the run (and --keep) shows a listing with a policy on it.
  await save(p);
}

/* ---------------------------------------------------------------- 7. payouts -------------------------------- */

console.log("\n7. Payouts");
{
  const sessionRes = (await fetch(`${API_URL}/claims/${LISTING_ID}/test-enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL }),
  }).then((r) => r.json())) as { session?: string };
  const session = sessionRes.session || "";
  const auth = { "content-type": "application/json", "x-session": session };

  const status = (await fetch(`${API_URL}/payouts/${LISTING_ID}`, { headers: { "x-session": session } }).then((r) => r.json())) as { available: boolean; connected?: boolean };
  record("the payouts status route answers the operator", typeof status.available === "boolean", JSON.stringify(status).slice(0, 160));

  // A pay schedule needs a connected account. Stripe Connect onboarding is a person clicking through Stripe's
  // own pages, so the account record is written straight into the store, the way payout-e2e.mts does. Profiles
  // live in Postgres now, so it goes in through the repo layer and is read back the same way; rewriting the
  // JSON file this used to touch crashed the run, because that file is no longer there.
  process.env.DATABASE_URL = E2E_DB;
  const repo = await import("../src/lib/repo.ts");
  type PayoutRec = { payout?: { interval?: string } };
  const storedPayout = async () => ((await repo.getProfile(LISTING_ID)) as PayoutRec | null)?.payout?.interval;
  {
    const rec = await repo.getProfile(LISTING_ID);
    if (rec) await repo.putProfile({ ...rec, payout: { account: "acct_e2e_local", enabled: true, detailsSubmitted: true, updatedAt: new Date().toISOString() } });
  }
  const toBi = (await fetch(`${API_URL}/payouts/${LISTING_ID}/schedule`, { method: "PUT", headers: auth, body: JSON.stringify({ interval: "biweekly" }) }).then((r) => r.json())) as { interval?: string };
  const afterBi = await storedPayout();
  const toWeekly = (await fetch(`${API_URL}/payouts/${LISTING_ID}/schedule`, { method: "PUT", headers: auth, body: JSON.stringify({ interval: "weekly" }) }).then((r) => r.json())) as { interval?: string };
  const afterWeekly = await storedPayout();
  record("the pay schedule changes to every two weeks and back to weekly", toBi.interval === "biweekly" && afterBi === "biweekly" && toWeekly.interval === "weekly" && afterWeekly === "weekly", `${toBi.interval} then ${toWeekly.interval}`);

  const stranger = await fetch(`${API_URL}/payouts/${LISTING_ID}/schedule`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ interval: "biweekly" }) });
  record("someone without the operator's session cannot change the schedule", stranger.status === 403, "HTTP " + stranger.status);

  if (testKey) {
    await stripeSection(session);
  } else {
    const r = await run("npx", ["tsx", "scripts/payout-e2e.mts"], { cwd: BACKEND, env: childEnv({ STRIPE_SECRET_KEY: "", STORE_DIR: "", MAIL_DUMP_DIR: "" }), quiet: true });
    const passed = (r.out.match(/pass /g) || []).length;
    // payout-e2e.mts exits 0 when it skips for want of a database, so a run that never happened would have been
    // recorded here as a pass. A pass has to mean checks actually ran.
    const ran = passed > 0 && !/skipping the payout e2e/.test(r.out);
    record(
      "the money path passes end to end against the Stripe recorder (payout-e2e.mts)",
      r.code === 0 && ran,
      ran ? `${passed} checks passed` + (r.code === 0 ? "" : "\n" + r.out.slice(-800)) : "it did not run: " + r.out.trim().split("\n").slice(-2).join(" ").slice(0, 200),
    );
  }

  const runOut = (await fetch(`${API_URL}/admin/payouts/run`, { method: "POST", headers: { "x-admin-key": ADMIN_KEY } }).then((r) => r.json())) as Record<string, unknown>;
  const refused = await fetch(`${API_URL}/admin/payouts/run`, { method: "POST" });
  record("the payout run answers the admin key and nobody else", refused.status === 404 && !!runOut, `run: ${JSON.stringify(runOut).slice(0, 160)}; without the key: HTTP ${refused.status}`);
}

/* ---------------------------------------------------------------- Stripe test mode -------------------------- */

/**
 * Only with STRIPE_TEST_SECRET_KEY. There is no `stripe listen` here, so after the guest pays, the session is
 * read back with the test key and a correctly signed checkout.session.completed is posted to the local webhook,
 * exactly the event Stripe would send.
 */
async function stripeSection(session: string): Promise<void> {
  const code = "E2ESTRIPE";
  const date = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const booked = (await fetch(`${API_URL}/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ listing: LISTING_ID, code, date, slot: "10:00", qty: 2, service: "Sunset sail", variant: "Adult", total: 10, guest: { name: "Harness Card", phone: "4165550199", email: "harness.card@example.com" } }),
  }).then((r) => r.json())) as { checkoutUrl?: string; status?: string };
  record("Stripe Checkout opens for a card booking", !!booked.checkoutUrl, booked.checkoutUrl ? booked.checkoutUrl.slice(0, 60) + "…" : JSON.stringify(booked));
  if (!booked.checkoutUrl) return;
  if (NO_BROWSER) {
    record("(i) the guest pays the hosted Checkout with the test card", "warn", "skipped: --no-browser (paying needs Stripe's own page)");
    return;
  }

  const r = await run("node", [join(here, "e2e-local-flow.mjs"), shots], {
    cwd: BACKEND,
    env: { ...process.env, CHROME, W: "1440", H: "900", E2E_MODE: "stripe", E2E_CHECKOUT_URL: booked.checkoutUrl, E2E_BASE: SITE_URL, E2E_OUT: join(tmp, "stripe.json") },
  });
  const paidSteps = existsSync(join(tmp, "stripe.json")) ? (JSON.parse(readFileSync(join(tmp, "stripe.json"), "utf8")) as Result[]) : [];
  for (const s of paidSteps) results.push(s);
  void r;

  // The webhook Stripe would send, signed with the local secret. Bookings live in Postgres, so the session id
  // is read back through the repo layer rather than out of a JSON file.
  const repo = await import("../src/lib/repo.ts");
  const rec = await repo.getBooking<{ code: string; listing: string; status: string; date: string; created: string; payment?: { session: string; intent: string | null } }>(LISTING_ID, code);
  const sessionId = rec?.payment?.session || "";
  const got = (await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { authorization: "Bearer " + testKey } }).then((x) => x.json())) as { payment_intent?: string; payment_status?: string };
  const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: sessionId, payment_intent: got.payment_intent || rec?.payment?.intent, metadata: { code, listing: LISTING_ID } } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", WEBHOOK_SECRET).update(t + "." + payload).digest("hex");
  const hook = await fetch(`${API_URL}/stripe/webhook`, { method: "POST", body: payload, headers: { "stripe-signature": `t=${t},v1=${sig}` } });
  record("the signed checkout.session.completed webhook is accepted", hook.ok, "HTTP " + hook.status + ", payment_status " + got.payment_status);

  const accepted = await fetch(`${API_URL}/bookings/${LISTING_ID}/${code}`, { method: "PATCH", headers: { "content-type": "application/json", "x-session": session }, body: JSON.stringify({ status: "accepted" }) });
  await sleep(1500);
  const after = await repo.getBooking<{ code: string; listing: string; status: string; date: string; created: string; payment?: { state: string }; payout?: { state: string; amount: number } }>(LISTING_ID, code);
  record("accepting captures the card and schedules the operator's share", accepted.ok && after?.payment?.state === "captured" && after?.payout?.state === "scheduled", JSON.stringify({ payment: after?.payment?.state, payout: after?.payout }));
}

/* ---------------------------------------------------------------- 8. the routes, in process ---------------- */

/**
 * scripts/store-e2e.mts drives the claim, profile, sign-in, slot and booking routes in process against the same
 * scratch database and checks the rows they write. The browser run above covers the journey; this covers the
 * edges of it: odd bodies, a booking code that is not one, a dashboard record whose fields are the wrong shape,
 * a time with room for one more guest but not two, and a service the shop's menu does not price.
 */
console.log("\n8. Every route, driven in process (store-e2e.mts)");
{
  const r = await run("npx", ["tsx", "scripts/store-e2e.mts"], { cwd: BACKEND, env: childEnv({ STRIPE_SECRET_KEY: "", STORE_DIR: "", MAIL_DUMP_DIR: "", OUTSET_TEST_CLAIM_EMAILS: "" }), quiet: true });
  const passed = (r.out.match(/ {2}pass {2}/g) || []).length;
  // It exits 0 when it skips for want of a database, so a pass has to mean checks actually ran.
  const ran = passed > 0 && !/skipping the store e2e/.test(r.out);
  record(
    "the claim, profile, slot and booking routes pass their own checks (store-e2e.mts)",
    r.code === 0 && ran,
    ran ? `${passed} checks passed` + (r.code === 0 ? "" : "\n" + r.out.slice(-1200)) : "it did not run: " + r.out.trim().split("\n").slice(-2).join(" ").slice(0, 200),
  );
}

/* ---------------------------------------------------------------- 8b. the tests that need no server -------- */

/**
 * The unit tests on both sides. They need no database, no server and no browser, so nothing else in this
 * rehearsal would notice them breaking: `npm test` in backend/ was not run here, and the guest side had no
 * runner at all, which is how a search suggestion could promise 1,511 places and open an empty page.
 */
console.log("\n8b. Unit tests, both sides");
// Both run from backend/, the only side with tsx installed; the guest tests are plain node:test files.
for (const [what, pattern] of [
  ["the supply and payments tests (backend)", "src/**/__tests__/*.test.ts"],
  ["the guest search tests (src/lib)", "../src/lib/__tests__/*.test.ts"],
] as [string, string][]) {
  const r = await run("npx", ["tsx", "--test", pattern], { cwd: BACKEND, env: childEnv({ STRIPE_SECRET_KEY: "", STORE_DIR: "", MAIL_DUMP_DIR: "" }), quiet: true });
  const passed = Number((r.out.match(/^# pass (\d+)/m) || [])[1] || 0);
  // A failing run used to report nothing but the number that passed, so "95 tests passed" was the whole
  // account of two broken tests and there was no way to tell which two without running them by hand.
  const failed = r.out.split("\n").filter((l) => /^not ok \d+ - /.test(l)).map((l) => l.replace(/^not ok \d+ - /, "").trim());
  const ok = r.code === 0 && passed > 0 && !failed.length;
  record(what, ok, ok ? `${passed} tests passed` : failed.length ? `${failed.length} failed of ${passed + failed.length}: ` + failed.slice(0, 6).join("; ") : "no test ran\n" + r.out.slice(-800));
}

/**
 * The type checks, which nothing was running on the guest side.
 *
 * `tsc --noEmit -p .` at the root reads a solution file: `files: []` and two references, so without `-b` it
 * has no inputs and exits 0 having checked nothing. Render builds the site with bare `vite build`, which
 * strips types rather than checking them. `npm run build` does run `tsc -b`, and it had been failing for
 * days on the guest unit tests, so nobody ran that either. Between the three, every line under `src/` went
 * unchecked. `tsc -b` is the one that reads the projects, so it is the one this runs.
 */
console.log("\n8c. Type checks, both sides");
for (const [what, cwd, args] of [
  ["the guest app type-checks (tsc -b)", ROOT, ["tsc", "-b", "--force"]],
  ["the supply API type-checks", BACKEND, ["tsc", "--noEmit", "-p", "."]],
] as [string, string, string[]][]) {
  const r = await run("npx", args, { cwd, env: childEnv(), quiet: true });
  // TS5097 is the .ts extension on an import, which is how the backend's own ESM imports are written.
  const problems = r.out.split("\n").filter((l) => /error TS/.test(l) && !/TS5097/.test(l));
  record(what, problems.length === 0, problems.length ? problems.slice(0, 6).join("\n") : "clean");
}

/* ---------------------------------------------------------------- 9. the emails ----------------------------- */

console.log("\n9. Every email, read back");
{
  const files = readdirSync(mailDir).filter((f) => f.endsWith(".txt")).sort();
  const problems: string[] = [];
  for (const f of files) {
    const body = readFileSync(join(mailDir, f), "utf8");
    // Things no email should ever say: a raw ISO date, a 24 hour clock, JavaScript leaking, an empty name.
    for (const [why, re] of [
      ["ISO date", /\b\d{4}-\d{2}-\d{2}\b/],
      ["24h clock", /\bat \d{2}:\d{2}(?! [AP]M)/],
      ["undefined", /\bundefined\b/],
      ["NaN", /\bNaN\b/],
      ["object", /\[object /],
      ["empty guest", /Guest: ,/],
    ] as [string, RegExp][]) {
      const m = re.exec(body.split("\n").slice(2).join("\n"));
      if (m) problems.push(`${f}: ${why} ("${m[0]}")`);
    }
    // Every amount says which dollars it is: "$19.00 USD" or "CA$19.00", never a bare "$19".
    for (const m of body.matchAll(/(CA)?\$[\d,]+(?:\.\d+)?( USD)?/g)) {
      if (!m[1] && !m[2]) problems.push(`${f}: bare dollars ("${m[0]}")`);
    }
    if (!existsSync(join(mailDir, f.replace(/\.txt$/, ".html")))) problems.push(`${f}: no HTML version`);
  }
  record(`${files.length} emails were produced, each with an HTML version and human dates and money`, files.length > 0 && problems.length === 0, problems.length ? problems.slice(0, 6).join("; ") : files.map((f) => f.replace(/^\d+-/, "")).join(", ").slice(0, 300));
  if (NO_BROWSER) {
    record("(m) every email rendered to a screenshot", "warn", "skipped: --no-browser");
  } else {
    const r = await run("node", [join(here, "e2e-local-flow.mjs"), shots], {
      cwd: BACKEND,
      env: { ...process.env, CHROME, W: "680", H: "900", E2E_MODE: "mail", E2E_MAIL_DIR: mailDir, E2E_OUT: join(tmp, "mail.json") },
    });
    void r;
  }
  const mailSteps = existsSync(join(tmp, "mail.json")) ? (JSON.parse(readFileSync(join(tmp, "mail.json"), "utf8")) as Result[]) : [];
  for (const s of mailSteps) results.push(s);
}

/* ---------------------------------------------------------------- 8. summary -------------------------------- */

const failed = results.filter((r) => r.ok === false).length;
const warned = results.filter((r) => r.ok === "warn").length;
console.log("\n" + "-".repeat(70));
for (const r of results) console.log((r.ok === "warn" ? "WARN  " : r.ok ? "pass  " : "FAIL  ") + r.step);
console.log("-".repeat(70));
console.log(`${results.length - failed - warned} passed, ${warned} warned, ${failed} failed`);
console.log("Screenshots: " + shots);
console.log("Emails:      " + mailDir);
console.log("API log:     " + apiLogPath);
// A place to keep the screenshots, the emails and the log after the temp world is deleted.
if (process.env.E2E_COPY_TO) {
  const to = process.env.E2E_COPY_TO;
  for (const [from, name] of [[shots, "shots"], [mailDir, "mail"]] as [string, string][]) cpSync(from, join(to, name), { recursive: true });
  copyFileSync(apiLogPath, join(to, "api.log"));
  console.log("Copied to:   " + to);
}

if (KEEP) {
  console.log("\nLeft running for you (--keep). Nothing here touches production:");
  console.log("  Guest listing:   " + SITE_URL + "/#o=" + LISTING_ID);
  console.log("  Operator claim:  " + SITE_URL + "/operators#claim=" + LISTING_ID + "   (use " + OWNER_EMAIL + ", then \"Open the dashboard now\")");
  console.log("  API:             " + API_URL + "/health");
  console.log("  Admin key:       " + ADMIN_KEY + "   (x-admin-key for POST " + API_URL + "/admin/payouts/run)");
  console.log("  Temp store:      " + store);
  console.log("\nPress Ctrl+C to stop both servers and delete the temp store and database copy.");
  await new Promise(() => undefined);
}

console.log("\nStopped both servers, deleted the temp store and the database copy.");
process.exit(failed ? 1 : 0);

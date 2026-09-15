/**
 * The whole operator and money path, end to end, on this machine only.
 *
 * It exists because the live system cannot be used for a rehearsal: the production API runs Stripe in LIVE mode
 * (a card test charges a real card), bookings and owner details are written to the public site repository until
 * DATA_REPO points at a private one, and notification mail goes to real inboxes. So this builds a throwaway copy
 * of everything and runs the real code against it:
 *
 *   - a temp database with the production schema and the fake listing from scripts/test-listing.mts in it
 *     (--full-db copies the real catalog instead, which is faithful but boots slowly)
 *   - the real API (src/index.ts serve) on http://localhost:8787 with a temp STORE_DIR, no GitHub token, no data
 *     repository and no mail key, so every email is printed to the log instead of sent
 *   - the real site, built with VITE_API_URL pointing at that API and served from a temp dist on :5199
 *   - a headless browser that claims the listing, edits it, books it, accepts and declines
 *   - the payout path, through scripts/payout-e2e.mts's Stripe recorder, or through Stripe TEST mode when
 *     STRIPE_TEST_SECRET_KEY (sk_test_...) is set
 *
 * Nothing is written to the repository: not public/, not dist/, not backend/data/outset.db. The only outbound
 * requests are the listing's own Unsplash photos, which the browser loads, and Stripe test mode when a test key
 * is given.
 *
 *   npx tsx scripts/e2e-local.mts            run everything and clean up
 *   npx tsx scripts/e2e-local.mts --keep     leave the API and the site running so you can click through
 *   npx tsx scripts/e2e-local.mts --full-db  copy the whole catalog database instead of starting empty
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
function cleanup(): void {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* already gone */
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
  const c = spawn(cmd, args, { cwd: opts.cwd, env: opts.env || process.env });
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
    E2E_OUT: flowOut,
    E2E_STRIPE: testKey ? "1" : "",
  };
  const flowFile = join(here, "e2e-local-flow.mjs");
  const useDriver = existsSync(DRIVER);
  const r = useDriver ? await run("node", [DRIVER, shots, flowFile], { cwd: BACKEND, env }) : await run("node", [flowFile, shots], { cwd: BACKEND, env });
  if (r.code !== 0) console.log("    (the browser run exited " + r.code + ")");
  const steps = existsSync(flowOut) ? (JSON.parse(readFileSync(flowOut, "utf8")) as Result[]) : [];
  for (const s of steps) results.push(s);
  if (!steps.length) record("the browser scenario produced results", false, "no results file; see the output above");
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
  // own pages, so the account record is written straight into the temp store, the way payout-e2e.mts does.
  const profilePath = join(store, "profiles", LISTING_ID + ".json");
  if (existsSync(profilePath)) {
    const rec = JSON.parse(readFileSync(profilePath, "utf8"));
    rec.payout = { account: "acct_e2e_local", enabled: true, detailsSubmitted: true, updatedAt: new Date().toISOString() };
    writeFileSync(profilePath, JSON.stringify(rec, null, 1));
  }
  const toBi = (await fetch(`${API_URL}/payouts/${LISTING_ID}/schedule`, { method: "PUT", headers: auth, body: JSON.stringify({ interval: "biweekly" }) }).then((r) => r.json())) as { interval?: string };
  const afterBi = JSON.parse(readFileSync(profilePath, "utf8")).payout?.interval;
  const toWeekly = (await fetch(`${API_URL}/payouts/${LISTING_ID}/schedule`, { method: "PUT", headers: auth, body: JSON.stringify({ interval: "weekly" }) }).then((r) => r.json())) as { interval?: string };
  const afterWeekly = JSON.parse(readFileSync(profilePath, "utf8")).payout?.interval;
  record("the pay schedule changes to every two weeks and back to weekly", toBi.interval === "biweekly" && afterBi === "biweekly" && toWeekly.interval === "weekly" && afterWeekly === "weekly", `${toBi.interval} then ${toWeekly.interval}`);

  const stranger = await fetch(`${API_URL}/payouts/${LISTING_ID}/schedule`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ interval: "biweekly" }) });
  record("someone without the operator's session cannot change the schedule", stranger.status === 403, "HTTP " + stranger.status);

  if (testKey) {
    await stripeSection(session);
  } else {
    const r = await run("npx", ["tsx", "scripts/payout-e2e.mts"], { cwd: BACKEND, env: childEnv({ STRIPE_SECRET_KEY: "", STORE_DIR: "", MAIL_DUMP_DIR: "" }), quiet: true });
    const passed = (r.out.match(/pass /g) || []).length;
    record("the money path passes end to end against the Stripe recorder (payout-e2e.mts)", r.code === 0, `${passed} checks passed` + (r.code === 0 ? "" : "\n" + r.out.slice(-800)));
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

  const r = await run("node", [join(here, "e2e-local-flow.mjs"), shots], {
    cwd: BACKEND,
    env: { ...process.env, CHROME, W: "1440", H: "900", E2E_MODE: "stripe", E2E_CHECKOUT_URL: booked.checkoutUrl, E2E_BASE: SITE_URL, E2E_OUT: join(tmp, "stripe.json") },
  });
  const paidSteps = existsSync(join(tmp, "stripe.json")) ? (JSON.parse(readFileSync(join(tmp, "stripe.json"), "utf8")) as Result[]) : [];
  for (const s of paidSteps) results.push(s);
  void r;

  // The webhook Stripe would send, signed with the local secret.
  const list = JSON.parse(readFileSync(join(store, "bookings", LISTING_ID + ".json"), "utf8")) as { code: string; payment?: { session: string; intent: string | null } }[];
  const rec = list.find((b) => b.code === code);
  const sessionId = rec?.payment?.session || "";
  const got = (await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { authorization: "Bearer " + testKey } }).then((x) => x.json())) as { payment_intent?: string; payment_status?: string };
  const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: sessionId, payment_intent: got.payment_intent || rec?.payment?.intent, metadata: { code, listing: LISTING_ID } } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", WEBHOOK_SECRET).update(t + "." + payload).digest("hex");
  const hook = await fetch(`${API_URL}/stripe/webhook`, { method: "POST", body: payload, headers: { "stripe-signature": `t=${t},v1=${sig}` } });
  record("the signed checkout.session.completed webhook is accepted", hook.ok, "HTTP " + hook.status + ", payment_status " + got.payment_status);

  const accepted = await fetch(`${API_URL}/bookings/${LISTING_ID}/${code}`, { method: "PATCH", headers: { "content-type": "application/json", "x-session": session }, body: JSON.stringify({ status: "accepted" }) });
  await sleep(1500);
  const after = (JSON.parse(readFileSync(join(store, "bookings", LISTING_ID + ".json"), "utf8")) as { code: string; payment?: { state: string }; payout?: { state: string; amount: number } }[]).find((b) => b.code === code);
  record("accepting captures the card and schedules the operator's share", accepted.ok && after?.payment?.state === "captured" && after?.payout?.state === "scheduled", JSON.stringify({ payment: after?.payment?.state, payout: after?.payout }));
}

/* ---------------------------------------------------------------- 8. the emails ----------------------------- */

console.log("\n8. Every email, read back");
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
  const r = await run("node", [join(here, "e2e-local-flow.mjs"), shots], {
    cwd: BACKEND,
    env: { ...process.env, CHROME, W: "680", H: "900", E2E_MODE: "mail", E2E_MAIL_DIR: mailDir, E2E_OUT: join(tmp, "mail.json") },
  });
  void r;
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

import "../src/env.ts";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { chromePath } from "../src/scrape/render.ts";
import { isLaptop } from "../src/scrape/guard.ts";

/**
 * Always-on scheduler for the Outset pipeline. Runs on Render as a background worker with a persistent disk.
 *
 * The Render build only provides Node and Chromium. On every job this process pulls the repo into
 * $DATA_DIR/repo (shallow clone, `npm ci` when package-lock changes) and runs the job from that clone, so the
 * code is always current and the catalog outputs land inside a git checkout the sync job can commit and push.
 *
 * One job runs at a time (a single queue): a job can never overlap itself, and the starter instance never has
 * three crawls plus Chromium in memory at once. Each job is a child process group with a hard timeout.
 *
 *   npx tsx scripts/pipeline.mts                 run forever
 *   npx tsx scripts/pipeline.mts --dry           print the schedule and exit
 *   npx tsx scripts/pipeline.mts --once=sync     run one job and exit (status, collect, discover, structure,
 *                                                photos, hours, promo, screen, owners, sync)
 *
 * Money: nothing here submits an extraction batch or calls a paid search. `collect` only stores batches that
 * were already paid for when they were submitted from the laptop. Any future job marked `spends` is skipped
 * once paidSpendUsd() reaches PAID_CAP_USD (same numbers as src/discover/aisearch.ts).
 */

const TZ = process.env.PIPELINE_TZ || "America/Toronto";
const DB_PATH = process.env.OUTSET_DB_PATH || "/var/data/outset.db";
const DATA_DIR = dirname(DB_PATH);
const STATUS_PATH = process.env.PIPELINE_STATUS_PATH || join(DATA_DIR, "pipeline-status.json");
const REPO_DIR = process.env.PIPELINE_REPO_DIR || join(DATA_DIR, "repo");
const REPO = process.env.GITHUB_REPO || "harshils2340/outset-app";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN || "";
const PAID_CAP_USD = Number(process.env.PAID_CAP_USD || 20);
const PORT = Number(process.env.PORT || 8790);
const MIN = 60_000;
const HOUR = 60 * MIN;
/** A daily job whose time passed while the worker was down still runs if we boot within this window. */
const CATCH_UP_MS = 6 * HOUR;
const TICK_MS = 20_000;

type Job = {
  name: string;
  /** "HH:MM" in PIPELINE_TZ, once a day. */
  at?: string;
  /** Interval in ms, instead of a time of day. */
  every?: number;
  timeoutMs: number;
  /** Arguments after `tsx`, run with cwd = <clone>/backend. Empty for built-in jobs. */
  args: string[];
  needsRepo: boolean;
  needsKey?: string;
  /** Would call a paid API: skipped once the paid cap is reached. */
  spends?: boolean;
  note: string;
};

const JOBS: Job[] = [
  { name: "status", timeoutMs: MIN, args: [], needsRepo: false, note: "write the status file only" },
  { name: "collect", every: 30 * MIN, timeoutMs: 30 * MIN, args: ["src/index.ts", "enrich", "--collect-all"], needsRepo: true, needsKey: "OPENAI_API_KEY", note: "store finished OpenAI batches (already paid); never submits" },
  { name: "discover", at: "22:00", timeoutMs: 3 * HOUR, args: ["src/index.ts", "discover", "--wave=3", "--concurrency=2"], needsRepo: true, note: "OpenStreetMap wave three, free" },
  { name: "structure", at: "23:00", timeoutMs: 4 * HOUR, args: ["src/index.ts", "structure", "5000", "8"], needsRepo: true, note: "menus and facts from each site, rules only" },
  { name: "photos", at: "00:00", timeoutMs: 4 * HOUR, args: ["src/index.ts", "photos", "5000", "8"], needsRepo: true, note: "photo crawl of each site" },
  { name: "hours", at: "01:00", timeoutMs: 4 * HOUR, args: ["scripts/hours-crawl.mts", "5000", "10"], needsRepo: true, note: "opening hours from each site" },
  { name: "promo", at: "02:00", timeoutMs: 3 * HOUR, args: ["scripts/promo-crawl.mts", "--limit=5000"], needsRepo: true, note: "day-specific deals from each site" },
  { name: "purge-names", at: "03:20", timeoutMs: 10 * MIN, args: ["scripts/purge-bad-names.mts"], needsRepo: true, note: "delete stored images the crawler's filename rule now refuses (guides, scanned pages, flyers); no network" },
  { name: "screen", at: "03:30", timeoutMs: 3 * HOUR, args: ["scripts/screen-covers.mts"], needsRepo: true, note: "drop map, logo, flyer and scanned-page covers and gallery photos" },
  { name: "owners", at: "04:00", timeoutMs: HOUR, args: ["src/index.ts", "owners", "2000", "8"], needsRepo: true, note: "owner names and contact pages" },
  { name: "sync", at: "05:00", timeoutMs: HOUR, args: ["src/index.ts", "sync"], needsRepo: true, note: "read-only catalog sync, commit and push public/ and src/data" },
];

type JobState = { lastStart?: string; lastEnd?: string; lastResult?: string; lastExitCode?: number | null; lastSeconds?: number; lastDay?: string; lastLine?: string };
type Status = { startedAt: string; tz: string; db: { path: string; exists: boolean; bytes: number }; chrome: string | null; paid: { discovery: number; extraction: number; total: number; cap: number }; running: string | null; queue: string[]; jobs: Record<string, JobState> };

const status: Status = loadStatus();
const queue: Job[] = [];
let running: Job | null = null;

function loadStatus(): Status {
  const base: Status = { startedAt: new Date().toISOString(), tz: TZ, db: { path: DB_PATH, exists: false, bytes: 0 }, chrome: null, paid: { discovery: 0, extraction: 0, total: 0, cap: PAID_CAP_USD }, running: null, queue: [], jobs: {} };
  try {
    const prev = JSON.parse(readFileSync(STATUS_PATH, "utf8")) as Partial<Status>;
    base.jobs = prev.jobs || {};
  } catch {
    /* first boot */
  }
  return base;
}

function log(job: string, line: string): void {
  process.stdout.write(`${new Date().toISOString()} [${job}] ${line}\n`);
}

function localNow(): { day: string; hhmm: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  const h = Number(get("hour")) % 24;
  const m = Number(get("minute"));
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, minutes: h * 60 + m };
}

/** Same arithmetic as paidSpendUsd() in src/discover/aisearch.ts: web-search ledger plus the extract_spend table. */
function paidSpend(): { discovery: number; extraction: number; total: number } {
  let discovery = 0;
  try {
    const lines = readFileSync(join(REPO_DIR, "backend/data/aisearch-ledger.txt"), "utf8").split("\n").filter(Boolean);
    discovery = lines.length * 0.025 + lines.reduce((n, l) => n + Number(l.split("\t")[3] || 0), 0) * 2e-6;
  } catch {
    /* no ledger */
  }
  let extraction = 0;
  if (existsSync(DB_PATH)) {
    try {
      const db = new DatabaseSync(DB_PATH, { readOnly: true });
      db.exec("PRAGMA busy_timeout = 30000");
      extraction = Number((db.prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM extract_spend").get() as { usd: number }).usd);
      db.close();
    } catch {
      /* table absent or locked */
    }
  }
  return { discovery, extraction, total: discovery + extraction };
}

function writeStatus(): void {
  status.running = running?.name || null;
  status.queue = queue.map((j) => j.name);
  status.db = { path: DB_PATH, exists: existsSync(DB_PATH), bytes: existsSync(DB_PATH) ? statSync(DB_PATH).size : 0 };
  const paid = paidSpend();
  status.paid = { ...paid, cap: PAID_CAP_USD };
  try {
    mkdirSync(dirname(STATUS_PATH), { recursive: true });
    writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
  } catch (e) {
    log("pipeline", "cannot write status file: " + (e as Error).message);
  }
}

// ---------- boot: database ----------

async function ensureDb(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const seed = process.env.DB_SEED_URL || "";
  if (!existsSync(DB_PATH) && seed) {
    const tmp = DB_PATH + ".download";
    log("boot", `database missing, downloading seed from ${seed.replace(/\?.*$/, "")}`);
    rmSync(tmp, { force: true });
    const res = await fetch(seed, { headers: { Accept: "application/octet-stream", ...(TOKEN && /api\.github\.com/.test(seed) ? { Authorization: "Bearer " + TOKEN } : {}) } });
    if (!res.ok || !res.body) throw new Error(`seed download failed: HTTP ${res.status}`);
    await streamPipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
    const bytes = statSync(tmp).size;
    if (bytes < 100 * 1024 * 1024) {
      rmSync(tmp, { force: true });
      throw new Error(`seed download is only ${bytes} bytes; refusing to use it`);
    }
    renameSync(tmp, DB_PATH);
    log("boot", `seed in place: ${(bytes / 1e6).toFixed(0)} MB`);
  }
  if (existsSync(DB_PATH)) {
    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA busy_timeout = 60000");
    const mode = (db.prepare("PRAGMA journal_mode=WAL").get() as { journal_mode: string }).journal_mode;
    db.close();
    log("boot", `database ${DB_PATH} (${(statSync(DB_PATH).size / 1e6).toFixed(0)} MB), journal_mode=${mode}`);
  } else {
    log("boot", `no database at ${DB_PATH} and DB_SEED_URL is empty: crawl jobs will fail until one is in place`);
  }
}

// ---------- repo clone ----------

function git(args: string[], opts: { cwd?: string; quiet?: boolean } = {}): { code: number; out: string } {
  const auth = TOKEN ? ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from("x-access-token:" + TOKEN).toString("base64")}`] : [];
  const r = spawnSync("git", [...auth, ...args], {
    cwd: opts.cwd || REPO_DIR,
    encoding: "utf8",
    timeout: 20 * MIN,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Outset pipeline",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "pipeline@onoutset.com",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || process.env.GIT_AUTHOR_NAME || "Outset pipeline",
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || process.env.GIT_AUTHOR_EMAIL || "pipeline@onoutset.com",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  if (!opts.quiet && out) log("git", `${args[0]} ${args[1] || ""}: ${out.split("\n").slice(-3).join(" | ")}`);
  return { code: r.status ?? 1, out };
}

/** Clone once, then fast-forward to origin. Generated files from a failed sync are discarded; the sync regenerates them. */
function ensureRepo(): void {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is not set; cannot clone " + REPO);
  const url = `https://github.com/${REPO}.git`;
  if (!existsSync(join(REPO_DIR, ".git"))) {
    log("git", `cloning ${REPO} into ${REPO_DIR}`);
    mkdirSync(dirname(REPO_DIR), { recursive: true });
    const r = git(["clone", "--depth", "1", "--branch", BRANCH, url, REPO_DIR], { cwd: dirname(REPO_DIR) });
    if (r.code !== 0) throw new Error("clone failed: " + r.out.slice(-300));
  }
  if (git(["fetch", "--depth", "1", "origin", BRANCH]).code !== 0) throw new Error("fetch failed");
  git(["reset", "--hard", "origin/" + BRANCH], { quiet: true });
  git(["clean", "-fdq", "--", "public", "src"], { quiet: true });
  // Dependencies: install only when the lock file changed since the last install in this clone.
  const backend = join(REPO_DIR, "backend");
  const lock = createHash("sha256").update(readFileSync(join(backend, "package-lock.json"))).digest("hex");
  const marker = join(backend, "node_modules", ".outset-lock-hash");
  let have = "";
  try {
    have = readFileSync(marker, "utf8").trim();
  } catch {
    /* fresh clone */
  }
  if (have !== lock) {
    log("npm", "package-lock changed, running npm ci");
    const r = spawnSync("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"], { cwd: backend, encoding: "utf8", timeout: 20 * MIN, env: { ...process.env, NPM_CONFIG_PRODUCTION: "false" } });
    if (r.status !== 0) throw new Error("npm ci failed: " + ((r.stderr || "") + (r.stdout || "")).slice(-400));
    writeFileSync(marker, lock);
  }
}

// ---------- running a job ----------

function reapChrome(): void {
  spawnSync("pkill", ["-f", "outset-render-"], { stdio: "ignore" });
  spawnSync("pkill", ["-9", "-f", "chrome-headless-shell"], { stdio: "ignore" });
}

/** Spawn tsx in the clone's backend as its own process group; kill the whole group on timeout. */
function runChild(job: Job, args: string[], timeoutMs: number): Promise<{ code: number | null; lastLine: string }> {
  return new Promise((resolve) => {
    const backend = join(REPO_DIR, "backend");
    const tsx = join(backend, "node_modules", ".bin", "tsx");
    const cmd = existsSync(tsx) ? tsx : "npx";
    const argv = existsSync(tsx) ? args : ["tsx", ...args];
    log(job.name, `start: ${cmd === "npx" ? "npx " : ""}${argv.join(" ")} (timeout ${Math.round(timeoutMs / MIN)} min)`);
    const child = spawn(cmd, argv, { cwd: backend, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, OUTSET_DB_PATH: DB_PATH, OUTSET_DB: "", FORCE_COLOR: "0" } });
    let lastLine = "";
    let timedOut = false;
    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        const t = line.trimEnd();
        if (!t || /ExperimentalWarning|--import|node --trace/.test(t)) continue;
        lastLine = t;
        log(job.name, t);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const killGroup = (sig: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          /* gone */
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      log(job.name, `timeout after ${Math.round(timeoutMs / MIN)} min, killing`);
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 30_000).unref();
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      log(job.name, "spawn error: " + e.message);
      resolve({ code: null, lastLine: e.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reapChrome();
      resolve({ code: timedOut ? null : code, lastLine: timedOut ? "timed out" : lastLine });
    });
  });
}

const PUSH_PATHS = ["public/catalog.json", "public/claim-index.json", "public/catalog-lite.json", "public/o", "public/p", "public/sitemap.xml", "src/data/contacts.ts"];

/** Read-only sync (never --ingest), then commit the generated catalog files and push. backend/data is never added. */
async function runSyncAndPush(job: Job): Promise<{ code: number | null; lastLine: string }> {
  const r = await runChild(job, job.args, job.timeoutMs);
  if (r.code !== 0) return r;
  const present = PUSH_PATHS.filter((p) => existsSync(join(REPO_DIR, p)));
  git(["add", "-A", "--", ...present]);
  if (git(["diff", "--cached", "--quiet"], { quiet: true }).code === 0) return { code: 0, lastLine: "sync ran, catalog unchanged, nothing to push" };
  const staged = git(["diff", "--cached", "--stat", "--", "backend/data"], { quiet: true }).out;
  if (staged.trim()) {
    git(["reset", "-q", "--", "backend/data"], { quiet: true });
  }
  if (git(["commit", "-q", "-m", "Catalog: nightly pipeline sync"]).code !== 0) return { code: 1, lastLine: "commit failed" };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (git(["pull", "--rebase", "--autostash", "origin", BRANCH]).code !== 0) return { code: 1, lastLine: "pull --rebase failed" };
    const push = git(["push", "origin", `HEAD:${BRANCH}`]);
    if (push.code === 0) return { code: 0, lastLine: "pushed catalog to " + REPO };
  }
  return { code: 1, lastLine: "push rejected twice" };
}

async function runJob(job: Job): Promise<number | null> {
  const st: JobState = status.jobs[job.name] || {};
  status.jobs[job.name] = st;
  st.lastStart = new Date().toISOString();
  st.lastDay = localNow().day;
  running = job;
  writeStatus();
  const t0 = Date.now();
  let code: number | null = 0;
  let result = "ok";
  let lastLine = "";
  try {
    if (job.needsKey && !process.env[job.needsKey]) {
      result = `skipped: ${job.needsKey} not set`;
    } else if (job.spends && status.paid.total >= PAID_CAP_USD) {
      result = `skipped: paid cap reached ($${status.paid.total.toFixed(2)} of $${PAID_CAP_USD})`;
    } else if (job.name === "status") {
      status.chrome = chromePath();
      result = "ok";
    } else {
      if (job.needsRepo) ensureRepo();
      const r = job.name === "sync" ? await runSyncAndPush(job) : await runChild(job, job.args, job.timeoutMs);
      code = r.code;
      lastLine = r.lastLine;
      if (job.name === "collect" && code === 2) result = "ok: batches still running";
      else result = code === 0 ? "ok" : code === null ? "timed out" : `exit ${code}`;
    }
  } catch (e) {
    code = 1;
    result = "error: " + (e as Error).message;
  }
  st.lastEnd = new Date().toISOString();
  st.lastExitCode = code;
  st.lastSeconds = Math.round((Date.now() - t0) / 1000);
  st.lastResult = result;
  st.lastLine = lastLine;
  running = null;
  log(job.name, `done in ${st.lastSeconds}s: ${result}${lastLine ? " | " + lastLine : ""}`);
  writeStatus();
  return code;
}

// ---------- scheduler ----------

function enqueue(job: Job): void {
  if (running?.name === job.name || queue.some((j) => j.name === job.name)) return;
  queue.push(job);
  log("pipeline", `queued ${job.name}` + (queue.length > 1 ? ` (behind ${queue.slice(0, -1).map((j) => j.name).join(", ")})` : ""));
}

function tick(): void {
  const now = localNow();
  for (const job of JOBS) {
    const st = status.jobs[job.name] || {};
    if (job.every) {
      const last = st.lastStart ? Date.parse(st.lastStart) : 0;
      if (Date.now() - last >= job.every) enqueue(job);
    } else if (job.at) {
      const [h, m] = job.at.split(":").map(Number);
      const due = h * 60 + m;
      const sinceDue = now.minutes - due;
      if (sinceDue >= 0 && sinceDue * MIN < CATCH_UP_MS && st.lastDay !== now.day) enqueue(job);
    }
  }
}

let draining = false;
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      await runJob(job);
    }
  } finally {
    draining = false;
  }
}

function startHealthServer(): void {
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, now: new Date().toISOString(), local: localNow().hhmm + " " + TZ, ...status }, null, 2));
  });
  server.on("error", (e) => log("pipeline", "health server: " + e.message));
  server.listen(PORT, () => log("pipeline", `status on http://0.0.0.0:${PORT}/`));
}

function printSchedule(): void {
  console.log(`Pipeline schedule (times in ${TZ}); db ${DB_PATH}; repo clone ${REPO_DIR}; paid cap $${PAID_CAP_USD}`);
  console.log("One job at a time, in due order. A job never overlaps itself.");
  for (const j of JOBS) {
    const when = j.at ? `daily ${j.at}` : j.every ? `every ${j.every / MIN} min` : "on demand";
    const cmd = j.args.length ? "tsx " + j.args.join(" ") : "(built in)";
    console.log(`  ${j.name.padEnd(10)} ${when.padEnd(14)} timeout ${String(Math.round(j.timeoutMs / MIN)).padStart(3)} min  ${cmd.padEnd(48)} ${j.note}${j.needsKey ? ` [needs ${j.needsKey}]` : ""}${j.spends ? " [paid, capped]" : ""}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--dry")) {
    printSchedule();
    return;
  }
  if (isLaptop() && process.env.OUTSET_ALLOW_CRAWL !== "1") {
    console.error("The overnight pipeline runs on Render, not this Mac. It would start Playwright Chrome and sit on the CPU. Do not set OUTSET_ALLOW_CRAWL from an agent.");
    process.exit(1);
  }
  const once = argv.find((a) => a.startsWith("--once="))?.split("=")[1];
  if (once) {
    const job = JOBS.find((j) => j.name === once);
    if (!job) {
      console.error(`unknown job "${once}". Jobs: ${JOBS.map((j) => j.name).join(", ")}`);
      process.exit(2);
    }
    await ensureDb();
    const code = await runJob(job);
    process.exit(code === 0 || (job.name === "collect" && code === 2) ? 0 : 1);
  }
  log("pipeline", `starting, tz ${TZ}, local ${localNow().hhmm}`);
  await ensureDb();
  status.chrome = chromePath();
  log("pipeline", "chromium: " + (status.chrome || "not found (rendered pages will be skipped)"));
  writeStatus();
  startHealthServer();
  const stop = (sig: string) => {
    log("pipeline", `${sig}, exiting`);
    reapChrome();
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  for (;;) {
    tick();
    void drain();
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main().catch((e) => {
  log("pipeline", "fatal: " + (e as Error).stack);
  process.exit(1);
});

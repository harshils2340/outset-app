/** Browser-like agent so ordinary sites serve real HTML. robots.txt is still honored below, and the From header says who we are. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { withCpuBudget } from "./cpu.ts";
import { safeFetch } from "../lib/safeFetch.ts";

/**
 * One page, fetched once, read by every pass.
 *
 * Six passes visit an operator's own site: the menu and facts reader, the photo crawl, the hours crawl, the
 * owner lookup, the reviews pass and the promo pass. Each of them downloaded the same home page, the same
 * about page and the same contact page on its own, so a site was pulled four to six times over and the crawl
 * was spending most of its day re-reading pages it already had. Against a catalog of 341,000 sites on one
 * small worker, that is the difference between a week and a month.
 *
 * Gzipped on disk, keyed by URL, with a short life and a size cap, because the worker's disk is 5 GB and the
 * database is most of it. A page older than the life is refetched, so nothing here can serve stale facts into
 * the catalog for long.
 */
const here = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = process.env.OUTSET_PAGE_CACHE_DIR || join(dirname(process.env.OUTSET_DB_PATH || join(here, "../../data/outset.db")), "pagecache");
const CACHE_DAYS = Number(process.env.OUTSET_PAGE_CACHE_DAYS || 10);
const CACHE_CAP_BYTES = Number(process.env.OUTSET_PAGE_CACHE_MB || 1500) * 1024 * 1024;
const CACHE_OFF = process.env.OUTSET_PAGE_CACHE === "0";

type Cached = { status: number; html: string; finalUrl: string };

const cachePath = (url: string) => join(CACHE_DIR, createHash("sha256").update(url).digest("hex").slice(0, 2), createHash("sha256").update(url).digest("hex").slice(2) + ".gz");

function readCache(url: string): Cached | null {
  if (CACHE_OFF) return null;
  try {
    const p = cachePath(url);
    const st = statSync(p);
    if (Date.now() - st.mtimeMs > CACHE_DAYS * 86400_000) return null;
    return JSON.parse(gunzipSync(readFileSync(p)).toString("utf8")) as Cached;
  } catch {
    return null;
  }
}

function writeCache(url: string, v: Cached): void {
  if (CACHE_OFF) return;
  try {
    const p = cachePath(url);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, gzipSync(Buffer.from(JSON.stringify(v))));
  } catch {
    /* the cache is an optimisation, never a reason to fail a fetch */
  }
}

/** Delete the oldest pages until the cache is back under its cap. Called by the pipeline, not by a fetch. */
export function prunePageCache(capBytes = CACHE_CAP_BYTES): { kept: number; removed: number; bytes: number } {
  if (!existsSync(CACHE_DIR)) return { kept: 0, removed: 0, bytes: 0 };
  const files: { p: string; size: number; mtime: number }[] = [];
  for (const dir of readdirSync(CACHE_DIR)) {
    const d = join(CACHE_DIR, dir);
    try {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        const st = statSync(p);
        files.push({ p, size: st.size, mtime: st.mtimeMs });
      }
    } catch {
      /* raced with a write */
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  let bytes = 0;
  let kept = 0;
  let removed = 0;
  for (const f of files) {
    const stale = Date.now() - f.mtime > CACHE_DAYS * 86400_000;
    if (!stale && bytes + f.size <= capBytes) {
      bytes += f.size;
      kept++;
      continue;
    }
    try {
      rmSync(f.p);
      removed++;
    } catch {
      /* gone already */
    }
  }
  return { kept, removed, bytes };
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * robots.txt, remembered per origin for the life of the process and on disk between runs.
 *
 * It was refetched before every single page, so each page cost two requests rather than one and a site with
 * eight pages read its robots.txt eight times. On a backlog of 203,665 sites that is the larger half of the
 * crawl spent asking permission it already had.
 */
const robotsMem = new Map<string, { rules: string[]; at: number }>();
const ROBOTS_MS = 12 * 3600_000;

function robotsFile(origin: string): string {
  return join(CACHE_DIR, "robots", createHash("sha256").update(origin).digest("hex") + ".gz");
}

async function robotsRules(origin: string): Promise<string[]> {
  const hot = robotsMem.get(origin);
  if (hot && Date.now() - hot.at < ROBOTS_MS) return hot.rules;
  if (!CACHE_OFF) {
    try {
      const p = robotsFile(origin);
      if (Date.now() - statSync(p).mtimeMs < ROBOTS_MS) {
        const rules = JSON.parse(gunzipSync(readFileSync(p)).toString("utf8")) as string[];
        robotsMem.set(origin, { rules, at: Date.now() });
        return rules;
      }
    } catch {
      /* not cached */
    }
  }
  let rules: string[] = [];
  try {
    const res = await safeFetch(new URL("/robots.txt", origin).href, {
      headers: { "user-agent": UA },
      timeoutMs: 8000,
      maxBytes: 300_000,
    });
    if (res.ok) rules = disallowsFor(await res.text());
  } catch {
    /* unreachable robots.txt is not a refusal */
  }
  robotsMem.set(origin, { rules, at: Date.now() });
  if (!CACHE_OFF) {
    try {
      const p = robotsFile(origin);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, gzipSync(Buffer.from(JSON.stringify(rules))));
    } catch {
      /* optimisation only */
    }
  }
  return rules;
}

/** The Disallow paths that apply to us: the ones under `*` or under our own name. */
export function disallowsFor(text: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k)) applies = v === "*" || v.toLowerCase().includes("outset");
    else if (applies && /^disallow$/i.test(k) && v) out.push(v);
  }
  return out;
}

export async function robotsAllowed(origin: string, path: string): Promise<boolean> {
  const rules = await robotsRules(origin);
  return !rules.some((d) => path.startsWith(d));
}

export async function fetchHtml(url: string): Promise<{ status: number; html: string; finalUrl: string }> {
  const hit = readCache(url);
  if (hit) return hit;
  return withCpuBudget(async () => {
    const u = new URL(url);
    const allowed = await robotsAllowed(u.origin, u.pathname);
    if (!allowed) {
      return { status: 0, html: "", finalUrl: url };
    }
    const res = await safeFetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        from: "harshils2340@gmail.com",
      },
      timeoutMs: 12000,
      maxBytes: 8_000_000,
    });
    const html = await res.text();
    const out = { status: res.status, html, finalUrl: res.url };
    // Only a page that actually arrived. A 500 or a block is worth retrying on the next pass, not remembering.
    if (res.status >= 200 && res.status < 400 && html) writeCache(url, out);
    return out;
  });
}

/** Hard deadline for any per-site job. Slow hosts must not stall a worker for the whole run. */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("deadline " + ms + "ms: " + label)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { isLaptop } from "./guard.ts";

/**
 * Keep at least 10% CPU idle on the founder's Mac so Cursor, Chrome, and the UI stay usable.
 * Work scales up when there is headroom (up to 6 network fetches, 1 headless Chrome) and
 * pauses when idle drops. Below 5% idle, headless Chrome is killed. Render is unchanged.
 */

export const MIN_IDLE = 10;
export const REAP_IDLE = 5;
const MAX_NET = 6;
const SAMPLE_MS = 250;

type Times = { user: number; nice: number; sys: number; idle: number; irq: number };

function snap(): Times[] {
  return cpus().map((c) => ({ ...c.times }));
}

function idleBetween(a: Times[], b: Times[]): number {
  let idle = 0;
  let total = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const di = b[i].idle - a[i].idle;
    const dt = b[i].user - a[i].user + (b[i].nice - a[i].nice) + (b[i].sys - a[i].sys) + di + (b[i].irq - a[i].irq);
    idle += di;
    total += dt;
  }
  return total > 0 ? (100 * idle) / total : 100;
}

let prev = snap();
let prevAt = Date.now();
let cached = 100;
let lastLog = 0;
let lowSince = 0;
let inFlightNet = 0;
let inFlightChrome = 0;
let watch: ReturnType<typeof setInterval> | null = null;
const starveHooks: Array<() => void> = [];

export function cpuIdle(): number {
  const now = Date.now();
  if (now - prevAt < SAMPLE_MS) return cached;
  const next = snap();
  cached = idleBetween(prev, next);
  prev = next;
  prevAt = now;
  return cached;
}

export async function measureIdle(): Promise<number> {
  prev = snap();
  prevAt = 0;
  await new Promise((r) => setTimeout(r, 400));
  return cpuIdle();
}

function cap(kind: "net" | "chrome"): number {
  const idle = cpuIdle();
  if (idle < MIN_IDLE) return 0;
  if (kind === "chrome") return idle >= 20 ? 1 : 0;
  if (idle < 20) return 1;
  if (idle < 35) return 2;
  if (idle < 50) return 4;
  return MAX_NET;
}

/** How many worker promises to start. In-flight work is still gated by withCpuBudget. */
export function spawnWorkers(requested: number): number {
  const n = Math.max(1, requested);
  if (!isLaptop()) return n;
  return Math.min(n, MAX_NET);
}

function reapHeadless(): void {
  try {
    execFileSync("pkill", ["-9", "-f", "chrome-headless-shell"], { stdio: "ignore" });
  } catch {
    /* none */
  }
  try {
    execFileSync("pkill", ["-9", "-f", "outset-render-"], { stdio: "ignore" });
  } catch {
    /* none */
  }
}

function tickWatch(): void {
  if (!isLaptop()) return;
  const idle = cpuIdle();
  if (idle < REAP_IDLE) {
    if (!lowSince) lowSince = Date.now();
    if (Date.now() - lowSince >= 1500) {
      lowSince = Date.now();
      console.error(`CPU idle ${idle.toFixed(0)}%. Dropping headless Chrome so Cursor can run.`);
      reapHeadless();
      for (const fn of starveHooks) {
        try {
          fn();
        } catch {
          /* hook failed */
        }
      }
    }
  } else {
    lowSince = 0;
  }
}

export function onCpuStarve(fn: () => void): void {
  starveHooks.push(fn);
  startIdleWatch();
}

export function startIdleWatch(): void {
  if (!isLaptop() || watch) return;
  watch = setInterval(tickWatch, 750);
  watch.unref();
}

export async function withCpuBudget<T>(fn: () => Promise<T>, kind: "net" | "chrome" = "net"): Promise<T> {
  if (!isLaptop()) return fn();
  startIdleWatch();
  for (;;) {
    const idle = cpuIdle();
    const max = cap(kind);
    const used = kind === "chrome" ? inFlightChrome : inFlightNet;
    if (max > 0 && used < max) break;
    if (Date.now() - lastLog > 8000) {
      lastLog = Date.now();
      console.error(`CPU idle ${idle.toFixed(0)}% (floor ${MIN_IDLE}%). Waiting so Cursor stays usable.`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (kind === "chrome") inFlightChrome += 1;
  else inFlightNet += 1;
  try {
    return await fn();
  } finally {
    if (kind === "chrome") inFlightChrome -= 1;
    else inFlightNet -= 1;
  }
}

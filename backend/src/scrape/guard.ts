import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Catalog crawls belong on Render. On this Mac they may run only one at a time, and
 * backend/src/scrape/cpu.ts keeps at least 10% CPU idle so Cursor stays usable.
 * All-state discover and the overnight pipeline still refuse to start here.
 */

const LOCK = "/tmp/outset-crawl.lock";

export function isLaptop(): boolean {
  if (process.env.RENDER || process.env.OUTSET_PIPELINE) return false;
  return process.platform === "darwin";
}

export function crawlOverride(): boolean {
  return process.env.OUTSET_ALLOW_CRAWL === "1";
}

function pidAlive(pid: number): boolean {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockOwner(): { pid: number; line: string } | null {
  try {
    const line = readFileSync(LOCK, "utf8").trim();
    const pid = Number(line.split(/\s+/)[0]);
    if (pidAlive(pid)) return { pid, line };
    unlinkSync(LOCK);
  } catch {
    /* missing or stale */
  }
  return null;
}

function takeLock(name: string): void {
  const held = lockOwner();
  if (held) {
    console.error(`A crawl is already running on this Mac (pid ${held.pid}: ${held.line}). One at a time. Wait, or: kill ${held.pid} && npm run chrome:reap`);
    process.exit(1);
  }
  try {
    const fd = openSync(LOCK, "wx");
    writeFileSync(fd, `${process.pid} ${name} ${new Date().toISOString()}\n`);
    closeSync(fd);
  } catch {
    const again = lockOwner();
    if (again) {
      console.error(`A crawl is already running on this Mac (pid ${again.pid}: ${again.line}). One at a time.`);
      process.exit(1);
    }
    if (existsSync(LOCK)) unlinkSync(LOCK);
    const fd = openSync(LOCK, "wx");
    writeFileSync(fd, `${process.pid} ${name} ${new Date().toISOString()}\n`);
    closeSync(fd);
  }
  const drop = (): void => {
    try {
      const line = readFileSync(LOCK, "utf8");
      if (line.startsWith(String(process.pid) + " ")) unlinkSync(LOCK);
    } catch {
      /* already gone */
    }
  };
  process.on("exit", drop);
}

export function guardLaptopJob(opts: {
  name: string;
  limit?: number;
  concurrency?: number;
  /** Whole-catalog or overnight job (all-state discover). Still blocked on this Mac. */
  bulk?: boolean;
}): void {
  if (!isLaptop()) return;
  if (opts.bulk && !crawlOverride()) {
    console.error(
      [
        `Blocked ${opts.name} on this Mac.`,
        `All-state discover and the overnight pipeline run on Render, not the laptop.`,
        `A human override is OUTSET_ALLOW_CRAWL=1. Do not set that from an agent.`,
      ].join("\n"),
    );
    process.exit(1);
  }
  takeLock(opts.name);
  console.error("Laptop crawl: one job, CPU idle floor 10%. Workers pause instead of freezing Cursor.");
}

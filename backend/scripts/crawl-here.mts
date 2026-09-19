import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/db/client.ts";

/**
 * The whole enrichment sweep, on this machine, for as long as you leave it running.
 *
 * There is no crawler in the cloud, and photos and prices exist nowhere but on the operators' own websites, so
 * this is the free way to get them. It is safe to run while you work: `guardLaptopJob` keeps 10% of the CPU
 * idle, caps the crawl at six workers and pauses them when the laptop is busy, and every page is fetched once
 * and shared between the three passes.
 *
 *   npm run crawl:here              until you stop it with Ctrl-C
 *   npm run crawl:here -- --hours=3 stop after three hours
 *   npm run crawl:here -- --batch=500  smaller rounds, if you want to stop sooner
 *
 * Each round takes a slice of the never-read sites, best city and best reviewed first, and runs the three
 * passes over it back to back so the second and third read pages the first already fetched. Progress is in the
 * database as it goes: stopping halfway loses nothing, and starting again picks up where it left off.
 */

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k: string, dflt: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] || dflt);
const HOURS = arg("hours", 0);
const BATCH = arg("batch", 1500);
const deadline = HOURS > 0 ? Date.now() + HOURS * 3600_000 : Infinity;

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log("\nStopping after this pass. Everything read so far is saved. Ctrl-C again to stop now.");
});

function run(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", ...args], { cwd: join(here, ".."), stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    process.on("SIGINT", () => child.kill("SIGINT"));
  });
}

const count = (sql: string) => Number((db.prepare(sql).get() as { c: number }).c);
const LEFT = `SELECT COUNT(*) AS c FROM operators o
  WHERE o.website IS NOT NULL AND o.website != '' AND o.origin != 'demo'
    AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure')`;

const started = Date.now();
const at0 = count(LEFT);
console.log(`${at0.toLocaleString()} sites have never been read. Rounds of ${BATCH}. Ctrl-C stops cleanly.\n`);

for (let round = 1; !stopping && Date.now() < deadline; round++) {
  const before = count(LEFT);
  if (before === 0) {
    console.log("Every site has been read. Nothing left to crawl.");
    break;
  }
  console.log(`--- round ${round}: ${before.toLocaleString()} sites left ---`);
  // Photos first: a listing without one looks like nothing on a rail. Then the menu and the hours, which read
  // the pages the photo pass has already put in the shared cache.
  await run(["src/index.ts", "photos", String(BATCH), "4"]);
  if (stopping || Date.now() >= deadline) break;
  await run(["src/index.ts", "structure", String(BATCH), "6"]);
  if (stopping || Date.now() >= deadline) break;
  await run(["scripts/hours-crawl.mts", String(BATCH), "6"]);

  const after = count(LEFT);
  const mins = (Date.now() - started) / 60000;
  const done = at0 - after;
  const rate = done / Math.max(mins, 0.1);
  console.log(
    `\n${done.toLocaleString()} sites read in ${mins.toFixed(0)} min (${rate.toFixed(0)}/min). ` +
      `${after.toLocaleString()} left, about ${(after / Math.max(rate, 1) / 60).toFixed(1)} hours at this rate.\n`,
  );
}

console.log('Stopped. Run "npm run sync" to publish what was read, then push.');
process.exit(0);

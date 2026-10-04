import "../src/env.ts";
import { crawlOverride, guardLaptopJob, isLaptop } from "../src/scrape/guard.ts";

/**
 * Points each not-yet-mailed business in the cloud sender's pool (outreach_pool in Postgres) at its owner: reads
 * the business's own website (home, About, Team, Our Story, Contact) and, when the site names the owner's mailbox,
 * the pitch goes there instead of info@ or bookings@, opening "Hi Jeff," when the site says Jeff owns the place and
 * the mailbox is his. The rules are src/outreach/ownersPool.ts; this is the command.
 *
 *   npx tsx scripts/owners-pool.mts --family=indoor --limit=2000          # escape rooms first, then the rest of indoor
 *   npx tsx scripts/owners-pool.mts --family=indoor --limit=50 --dry      # what would change, nothing written
 *   npx tsx scripts/owners-pool.mts --family=all --limit=5000             # every family, in send order
 *
 * Options: --family (default indoor; "all" for every family), --limit (default 2000), --concurrency (sites read at
 * once, default 8), --dry. Every row read is marked owners_checked_at, found or not, so the next run moves on.
 *
 * It fetches business websites, so it runs on Render as a one-off job on the outset-otto cron service, which has
 * DATABASE_URL and this code and no SQLite catalog (none is needed). It refuses to start on the Mac.
 */
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith("--" + name + "="))?.slice(name.length + 3);
const family = (arg("family") || "indoor").trim().toLowerCase();
const limit = Number(arg("limit") || 2000);
const concurrency = Number(arg("concurrency") || 8);
const dry = process.argv.includes("--dry");
if (!family || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  console.error("usage: npx tsx scripts/owners-pool.mts [--family=indoor|all|...] [--limit=2000] [--concurrency=8] [--dry]");
  process.exit(1);
}
if (isLaptop() && !crawlOverride()) {
  console.error("owners-pool reads business websites, so it runs on Render (a one-off job on outset-otto), not on this Mac.");
  process.exit(1);
}
guardLaptopJob({ name: "owners-pool", limit, concurrency });
if (!(process.env.DATABASE_URL || "").trim()) {
  console.error("owners-pool: DATABASE_URL is not set; the pool lives in Postgres");
  process.exit(1);
}
// The page cache is for crawls that come back to a site. This reads each site once, on a disk the job throws away.
process.env.OUTSET_PAGE_CACHE ||= "0";

const { FAMILY_ORDER } = await import("../src/outreach/touches.ts");
const { runOwnersPool } = await import("../src/outreach/ownersPool.ts");
const { closePg } = await import("../src/db/pg.ts");
if (family !== "all" && !FAMILY_ORDER.includes(family)) console.error(`owners-pool: "${family}" is not one of ${FAMILY_ORDER.join(", ")}; reading it anyway`);

console.log(`owners-pool: family ${family}, up to ${limit} rows, ${concurrency} sites at a time${dry ? ", dry run (nothing written)" : ""}`);
const s = await runOwnersPool({ family, limit, concurrency, dry });
console.log(
  [
    `owners-pool: ${s.family}${s.dry ? ", dry run, nothing written" : ""}`,
    `  rows checked: ${s.checked} of ${s.selected} selected`,
    `  owner mailboxes found: ${s.mailboxes} (pitch moves off the desk inbox)`,
    `  names found: ${s.namesOnSite} sites name an owner; ${s.greetNewMailbox + s.greetSameMailbox} rows now open with the first name (${s.greetNewMailbox} with the new mailbox, ${s.greetSameMailbox} for the mailbox already on file)`,
    `  sites that failed to load: ${s.failed}`,
    `  not read, website is a social or marketplace page: ${s.skipped}`,
    ...(s.raced ? [`  changed by a pool sync while being read, left as the sync wrote them: ${s.raced}`] : []),
    ...(s.writeErrors ? [`  write errors (not marked, read again next run): ${s.writeErrors}`] : []),
  ].join("\n"),
);
await closePg().catch(() => undefined);
process.exit(s.writeErrors ? 1 : 0);

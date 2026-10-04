import { contactEmail } from "../../../src/lib/email.ts";
import { query } from "../db/pg.ts";
import { ownersForSite, type OwnerFound, type OwnersSiteResult, type SitePage } from "../enrich/ownerSite.ts";
import { spawnWorkers } from "../scrape/cpu.ts";
import { sleep, withDeadline } from "../scrape/fetch.ts";
import { outreachAddress, ownerFirstName } from "./address.ts";
import { DESK_INBOX, FAMILY_ORDER, OWNER_COLUMNS_DDL, POOL_ORDER, POOL_UNTOUCHED, type PoolRow } from "./touches.ts";

/**
 * The owners lookup for the cloud sender's pool (scripts/owners-pool.mts, a one-off job on Render's outset-otto).
 *
 * Harshil, 25 September 2026: write to the owner or the manager, the person who decides, not to info@ or bookings@
 * whenever the business's own site gives a better door. The laptop's owners crawl (src/enrich/owners.ts) was meant
 * to find those people, but on 3 October 2026 the pool the cloud sends from (outreach_pool) had greet empty on all
 * 161,368 rows and about half the sends went to a desk inbox.
 *
 * So this reads each not-yet-mailed business's own site the way the owners crawl does (ownerSite.ts: the home page
 * plus About, Team, Our Story and Contact, five pages at most, robots.txt honoured) and decides with the rules the
 * drafts already use and nothing else: address.ts ranks every mailbox the site lists against the front desk (the
 * owner's mailbox at their domain, then a personal mailbox the site gives, then a desk), and ownerFirstName opens
 * with "Hi Jeff," only when the site names Jeff as owner and the mailbox is his. Nothing is guessed. When the site
 * gives nothing better, the row stays as it is and is only marked as read, so the next run moves on.
 *
 * Postgres only: the job runs where there is no SQLite catalog.
 */

/** A query against Postgres. The job uses pg.ts; tests pass their own. */
export type Q = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * The next rows to read: the cloud sender's own queue (poolCandidates in touches.ts, same untouched rows, same send
 * order, escape rooms first inside indoor), cut to one family ("all" for every family), rows with a website only,
 * and, once the columns exist, only rows this lookup has not read yet.
 */
export function ownersQueue(family: string, limit: number, skipChecked = true, kind = "otto"): { text: string; params: unknown[] } {
  const params: unknown[] = [limit, kind, FAMILY_ORDER, DESK_INBOX];
  let familyCut = "";
  if (family !== "all") {
    params.push(family);
    familyCut = "and p.family = $5";
  }
  const text = `select p.* from outreach_pool p
      where ${POOL_UNTOUCHED}
        ${familyCut}
        ${skipChecked ? "and p.owners_checked_at is null" : ""}
        and coalesce(p.website, '') <> ''
      order by ${POOL_ORDER}
      limit $1`;
  return { text, params };
}

/**
 * Hosts that are never a business's own site: social networks and maps (login walls, and their terms forbid
 * reading them), review sites, marketplaces and booking widgets (somebody else's pages about the business).
 */
const NOT_THEIR_SITE = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com|youtu\.be|linkedin\.com|pinterest\.[a-z.]+|linktr\.ee|bit\.ly|goo\.gl|g\.page|google\.[a-z.]+|yelp\.[a-z.]+|tripadvisor\.[a-z.]+|booking\.com|viator\.com|getyourguide\.[a-z.]+|airbnb\.[a-z.]+|expedia\.[a-z.]+|groupon\.[a-z.]+|eventbrite\.[a-z.]+|fishingbooker\.com|captainexperiences\.com|coursehorse\.com|cozymeal\.com|classpass\.com|mindbodyonline\.com|fareharbor\.com|peek\.com|bookeo\.com|resova\.[a-z.]+|xola\.com|checkfront\.com|rezdy\.com|squareup\.com)$/i;

/** The address of the business's own site, or null when the row has none to read. A bare "theirshop.com" reads as https. */
export function siteToRead(website: string | null | undefined): string | null {
  const raw = (website || "").trim();
  if (!raw || /^mailto:/i.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch {
    return null;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".")) return null;
  // Google Sites is a business's own site on Google's host, unlike Maps or a g.page link.
  if (host !== "sites.google.com" && NOT_THEIR_SITE.test(host)) return null;
  return u.href;
}

/**
 * A site that did not load for a reason that passes: the host throttled us (429) or answered with a challenge,
 * a 5xx, a timeout or a dropped connection. On 4 October 2026 that was one escape room site in eight on the first
 * pass, many of them on the same website builder's hosts. Read again at the end of the run, slower, and left
 * unmarked if it still fails, so the next run tries again. A site that is gone (no DNS, a 404, robots.txt says
 * no) is marked like any other.
 */
export function retryable(res: OwnersSiteResult | null): boolean {
  if (!res) return true;
  if (res.blocked) return true;
  const why = res.why || "";
  return /^HTTP (429|5\d\d)$/.test(why) || /deadline|timed? ?out|ETIMEDOUT|ECONNRESET|EPIPE|socket|other side closed|UND_ERR|no answer/i.test(why);
}

export type OwnerDecision =
  /** A better mailbox than the one on file: the owner's at the business's domain, or a personal one the site gives. */
  | { change: "mailbox"; email: string; greet: string | null; source: string }
  /** The same mailbox, now known by the site's own word to be the owner's: "Hi Jeff," where it was "Hi,". */
  | { change: "name"; greet: string; source: string };

/** "Jeff Rogers (owner)", the way the owners crawl files a name and the way ownerFirstName reads one. */
const label = (f: OwnerFound): string => (f.name || "") + (f.title ? " (" + f.title + ")" : "");
/** An address as address.ts compares it. */
const norm = (e: string): string => (contactEmail(e) || "").toLowerCase();

/**
 * What the site changes for this row, by the existing rules only, or null for nothing. The mailbox address.ts
 * ranks first wins when it beats the one on file (ties keep the one on file, so one desk never displaces another);
 * the greeting is ownerFirstName's for whichever mailbox the row ends up with.
 */
export function decideOwner(row: Pick<PoolRow, "email" | "domain" | "greet">, found: OwnerFound[]): OwnerDecision | null {
  const named = found.filter((f) => f.name);
  const names = named.map(label);
  const op = { email: row.email, domain: row.domain };
  const before = outreachAddress(op);
  const best = outreachAddress(op, found.flatMap((f) => (f.email ? [f.email] : [])));
  if (best && best !== before) {
    const source = found.find((f) => f.email && norm(f.email) === best)?.url;
    if (source) return { change: "mailbox", email: best, greet: ownerFirstName(best, names), source };
  }
  if (before && !(row.greet || "").trim()) {
    const greet = ownerFirstName(before, names);
    const source = greet ? named.find((f) => ownerFirstName(before, [label(f)]) === greet)?.url : undefined;
    if (greet && source) return { change: "name", greet, source };
  }
  return null;
}

/**
 * One row's write: the change if there is one, and the mark that this row's site has been read either way. Each
 * change is made only against the address the decision was made on; when a pool sync moved the row meanwhile,
 * the row is left as the sync wrote it and only marked.
 */
async function writeRow(q: Q, row: PoolRow, d: OwnerDecision | null): Promise<"written" | "raced"> {
  if (d?.change === "mailbox") {
    const r = await q(
      `update outreach_pool set desk_email = coalesce(nullif(desk_email, ''), email), email = $2, greet = $3, owner_source = $4, owners_checked_at = now()
        where operator_id = $1 and email = $5 returning operator_id`,
      [row.operator_id, d.email, d.greet, d.source, row.email],
    );
    if (r.length) return "written";
  } else if (d?.change === "name") {
    const r = await q(
      `update outreach_pool set greet = $2, owner_source = $3, owners_checked_at = now()
        where operator_id = $1 and email = $4 and coalesce(greet, '') = '' returning operator_id`,
      [row.operator_id, d.greet, d.source, row.email],
    );
    if (r.length) return "written";
  }
  await q("update outreach_pool set owners_checked_at = now() where operator_id = $1", [row.operator_id]);
  return d ? "raced" : "written";
}

export type OwnersPoolOptions = {
  family: string;
  limit: number;
  concurrency: number;
  /** Print what would change, write nothing (not even the columns). */
  dry: boolean;
  q?: Q;
  /** How a page is read. Default: the shared crawler fetch (robots.txt, the From header). Tests pass saved pages. */
  fetchPage?: (url: string) => Promise<SitePage>;
  log?: (line: string) => void;
  /** Deadline for one page (default 20 s, robots.txt included, as the laptop's owners crawl), for one whole site (90 s), and the pause between two pages of a site (200 ms). */
  pageMs?: number;
  siteMs?: number;
  gapMs?: number;
  /** Before the slow second pass over throttled sites: a wait (default 30 s), then a pause between pages (1.5 s), two sites at a time. */
  retryWaitMs?: number;
  retryGapMs?: number;
};

export type OwnersPoolSummary = {
  family: string;
  dry: boolean;
  /** Rows the queue gave. */
  selected: number;
  /** Rows done: site read or found unreadable, and outside a dry run marked owners_checked_at. */
  checked: number;
  /** Rows whose pitch moved off the desk inbox to the owner's or a person's mailbox. */
  mailboxes: number;
  /** Rows whose site names an owner (a name next to an owner word), whether or not a greeting could follow. */
  namesOnSite: number;
  /** Rows that now open with the owner's first name: with the new mailbox, or for the mailbox already on file. */
  greetNewMailbox: number;
  greetSameMailbox: number;
  /** Sites that did not load: unreachable, an error status, robots.txt said no, a challenge page, or past the deadline. */
  failed: number;
  /** Rows whose site was throttled or timed out on the first pass and was read again at the end, slower. */
  retried: number;
  /** Of the failed, those that were throttled or timed out twice: left unmarked, so the next run reads them again. */
  leftForNextRun: number;
  /** Rows whose website is a social, review or marketplace page rather than their own site: not read, marked. */
  skipped: number;
  /** Rows a pool sync changed between the read and the write: left as the sync wrote them, marked. */
  raced: number;
  /** Writes that failed. Those rows are not marked, so the next run reads them again. */
  writeErrors: number;
};

export async function runOwnersPool(o: OwnersPoolOptions): Promise<OwnersPoolSummary> {
  const q: Q = o.q || query;
  const log = o.log || ((line: string) => console.log(line));
  const gapMs = o.gapMs ?? 200;
  const sum: OwnersPoolSummary = {
    family: o.family, dry: o.dry, selected: 0, checked: 0, mailboxes: 0, namesOnSite: 0, greetNewMailbox: 0, greetSameMailbox: 0,
    failed: 0, retried: 0, leftForNextRun: 0, skipped: 0, raced: 0, writeErrors: 0,
  };
  let skipChecked = true;
  if (o.dry) {
    // Before the first real run the columns do not exist, so there is nothing to skip yet and nothing is added here.
    const cols = await q("select 1 from information_schema.columns where table_name = 'outreach_pool' and column_name = 'owners_checked_at'");
    skipChecked = cols.length > 0;
    if (!skipChecked) log("owners-pool: outreach_pool has no owners columns yet; the first real run adds them");
  } else {
    for (const sql of OWNER_COLUMNS_DDL) await q(sql);
  }
  const queue = ownersQueue(o.family, o.limit, skipChecked);
  const rows = (await q(queue.text, queue.params)) as unknown as PoolRow[];
  sum.selected = rows.length;

  // Two rows on one website (a chain's locations) read it once a pass.
  type Read = { res: OwnersSiteResult | null; err: string };
  const passes = [new Map<string, Promise<Read>>(), new Map<string, Promise<Read>>()];
  const read = (site: string, last: boolean): Promise<Read> => {
    const seen = passes[last ? 1 : 0];
    let p = seen.get(site);
    if (!p) {
      const opts = { fetchPage: o.fetchPage, pageMs: o.pageMs ?? 20_000, gapMs: last ? o.retryGapMs ?? 1500 : gapMs };
      p = withDeadline(ownersForSite(site, opts), o.siteMs ?? 90_000, site).then(
        (res) => ({ res, err: "" }),
        (e: unknown) => ({ res: null, err: ((e as Error)?.message || String(e)).slice(0, 140) }),
      );
      seen.set(site, p);
    }
    return p;
  };

  const later: PoolRow[] = [];
  const one = async (row: PoolRow, last: boolean): Promise<void> => {
    const site = siteToRead(row.website);
    let decision: OwnerDecision | null = null;
    if (!site) sum.skipped++;
    else {
      const { res, err } = await read(site, last);
      if (!res || !res.loaded || res.blocked) {
        const why = !res ? err || "no answer" : res.blocked ? "blocked (" + (res.why || "challenge page") + ")" : res.why || "no page";
        if (retryable(res)) {
          if (!last) {
            later.push(row);
            return;
          }
          sum.failed++;
          sum.leftForNextRun++;
          log(`could not read ${site}: ${why}; left for the next run`);
          return;
        }
        sum.failed++;
        log(`could not read ${site}: ${why}`);
      } else {
        if (res.found.some((f) => f.name && /^[A-Z][a-z]/.test(f.name))) sum.namesOnSite++;
        decision = decideOwner(row, res.found);
      }
    }
    if (!o.dry) {
      try {
        if ((await writeRow(q, row, decision)) === "raced") {
          sum.raced++;
          decision = null;
        }
      } catch (e) {
        sum.writeErrors++;
        log(`owners-pool: could not write ${row.operator_id}: ${(e as Error).message.slice(0, 160)}`);
        return;
      }
    }
    sum.checked++;
    if (!decision) return;
    const verb = o.dry ? "would change" : "changed";
    const who = `${row.name} (${row.domain}, ${row.operator_id})`;
    if (decision.change === "mailbox") {
      sum.mailboxes++;
      if (decision.greet) sum.greetNewMailbox++;
      log(`${verb} ${who}: ${row.email} -> ${decision.email}, ${decision.greet ? "Hi " + decision.greet + "," : "Hi,"} from ${decision.source}`);
    } else {
      sum.greetSameMailbox++;
      log(`${verb} ${who}: ${row.email} stays, Hi ${decision.greet}, from ${decision.source}`);
    }
  };

  let logged = 0;
  const pass = async (list: PoolRow[], concurrency: number, last: boolean): Promise<void> => {
    let next = 0;
    const worker = async (w: number): Promise<void> => {
      await sleep(w * gapMs);
      while (next < list.length) {
        await one(list[next++], last);
        const done = sum.checked + sum.writeErrors;
        if (done - logged >= 100) {
          logged = done;
          log(`owners-pool: ${done}/${rows.length} rows, ${sum.mailboxes} owner mailboxes, ${sum.greetNewMailbox + sum.greetSameMailbox} names, ${sum.failed} sites failed, ${later.length} to read again`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), list.length) }, (_, w) => worker(w)));
  };
  await pass(rows, o.concurrency, false);
  if (later.length) {
    sum.retried = later.length;
    log(`owners-pool: ${later.length} site(s) throttled or timed out; reading them again, two at a time`);
    await sleep(o.retryWaitMs ?? 30_000);
    await pass(later, Math.min(2, o.concurrency), true);
  }
  return sum;
}

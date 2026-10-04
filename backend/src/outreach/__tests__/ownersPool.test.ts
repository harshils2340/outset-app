import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { PoolRow } from "../touches.ts";

/**
 * The owners lookup for the cloud pool (scripts/owners-pool.mts), on saved pages. Nothing here fetches a website or
 * opens Postgres: pages come from fixtures/owners, and the pool is an in-memory SQLite table that runs the job's own
 * update statements and the pool sync's own upsert, whose SQL Postgres and SQLite read alike. The queue query is
 * Postgres-only (array_position, ~*), so the fake answers it from the table instead.
 */

// touches.ts reaches db/client.ts through unsub.ts; keep that off the laptop's real catalog.
process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-owners-pool-")), "catalog.db");
const { decideOwner, ownersQueue, retryable, runOwnersPool, siteToRead } = await import("../ownersPool.ts");
const { challenged, ownersForSite } = await import("../../enrich/ownerSite.ts");
const { DESK_INBOX, FAMILY_ORDER, POOL_COLUMNS, POOL_ORDER, POOL_UNTOUCHED, poolUpsertSql } = await import("../touches.ts");

const FIXTURES = join(import.meta.dirname, "fixtures", "owners");
const SAVED: Record<string, string> = {
  "https://theirshop.com/": "theirshop-home",
  "https://theirshop.com/about": "theirshop-about",
  "https://theirshop.com/contact": "theirshop-contact",
  "https://puzzlevaultrooms.com/": "puzzlevault-home",
  "https://puzzlevaultrooms.com/about-us": "puzzlevault-about",
  "https://puzzlevaultrooms.com/contact-us": "puzzlevault-contact",
  "https://hatchetandhearth.com/": "hatchet-home",
  "https://hatchetandhearth.com/our-story": "hatchet-story",
};

/** The network, stubbed: a saved page for a known address, a 404 for anything else, and a record of what was asked. */
function savedPages() {
  const asked: string[] = [];
  const fetchPage = async (url: string) => {
    asked.push(url);
    const name = SAVED[url];
    return name ? { status: 200, html: readFileSync(join(FIXTURES, name + ".html"), "utf8"), finalUrl: url } : { status: 404, html: "", finalUrl: url };
  };
  return { fetchPage, asked };
}

const base = { phone: "+18135550142", city: "Tampa", region: "FL", calendar_vendor: null, completeness: 0.8, greet: null, family: "indoor" };
const ROWS: PoolRow[] = [
  { ...base, operator_id: "op-theirshop", catalog_id: "o-theirshop-com", domain: "theirshop.com", name: "Their Shop Escape Rooms", website: "https://theirshop.com", email: "info@theirshop.com" },
  { ...base, operator_id: "op-puzzlevault", catalog_id: "o-puzzlevaultrooms-com", domain: "puzzlevaultrooms.com", name: "Puzzle Vault Rooms", website: "https://puzzlevaultrooms.com/", email: "info@puzzlevaultrooms.com", city: "Orlando" },
  { ...base, operator_id: "op-hatchet", catalog_id: "o-hatchetandhearth-com", domain: "hatchetandhearth.com", name: "Hatchet and Hearth", website: "hatchetandhearth.com", email: "hello@hatchetandhearth.com", city: "Austin", region: "TX" },
  { ...base, operator_id: "op-gone", catalog_id: "o-gonerooms-com", domain: "gonerooms.com", name: "Gone Rooms", website: "https://gonerooms.com", email: "info@gonerooms.com" },
  { ...base, operator_id: "op-social", catalog_id: "o-osm-node-1", domain: "osm-node-1", name: "Facebook Only Escapes", website: "https://www.facebook.com/facebookonlyescapes", email: "facebookonlyescapes@gmail.com" },
];

/** outreach_pool with the owners columns, in memory, and a query function shaped like pg.ts `query` over it. */
function pool(rows: PoolRow[], opts: { columns?: boolean } = {}) {
  const db = new DatabaseSync(":memory:");
  db.function("now", () => new Date().toISOString());
  db.exec(`create table outreach_pool (
    operator_id text primary key, catalog_id text not null, domain text not null, name text not null, website text,
    email text not null, phone text, city text, region text, calendar_vendor text, completeness real, greet text, family text,
    synced_at text not null default '2026-10-01T00:00:00.000Z', desk_email text, owners_checked_at text, owner_source text)`);
  const ins = db.prepare(`insert into outreach_pool (${POOL_COLUMNS.join(", ")}) values (${POOL_COLUMNS.map(() => "?").join(", ")})`);
  for (const r of rows) ins.run(...POOL_COLUMNS.map((c) => (r[c] ?? null) as SQLInputValue));
  const sql: string[] = [];
  const q = async (text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => {
    sql.push(text);
    if (/information_schema/.test(text)) return opts.columns === false ? [] : [{ present: 1 }];
    if (/^\s*alter table/i.test(text)) return [];
    if (/^\s*select p\.\* from outreach_pool p/.test(text)) return db.prepare("select * from outreach_pool where owners_checked_at is null order by operator_id").all();
    const stmt = db.prepare(text.replace(/\$(\d+)/g, "?$1"));
    if (/\breturning\b/i.test(text)) return stmt.all(...(params as SQLInputValue[]));
    stmt.run(...(params as SQLInputValue[]));
    return [];
  };
  const row = (id: string) => db.prepare("select * from outreach_pool where operator_id = ?").get(id) as Record<string, unknown>;
  return { db, q, sql, row };
}

test("the owners lookup moves a row to the owner's mailbox only when the business's own site names one", async () => {
  const p = pool(ROWS);
  const { fetchPage, asked } = savedPages();
  const lines: string[] = [];
  const s = await runOwnersPool({ family: "indoor", limit: 50, concurrency: 2, dry: false, q: p.q, fetchPage, log: (l) => lines.push(l), gapMs: 0 });

  // (a) "Jeff Rogers, owner" and jeff@theirshop.com on the About page, linked only from the menu: Jeff's mailbox, "Hi Jeff,".
  const a = p.row("op-theirshop");
  assert.deepEqual([a.email, a.greet, a.desk_email, a.owner_source], ["jeff@theirshop.com", "Jeff", "info@theirshop.com", "https://theirshop.com/about"]);
  assert.ok(a.owners_checked_at);

  // (b) Only info@ and bookings@. A co-owner is named, but a desk is nobody's mailbox: nothing changes, no name is used.
  const b = p.row("op-puzzlevault");
  assert.deepEqual([b.email, b.greet, b.desk_email, b.owner_source], ["info@puzzlevaultrooms.com", null, null, null]);
  assert.ok(b.owners_checked_at, "read and marked, so a rerun skips it");

  // (c) The owner's personal gmail, named on the site: address.ts ranks a person's mailbox over a desk, and it is Maria's.
  const c = p.row("op-hatchet");
  assert.deepEqual([c.email, c.greet, c.desk_email, c.owner_source], ["maria.lopez@gmail.com", "Maria", "hello@hatchetandhearth.com", "https://hatchetandhearth.com/our-story"]);

  // A site that does not load and a Facebook page: both marked, neither changed, the Facebook page never fetched.
  assert.deepEqual([p.row("op-gone").email, p.row("op-gone").owner_source], ["info@gonerooms.com", null]);
  assert.ok(p.row("op-gone").owners_checked_at);
  assert.equal(p.row("op-social").email, "facebookonlyescapes@gmail.com");
  assert.ok(p.row("op-social").owners_checked_at);
  assert.ok(!asked.some((u) => u.includes("facebook.com")), "a social page is never read");

  // The home page, then the pages it links that can name an owner. Not the booking subdomain, not the PDF.
  assert.deepEqual(asked.filter((u) => u.includes("theirshop.com")), ["https://theirshop.com/", "https://theirshop.com/about", "https://theirshop.com/contact"]);

  const { selected, checked, mailboxes, namesOnSite, greetNewMailbox, greetSameMailbox, failed, skipped, raced, writeErrors } = s;
  assert.deepEqual(
    { selected, checked, mailboxes, namesOnSite, greetNewMailbox, greetSameMailbox, failed, skipped, raced, writeErrors },
    { selected: 5, checked: 5, mailboxes: 2, namesOnSite: 3, greetNewMailbox: 2, greetSameMailbox: 0, failed: 1, skipped: 1, raced: 0, writeErrors: 0 },
  );
  assert.ok(lines.includes("changed Their Shop Escape Rooms (theirshop.com, op-theirshop): info@theirshop.com -> jeff@theirshop.com, Hi Jeff, from https://theirshop.com/about"));

  // Every row was marked, so the next run has nothing left to read.
  const again = await runOwnersPool({ family: "indoor", limit: 50, concurrency: 2, dry: false, q: p.q, fetchPage, log: () => {}, gapMs: 0 });
  assert.equal(again.selected, 0);
});

test("a dry run prints one line per change and writes nothing, not even the columns", async () => {
  const p = pool(ROWS.slice(0, 3), { columns: false });
  const before = ROWS.slice(0, 3).map((r) => p.row(r.operator_id));
  const { fetchPage } = savedPages();
  const lines: string[] = [];
  const s = await runOwnersPool({ family: "indoor", limit: 10, concurrency: 1, dry: true, q: p.q, fetchPage, log: (l) => lines.push(l), gapMs: 0 });
  assert.deepEqual(ROWS.slice(0, 3).map((r) => p.row(r.operator_id)), before);
  assert.deepEqual(p.sql.filter((t) => /^\s*(update|alter|insert|delete|create)\b/i.test(t)), [], "no write of any kind");
  assert.ok(!p.sql.some((t) => /owners_checked_at is null/.test(t)), "before the first real run there is no column to skip on");
  assert.deepEqual(lines.filter((l) => l.startsWith("would change")).sort(), [
    "would change Hatchet and Hearth (hatchetandhearth.com, op-hatchet): hello@hatchetandhearth.com -> maria.lopez@gmail.com, Hi Maria, from https://hatchetandhearth.com/our-story",
    "would change Their Shop Escape Rooms (theirshop.com, op-theirshop): info@theirshop.com -> jeff@theirshop.com, Hi Jeff, from https://theirshop.com/about",
  ]);
  assert.equal(s.mailboxes, 2);
});

test("the decision is address.ts and ownerFirstName, nothing new", () => {
  const row = { email: "hello@hatchetandhearth.com", domain: "hatchetandhearth.com", greet: null };
  const story = "https://hatchetandhearth.com/our-story";
  const contact = "https://hatchetandhearth.com/contact";
  const maria = { name: "Maria Lopez", title: "owner", url: story };
  assert.deepEqual(
    decideOwner(row, [{ ...maria, email: "maria.lopez@gmail.com" }, { email: "maria@hatchetandhearth.com", url: contact }]),
    { change: "mailbox", email: "maria@hatchetandhearth.com", greet: "Maria", source: contact },
    "the owner's mailbox at the business's own domain beats her gmail",
  );
  assert.equal(decideOwner(row, [{ email: "hatchetevents@gmail.com", url: story }]), null, "a gmail with a desk word in it is another desk, and ties keep the one on file");
  assert.deepEqual(
    decideOwner(row, [maria, { email: "tom@hatchetandhearth.com", url: contact }]),
    { change: "mailbox", email: "tom@hatchetandhearth.com", greet: null, source: contact },
    "a person's mailbox at the domain beats a desk, but the site never said Tom owns it, so no name",
  );
  assert.equal(decideOwner(row, [maria]), null, "an owner's name with only a desk to write to changes nothing");
  assert.equal(decideOwner(row, []), null);
  const hers = { ...row, email: "maria@hatchetandhearth.com" };
  assert.deepEqual(decideOwner(hers, [maria]), { change: "name", greet: "Maria", source: story }, "the mailbox on file is hers by the site's word: the name, and nothing else");
  assert.equal(decideOwner({ ...hers, greet: "Maria" }, [maria]), null, "a greeting already set is left alone");
});

test("only the business's own site is read", () => {
  assert.equal(siteToRead("theirshop.com"), "https://theirshop.com/");
  assert.equal(siteToRead(" https://www.theirshop.com/tampa "), "https://www.theirshop.com/tampa");
  assert.equal(siteToRead("https://tampabox.com"), "https://tampabox.com/", "a host that ends in x.com is not x.com");
  assert.equal(siteToRead("https://sites.google.com/view/theirshop"), "https://sites.google.com/view/theirshop");
  for (const w of [
    "https://www.facebook.com/theirshop", "https://m.facebook.com/theirshop", "http://instagram.com/theirshop", "https://x.com/theirshop",
    "https://www.yelp.com/biz/their-shop-tampa", "https://www.tripadvisor.co.uk/Attraction_Review", "https://fareharbor.com/embeds/book/theirshop/",
    "https://maps.google.com/?cid=1", "https://linktr.ee/theirshop", "mailto:info@theirshop.com", "ftp://theirshop.com", "not a site", "", null,
  ]) assert.equal(siteToRead(w), null, String(w));
});

test("the queue is the sender's own: the same untouched rows in the same send order, one family, unread rows only", () => {
  const { text, params } = ownersQueue("indoor", 2000);
  assert.ok(text.includes(POOL_UNTOUCHED) && text.includes(POOL_ORDER));
  assert.match(text, /and p\.family = \$5/);
  assert.match(text, /and p\.owners_checked_at is null/);
  assert.deepEqual(params, [2000, "otto", FAMILY_ORDER, DESK_INBOX, "indoor"]);
  const every = ownersQueue("all", 10, false);
  assert.doesNotMatch(every.text, /p\.family = \$5|owners_checked_at/);
  assert.equal(every.params.length, 4);
});

test("a site is read from its menu as well, five pages at most", async () => {
  const menu = ["about", "team", "our-story", "meet-the-crew", "contact", "staff"].map((s) => `<a href="/${s}">${s}</a>`).join(" ");
  const asked: string[] = [];
  const res = await ownersForSite("https://manylinks.com/", {
    gapMs: 0,
    fetchPage: async (url) => {
      asked.push(url);
      const html = url === "https://manylinks.com/" ? `<html><body><nav>${menu}</nav><p>Welcome</p></body></html>` : "<html><body><p>Nothing here</p></body></html>";
      return { status: 200, html, finalUrl: url };
    },
  });
  assert.deepEqual([res.loaded, res.blocked, res.pages], [true, false, 5]);
  assert.deepEqual(asked, ["https://manylinks.com/", "https://manylinks.com/about", "https://manylinks.com/team", "https://manylinks.com/our-story", "https://manylinks.com/meet-the-crew"]);
});

test("(d) a pool sync keeps what the owners lookup found and refreshes everything else", () => {
  const p = pool([]);
  const seed = p.db.prepare(`insert into outreach_pool (${POOL_COLUMNS.join(", ")}, desk_email, owners_checked_at, owner_source)
    values (${POOL_COLUMNS.map(() => "?").join(", ")}, ?, ?, ?)`);
  const checkedAt = "2026-10-03T12:00:00.000Z";
  // Found: the owners lookup moved this row to Jeff.
  seed.run("op-theirshop", "o-theirshop-com", "theirshop.com", "Their Shop Escape Rooms", "https://theirshop.com", "jeff@theirshop.com", "+18135550142", "Tampa", "FL", null, 0.8, "Jeff", "indoor",
    "info@theirshop.com", checkedAt, "https://theirshop.com/about");
  // Read, nothing found: nothing to keep.
  seed.run("op-puzzlevault", "o-puzzlevaultrooms-com", "puzzlevaultrooms.com", "Puzzle Vault Rooms", "https://puzzlevaultrooms.com/", "info@puzzlevaultrooms.com", "+14075550100", "Orlando", "FL", null, 0.7, null, "indoor",
    null, checkedAt, null);
  // Never read.
  seed.run("op-plain", "o-plainrooms-com", "plainrooms.com", "Plain Rooms", "https://plainrooms.com", "hello@plainrooms.com", "+18135550111", "Tampa", "FL", null, 0.5, null, "indoor",
    null, null, null);

  // What the laptop's catalog publishes next: the front desk again for Jeff's shop (no owner facts there), an owner
  // the laptop did find for Puzzle Vault, a new desk address for Plain Rooms, and a business new to the pool.
  const sync = [
    ["op-theirshop", "o-theirshop-com", "theirshop.com", "Their Shop Escape Rooms and Arcade", "https://theirshop.com", "info@theirshop.com", "+18135550199", "Tampa", "FL", "fareharbor", 0.9, null, "indoor"],
    ["op-puzzlevault", "o-puzzlevaultrooms-com", "puzzlevaultrooms.com", "Puzzle Vault Rooms", "https://puzzlevaultrooms.com/", "sarah@puzzlevaultrooms.com", "+14075550100", "Orlando", "FL", null, 0.7, "Sarah", "indoor"],
    ["op-plain", "o-plainrooms-com", "plainrooms.com", "Plain Rooms", "https://plainrooms.com", "info@plainrooms.com", "+18135550111", "Tampa", "FL", null, 0.5, null, "indoor"],
    ["op-new", "o-newrooms-com", "newrooms.com", "New Rooms", "https://newrooms.com", "info@newrooms.com", "+18135550122", "Tampa", "FL", null, 0.4, null, "indoor"],
  ];
  p.db.prepare(poolUpsertSql(sync.length).replace(/\$(\d+)/g, "?$1")).run(...(sync.flat() as SQLInputValue[]));

  const a = p.row("op-theirshop");
  assert.deepEqual([a.email, a.greet, a.desk_email, a.owner_source, a.owners_checked_at], ["jeff@theirshop.com", "Jeff", "info@theirshop.com", "https://theirshop.com/about", checkedAt], "the owner the lookup found stays");
  assert.deepEqual([a.name, a.phone, a.calendar_vendor, a.completeness], ["Their Shop Escape Rooms and Arcade", "+18135550199", "fareharbor", 0.9], "everything else is the catalog's");
  assert.notEqual(a.synced_at, "2026-10-01T00:00:00.000Z", "synced, so the stale-row delete keeps it");

  const b = p.row("op-puzzlevault");
  assert.deepEqual([b.email, b.greet, b.owners_checked_at, b.owner_source], ["sarah@puzzlevaultrooms.com", "Sarah", checkedAt, null], "a site that named nobody keeps nothing; the sync's own owner wins");

  const c = p.row("op-plain");
  assert.deepEqual([c.email, c.greet, c.desk_email, c.owners_checked_at], ["info@plainrooms.com", null, null, null]);

  const d = p.row("op-new");
  assert.deepEqual([d.email, d.owners_checked_at, d.owner_source], ["info@newrooms.com", null, null]);
});

test("a site that lists the manager's inbox beside info@ gets the pitch sent to the manager", async () => {
  const page = `<html><body><nav><a href="/contact">Contact</a></nav><main><h1>Lockbox Escapes</h1></main></body></html>`;
  const contact = `<html><body><p>Bookings and gift cards: <a href="mailto:info@lockboxescapes.com">info@lockboxescapes.com</a></p>
    <p>Corporate events and anything else: <a href="mailto:manager@lockboxescapes.com">manager@lockboxescapes.com</a></p></body></html>`;
  const fetchPage = async (url: string) =>
    url === "https://lockboxescapes.com/" ? { status: 200, html: page, finalUrl: url }
    : url === "https://lockboxescapes.com/contact" ? { status: 200, html: contact, finalUrl: url }
    : { status: 404, html: "", finalUrl: url };
  const site = await ownersForSite("https://lockboxescapes.com/", { fetchPage, gapMs: 0 });
  assert.ok(site.found.some((f) => f.email === "manager@lockboxescapes.com"), "manager@ is read, not filtered out as a desk");
  const d = decideOwner({ email: "info@lockboxescapes.com", domain: "lockboxescapes.com", greet: null }, site.found);
  assert.deepEqual(d, { change: "mailbox", email: "manager@lockboxescapes.com", greet: null, source: "https://lockboxescapes.com/contact" });
});

test("a home page with a reCAPTCHA form or Cloudflare's page script is read, and only a real challenge page is blocked", () => {
  const body = "<p>" + "Four rooms, sixty minutes, one way out. Book a room for your team or your family. ".repeat(30) + "</p>";
  const ordinary = `<html><head><script src="https://www.google.com/recaptcha/api.js"></script></head><body>${body}
    <form><div class="g-recaptcha"></div></form><script>a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'</script></body></html>`;
  assert.equal(challenged({ status: 200, html: ordinary, finalUrl: "https://lockboxescapes.com/" }), false);
  const cloudflare = `<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div>Verifying you are human.</body></html>`;
  assert.equal(challenged({ status: 200, html: cloudflare, finalUrl: "https://lockboxescapes.com/" }), true);
  assert.equal(challenged({ status: 429, html: body, finalUrl: "https://lockboxescapes.com/" }), true);
  assert.equal(challenged({ status: 200, html: body, finalUrl: "https://lockboxescapes.com/rate-limit" }), true);
});

test("a throttled site is read again at the end, slower, and one that stays throttled is left for the next run", async () => {
  const rows: PoolRow[] = [
    { ...base, operator_id: "op-once", catalog_id: "o-oncerooms-com", domain: "oncerooms.com", name: "Once Rooms", website: "https://oncerooms.com/", email: "info@oncerooms.com" },
    { ...base, operator_id: "op-always", catalog_id: "o-alwaysrooms-com", domain: "alwaysrooms.com", name: "Always Rooms", website: "https://alwaysrooms.com/", email: "info@alwaysrooms.com" },
  ];
  const p = pool(rows);
  const asked: string[] = [];
  const fetchPage = async (url: string) => {
    asked.push(url);
    if (url.startsWith("https://alwaysrooms.com")) return { status: 429, html: "Too Many Requests", finalUrl: url };
    if (url === "https://oncerooms.com/") {
      return asked.filter((u) => u === url).length === 1
        ? { status: 429, html: "Too Many Requests", finalUrl: url }
        : { status: 200, html: `<html><body><p>Run by owner Dana Price.</p><a href="mailto:dana@oncerooms.com">Email Dana</a></body></html>`, finalUrl: url };
    }
    return { status: 404, html: "", finalUrl: url };
  };
  const lines: string[] = [];
  const s = await runOwnersPool({ family: "indoor", limit: 10, concurrency: 4, dry: false, q: p.q, fetchPage, log: (l) => lines.push(l), gapMs: 0, retryWaitMs: 0, retryGapMs: 0 });
  assert.deepEqual([p.row("op-once").email, p.row("op-once").greet], ["dana@oncerooms.com", "Dana"], "the second, slower read got through");
  assert.ok(p.row("op-once").owners_checked_at);
  assert.deepEqual([p.row("op-always").email, p.row("op-always").owners_checked_at], ["info@alwaysrooms.com", null], "still throttled: not marked, so the next run reads it");
  assert.deepEqual([s.retried, s.failed, s.leftForNextRun, s.checked, s.mailboxes], [2, 1, 1, 1, 1]);
  assert.ok(lines.includes("could not read https://alwaysrooms.com/: blocked (HTTP 429); left for the next run"));
  const again = await runOwnersPool({ family: "indoor", limit: 10, concurrency: 4, dry: false, q: p.q, fetchPage, log: () => {}, gapMs: 0, retryWaitMs: 0, retryGapMs: 0 });
  assert.equal(again.selected, 1, "only the throttled one is read again");
});

test("a gone site is marked, a throttled or timed-out one is not", () => {
  const r = (why: string, extra: Partial<{ loaded: boolean; blocked: boolean }> = {}) => ({ loaded: false, blocked: false, pages: 0, found: [], why, ...extra });
  for (const why of ["HTTP 429", "HTTP 503", "deadline 20000ms: https://x.com/", "fetch failed: ECONNRESET", "fetch failed: UND_ERR_SOCKET"]) assert.equal(retryable(r(why)), true, why);
  assert.equal(retryable(null), true, "the whole site ran past its deadline");
  assert.equal(retryable(r("", { loaded: true, blocked: true })), true, "a challenge page");
  for (const why of ["dns lookup failed: gonerooms.com", "HTTP 404", "HTTP 410", "robots.txt says no", "empty page"]) assert.equal(retryable(r(why)), false, why);
});

test("a builder page with a captcha script and little text of its own is still read through its menu", async () => {
  const home = `<html><head><script>var cfg={"captcha":{"siteKey":"x"}}</script></head><body><nav><a href="/contact">Contact</a></nav><p>Escape rooms</p></body></html>`;
  const contact = `<html><body><p>Questions: <a href="mailto:manager@builderrooms.com">manager@builderrooms.com</a></p></body></html>`;
  const res = await ownersForSite("https://builderrooms.com/", {
    gapMs: 0,
    fetchPage: async (url) => ({ status: 200, html: url.endsWith("/contact") ? contact : home, finalUrl: url }),
  });
  assert.deepEqual([res.loaded, res.blocked, res.pages], [true, false, 2]);
  assert.ok(res.found.some((f) => f.email === "manager@builderrooms.com"));
});

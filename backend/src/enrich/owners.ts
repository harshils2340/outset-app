import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { db, nowIso } from "../db/client.ts";
import { fetchHtml, sleep, withDeadline } from "../scrape/fetch.ts";

/**
 * Owner-level contacts. Small operators put the owner on the About page: "Captain Mike, owner",
 * "Founded by Sarah and Tom", a personal email like mike@..., a cell number "call or text Mike".
 * This reads the home page plus About, Team, Our Story and Contact pages and keeps what it finds
 * as facts (owner_name, owner_title, owner_email, owner_phone), each with the page it came from.
 * Nothing is invented: a name is stored only when it sits next to an owner word on the operator's own site.
 */

const TITLE = /\b(owner|owners|co-?owner|founder|co-?founder|proprietor|owner[- ]operator|captain|head chef|chef[- ]owner|master instructor|chief pilot|managing director|president|principal|general manager)\b/i;
const NAME = /\b([A-Z][a-z]{1,15}(?:\s+[A-Z][a-z]{1,15}){0,2})\b/g;
const NOT_NAME = /^(About|Our|The|Meet|Contact|Welcome|Hello|Hi|Team|Staff|Family|Owner|Founder|Captain|Chef|We|Us|Book|Now|Call|Text|Email|Read|More|Home|Us|Since|Est|Company|Inc|LLC|Ltd|Tours|Rentals|Charters|Adventures|Experience|Experiences|Coast|Beach|Lake|Bay|River|Island|Park|North|South|East|West|New|Old|Big|Little|Grand|Blue|Red|Green|Black|White|Gold|Silver|Sun|Sea|Ocean|Mountain|Valley|Spring|Summer|Fall|Winter|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Florida|Texas|California|Ontario|Canada|America|United|States|USA)$/;
const GENERIC_EMAIL = /^(info|contact|contactus|hello|hi|hey|sales|booking|bookings|book|booknow|reservations|reservation|res|office|admin|support|help|team|staff|mail|email|enquiries|enquiry|inquiries|inquiry|customerservice|customer|service|services|guest|guests|guestservices|guestrelations|groups|group|events|event|parties|party|media|press|marketing|jobs|careers|hr|billing|accounts|accounting|noreply|no-reply|donotreply|webmaster|privacy|legal|tickets|ticketing|tours|tour|charters|charter|cruises|cruise|rentals|rental|rent|fish|fishing|dive|diving|fly|flying|ride|rides|jump|jumps|sail|sailing|kayak|kayaks|boat|boats|school|lessons|classes|class|studio|shop|store|orders|order|frontdesk|reception|welcome|manager|management|gm|general|questions|feedback|newsletter|subscribe|weddings|wedding|catering|dispatch|crew|captain|captains|pilot|pilots|instructor|instructors|guides|guide|office|hq|main|home|web|website|online|us|ca|usa|canada|toronto|tampa|miami|orlando|vegas|nyc|la|sf|chicago|denver|austin|seattle|boston|atlanta|dallas|houston|phoenix|sandiego|portland|nashville)@/i;
const MOBILE_HINT = /\b(cell|mobile|text|call or text|text or call|direct|personal)\b/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const PAGE_HINT = /about|team|staff|story|meet|owner|founder|who-we-are|our-crew|crew|guides|instructors|captains|contact/i;

type Found = { name?: string; title?: string; email?: string; phone?: string; url: string };

function textOf(html: string): { text: string; links: string[]; mailto: string[] } {
  const $ = load(html);
  $("script,style,noscript,svg,nav,footer form").remove();
  const links: string[] = [];
  const mailto: string[] = [];
  $("a[href]").each((_, a) => {
    const h = String($(a).attr("href") || "");
    if (h.startsWith("mailto:")) mailto.push(h.slice(7).split("?")[0].trim().toLowerCase());
    else links.push(h);
  });
  return { text: $("body").text().replace(/\s+/g, " "), links, mailto };
}

/**
 * A person is kept only when the sentence says they own the place: "Jeff Rogers, owner", "owner Sarah Lee",
 * "founded by Tom and Ann Baker", "Hi, I'm Mike, owner of ...". Words like "captain" are not enough on a
 * boat site, where every trip has one.
 */
const OWNER_WORD = "(?:owner|owners|co-?owner|founder|co-?founder|founders|proprietor|proprietress|owner[- ]operator|chef[- ]owner|owner[- ]chef|owner[- ]instructor|owner[- ]guide|owner[- ]captain|owner[- ]pilot)";
const PERSON = "([A-Z][a-z]{1,15}(?:\\s+(?:[A-Z]\\.?\\s+)?[A-Z][a-z]{1,15}){1,2})";
const FIRST = "([A-Z][a-z]{2,15})";
const PATTERNS: RegExp[] = [
  new RegExp(PERSON + "\\s*[,(\\-–]\\s*(?:the\\s+|our\\s+)?" + OWNER_WORD + "\\b", "g"),
  new RegExp("\\b" + OWNER_WORD + "s?\\s*[:,]?\\s*(?:is\\s+|are\\s+|and\\s+operator\\s+)?" + PERSON, "g"),
  new RegExp("\\b(?:founded|started|owned(?:\\s+and\\s+operated)?|run|operated|established|created)\\s+by\\s+" + PERSON, "gi"),
  new RegExp("\\b(?:owned(?:\\s+and\\s+operated)?|run|operated)\\s+by\\s+" + FIRST + "\\s+and\\s+" + FIRST, "gi"),
  new RegExp("\\b(?:hi|hello|hey),?\\s+(?:i'?m|my name is)\\s+" + PERSON + "[^.]{0,80}\\b" + OWNER_WORD + "\\b", "gi"),
  new RegExp("\\b(?:hi|hello|hey),?\\s+(?:i'?m|my name is)\\s+" + FIRST + "[^.]{0,60}\\b" + OWNER_WORD + "\\b", "gi"),
];

function namesNearTitles(text: string): { name: string; title: string }[] {
  const out: { name: string; title: string }[] = [];
  const seen = new Set<string>();
  const push = (raw: string, title: string) => {
    const name = raw.replace(/\s+/g, " ").trim();
    const words = name.split(" ");
    if (words.some((w) => NOT_NAME.test(w.replace(/\.$/, "")))) return;
    if (TITLE.test(name)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, title });
  };
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && out.length < 4) {
      const title = (m[0].match(TITLE)?.[0] || "owner").toLowerCase();
      if (m[2] && /^[A-Z][a-z]+$/.test(m[1]) && /^[A-Z][a-z]+$/.test(m[2]) && !/\s/.test(m[1])) {
        push(m[1], title);
        push(m[2], title);
      } else push(m[1], title);
    }
  }
  return out;
}

export async function ownersForOperator(op: { id: string; domain: string; website: string }): Promise<Found[]> {
  const found: Found[] = [];
  const home = await withDeadline(fetchHtml(op.website), 20000, op.domain).catch(() => null);
  if (!home || home.status >= 400 || !home.html) return found;
  const base = new URL(home.finalUrl || op.website);
  const pages: { url: string; html: string }[] = [{ url: home.finalUrl, html: home.html }];
  const first = textOf(home.html);
  const wanted = Array.from(new Set(first.links.filter((h) => PAGE_HINT.test(h) && !/\.(pdf|jpg|png)$/i.test(h)).map((h) => { try { return new URL(h, base).href; } catch { return ""; } }).filter((u) => u && new URL(u).hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")))).slice(0, 4);
  for (const u of wanted) {
    const r = await withDeadline(fetchHtml(u), 20000, u).catch(() => null);
    if (r && r.status < 400 && r.html) pages.push({ url: r.finalUrl || u, html: r.html });
    await sleep(200);
  }
  const domainRe = new RegExp("@" + base.hostname.replace(/^www\./, "").replace(/\./g, "\\.") + "$", "i");
  for (const pg of pages) {
    const { text, mailto } = textOf(pg.html);
    const emailsInText = (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase());
    const emails = Array.from(new Set([...mailto, ...emailsInText])).filter((e) => !GENERIC_EMAIL.test(e) && !/example\.com|sentry|wixpress|godaddy|\.png$|\.jpg$/.test(e));
    // Personal address: first name or first.last at the operator's own domain, or a person's gmail.
    const personal = emails.filter((e) => domainRe.test(e) ? /^[a-z]+(\.[a-z]+)?@/.test(e) : /@(gmail|yahoo|hotmail|outlook|icloud|me)\.com$/.test(e));
    const people = namesNearTitles(text);
    for (const p of people) {
      const firstName = p.name.split(" ")[0].toLowerCase();
      const email = personal.find((e) => e.startsWith(firstName) || e.includes(firstName)) || undefined;
      found.push({ name: p.name, title: p.title, email, url: pg.url });
    }
    for (const e of personal) if (!found.some((f) => f.email === e)) found.push({ email: e, url: pg.url });
    // A mobile number sits next to "cell", "text", or the owner's name.
    let m: RegExpExecArray | null;
    const pre = new RegExp(PHONE.source, "g");
    while ((m = pre.exec(text))) {
      const win = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 30);
      const person = people.find((p) => win.includes(p.name.split(" ")[0]));
      if (MOBILE_HINT.test(win) || person) {
        const phone = m[0].replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
        if (phone.length === 10 && !found.some((f) => f.phone === phone)) found.push({ phone, name: person?.name, title: person?.title, url: pg.url });
      }
    }
  }
  return found.slice(0, 8);
}

export function pendingOwners(limit: number): { id: string; domain: string; website: string }[] {
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o WHERE origin != 'demo' AND website IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'owners')
         AND EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure' AND s.http_status = 200)
       ORDER BY review_count DESC NULLS LAST LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

export async function ownersPending(limit: number, concurrency = 12): Promise<{ sites: number; withOwner: number; names: number; emails: number; phones: number }> {
  const queue = pendingOwners(limit);
  const out = { sites: 0, withOwner: 0, names: 0, emails: 0, phones: 0 };
  const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')");
  const mark = db.prepare("INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'owners', 1, ?)");
  let i = 0;
  const worker = async (w: number) => {
    await sleep(w * 300);
    while (i < queue.length) {
      const op = queue[i++];
      try {
        const found = await withDeadline(ownersForOperator(op), 90000, op.domain);
        out.sites += 1;
        if (found.length) out.withOwner += 1;
        for (const f of found) {
          if (f.name) { ins.run(randomUUID(), op.id, "owner_name", f.name + (f.title ? " (" + f.title + ")" : ""), f.url); out.names += 1; }
          if (f.email) { ins.run(randomUUID(), op.id, "owner_email", f.email, f.url); out.emails += 1; }
          if (f.phone) { ins.run(randomUUID(), op.id, "owner_phone", f.phone + (f.name ? " (" + f.name + ")" : ""), f.url); out.phones += 1; }
        }
        mark.run(randomUUID(), op.id, "owners:" + op.domain, nowIso(), found.length + " contacts");
      } catch (e) {
        out.sites += 1;
        try { mark.run(randomUUID(), op.id, "owners:" + op.domain, nowIso(), "failed " + (e as Error).message.slice(0, 60)); } catch { /* locked */ }
      }
      if (out.sites % 100 === 0) console.log(`${out.sites}/${queue.length} sites, ${out.withOwner} with a contact, ${out.names} names, ${out.emails} emails, ${out.phones} phones`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, (_, w) => worker(w)));
  return out;
}

/** CSV of every owner-level contact, one row per operator, best contact first. */
export function ownersCsv(): string {
  const rows = db
    .prepare(
      `SELECT o.name AS business, o.city, o.region, o.category_id AS category, o.website, o.phone AS front_desk, o.email AS front_email, o.review_count,
              (SELECT group_concat(fact_value, ' | ') FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'owner_name') AS owner,
              (SELECT group_concat(fact_value, ' | ') FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'owner_email') AS owner_email,
              (SELECT group_concat(fact_value, ' | ') FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'owner_phone') AS owner_phone,
              (SELECT source_url FROM facts f WHERE f.operator_id = o.id AND f.fact_key IN ('owner_name','owner_email','owner_phone') LIMIT 1) AS source
       FROM operators o
       WHERE EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key IN ('owner_name','owner_email','owner_phone'))
       ORDER BY (owner_phone IS NULL), (owner_email IS NULL), o.review_count DESC NULLS LAST`,
    )
    .all() as Record<string, string | number | null>[];
  const esc = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const cols = ["business", "city", "region", "category", "owner", "owner_email", "owner_phone", "front_desk", "front_email", "website", "review_count", "source"];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

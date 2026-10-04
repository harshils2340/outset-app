import { load } from "cheerio";
import { fetchHtml, looksBlocked, sleep, withDeadline } from "../scrape/fetch.ts";

/**
 * Owner-level contacts. Small operators put the owner on the About page: "Captain Mike, owner",
 * "Founded by Sarah and Tom", a personal email like mike@..., a cell number "call or text Mike".
 * This reads the home page plus About, Team, Our Story and Contact pages and returns what it finds,
 * each with the page it came from. Nothing is invented: a name is kept only when it sits next to an owner word
 * on the operator's own site.
 *
 * The per-site half of the owners crawl, with no database. owners.ts files what this finds into the laptop's
 * SQLite catalog as facts (owner_name, owner_email, owner_phone); scripts/owners-pool.mts, a Render job with no
 * SQLite at all, writes it straight into the cloud sender's pool in Postgres. Both read a site through
 * `ownersForSite`, so the two can never disagree about who runs a business.
 */

const TITLE = /\b(owner|owners|co-?owner|founder|co-?founder|proprietor|owner[- ]operator|captain|head chef|chef[- ]owner|master instructor|chief pilot|managing director|president|principal|general manager)\b/i;
const NOT_NAME = /^(About|Our|The|Meet|Contact|Welcome|Hello|Hi|Team|Staff|Family|Owner|Founder|Captain|Chef|We|Us|Book|Now|Call|Text|Email|Read|More|Home|Us|Since|Est|Company|Inc|LLC|Ltd|Tours|Rentals|Charters|Adventures|Experience|Experiences|Coast|Beach|Lake|Bay|River|Island|Park|North|South|East|West|New|Old|Big|Little|Grand|Blue|Red|Green|Black|White|Gold|Silver|Sun|Sea|Ocean|Mountain|Valley|Spring|Summer|Fall|Winter|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Florida|Texas|California|Ontario|Canada|America|United|States|USA)$/;
const GENERIC_EMAIL = /^(info|contact|contactus|hello|hi|hey|sales|booking|bookings|book|booknow|reservations|reservation|res|office|admin|support|help|team|staff|mail|email|enquiries|enquiry|inquiries|inquiry|customerservice|customer|service|services|guest|guests|guestservices|guestrelations|groups|group|events|event|parties|party|media|press|marketing|jobs|careers|hr|billing|accounts|accounting|noreply|no-reply|donotreply|webmaster|privacy|legal|tickets|ticketing|tours|tour|charters|charter|cruises|cruise|rentals|rental|rent|fish|fishing|dive|diving|fly|flying|ride|rides|jump|jumps|sail|sailing|kayak|kayaks|boat|boats|school|lessons|classes|class|studio|shop|store|orders|order|frontdesk|reception|welcome|general|questions|feedback|newsletter|subscribe|weddings|wedding|catering|dispatch|crew|captain|captains|pilot|pilots|instructor|instructors|guides|guide|office|hq|main|home|web|website|online|us|ca|usa|canada|toronto|tampa|miami|orlando|vegas|nyc|la|sf|chicago|denver|austin|seattle|boston|atlanta|dallas|houston|phoenix|sandiego|portland|nashville)@/i;
const MOBILE_HINT = /\b(cell|mobile|text|call or text|text or call|direct|personal)\b/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const PAGE_HINT = /about|team|staff|story|meet|owner|founder|who-we-are|our-crew|crew|guides|instructors|captains|contact/i;

export type OwnerFound = { name?: string; title?: string; email?: string; phone?: string; url: string };

function textOf(html: string): { text: string; links: string[]; mailto: string[] } {
  const $ = load(html);
  $("script,style,noscript,svg").remove();
  // Links are read before the menu is dropped. Most sites link About and Contact only from the menu in <nav>,
  // and reading links after the menu was gone meant those pages were never fetched. The menu's words still stay
  // out of the text, where "About Us Team Contact" would read as names.
  const links: string[] = [];
  const mailto: string[] = [];
  $("a[href]").each((_, a) => {
    const h = String($(a).attr("href") || "");
    if (h.startsWith("mailto:")) mailto.push(h.slice(7).split("?")[0].trim().toLowerCase());
    else links.push(h);
  });
  $("nav,footer form").remove();
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

export type SitePage = { status: number; html: string; finalUrl: string };

export type OwnersSiteOptions = {
  /** How a page is read. Default: the shared crawler fetch (robots.txt honoured, page cache, CPU floor on a laptop). Tests pass saved pages. */
  fetchPage?: (url: string) => Promise<SitePage>;
  /** Deadline for one page, robots.txt check included. */
  pageMs?: number;
  /** Pause between two pages of the same site. */
  gapMs?: number;
  /** Pages read after the home page (About, Team, Our Story, Contact). Four, so five pages a site at most. */
  maxExtra?: number;
};

export type OwnersSiteResult = {
  /** The home page came back as a page. False: unreachable, an error status, robots.txt said no, or an empty body. */
  loaded: boolean;
  /** The home page was the site telling us to stop (a challenge or rate-limit page), not the site. */
  blocked: boolean;
  /** Pages read, the home page included. */
  pages: number;
  found: OwnerFound[];
};

/** Who runs the business, by what its own site says: names next to an owner word, personal mailboxes, mobile numbers. */
export async function ownersForSite(website: string, opts: OwnersSiteOptions = {}): Promise<OwnersSiteResult> {
  const fetchPage = opts.fetchPage || fetchHtml;
  const pageMs = opts.pageMs ?? 20000;
  const gapMs = opts.gapMs ?? 200;
  const maxExtra = opts.maxExtra ?? 4;
  const found: OwnerFound[] = [];
  const home = await withDeadline(fetchPage(website), pageMs, website).catch(() => null);
  if (!home || home.status >= 400 || !home.html) return { loaded: false, blocked: false, pages: 0, found };
  const base = new URL(home.finalUrl || website);
  const pages: { url: string; html: string }[] = [{ url: home.finalUrl, html: home.html }];
  const first = textOf(home.html);
  const wanted = Array.from(new Set(first.links.filter((h) => PAGE_HINT.test(h) && !/\.(pdf|jpg|png)$/i.test(h)).map((h) => { try { return new URL(h, base).href; } catch { return ""; } }).filter((u) => u && new URL(u).hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")))).slice(0, maxExtra);
  for (const u of wanted) {
    const r = await withDeadline(fetchPage(u), pageMs, u).catch(() => null);
    if (r && r.status < 400 && r.html) pages.push({ url: r.finalUrl || u, html: r.html });
    await sleep(gapMs);
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
  return { loaded: true, blocked: looksBlocked(home), pages: pages.length, found: found.slice(0, 8) };
}

/** The owners crawl's reader for one catalog operator, as before: its own website, the shared fetch, 20 seconds a page. */
export async function ownersForOperator(op: { id: string; domain: string; website: string }): Promise<OwnerFound[]> {
  return (await ownersForSite(op.website)).found;
}

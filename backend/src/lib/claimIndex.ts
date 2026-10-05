import { createHash } from "node:crypto";
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db/client.ts";
import { catalogId } from "./catalogId.ts";
import { readJson } from "./store.ts";
import { contactEmail } from "../../../src/lib/email.ts";

/**
 * Who may claim a listing: the email published on the operator's own website, or any address at the
 * website's own domain. The API host has no operator database, so `npm run sync` (or `npm run claim-index`)
 * writes public/claim-index.json from SQLite: per catalog id, a hash of the on-file email (never the
 * address itself), the operator's own domains, and a masked hint the claim screen can show. Ids missing from
 * the index fall back to the public detail file, which still carries the domain.
 */

const here = dirname(fileURLToPath(import.meta.url));
// Lives under public/ so the nightly cloud sync commits it with the catalog and the API host reads a fresh copy after each deploy.
const indexPath = join(here, "../../../public/claim-index.json");

type Entry = { k?: string; d: string[]; h?: string };
type Index = Record<string, Entry>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Hosts an operator publishes on but does not own. An address there proves nothing, so a listing whose only
 * "domain" is one of these is claimable from its on-file address and from nowhere else.
 *
 * Every family below was found on real crawled rows of the shipped catalog, where the business's own site is
 * a page on somebody else's host and the crawl keyed the row by that host. The cost of a missing entry is a
 * listing handed to a stranger: 801 shipped listings named one of these as a domain the business owns, and
 * the nine keyed by a consumer mail provider (`o-aim-com`, `o-usa-com`, `o-earthlink-net`, `o-126-com`,
 * `o-rr-com`, `o-roadrunner-com` among them) publish no on-file address at all, so anybody who could sign up
 * for a mailbox there could have a working claim link mailed to them and trade it for an operator session.
 *
 * Keep it to hosts that are plainly nobody's own business. A domain missing from here costs a takeover; a
 * domain wrongly on it costs one owner the domain route, who can still claim from the address on their site.
 */
const SHARED_HOST_LIST = [
  // Site builders, blogs and page hosting anyone can put a site on.
  "wixsite.com", "wix.com", "wixstudio.com", "editorx.io", "squarespace.com", "weebly.com", "godaddysites.com",
  "godaddy.com", "wordpress.com", "wpcomstaging.com", "webflow.io", "myshopify.com", "square.site",
  "business.site", "blogspot.com", "blogger.com", "carrd.co", "strikingly.com", "mystrikingly.com",
  "sites.google.com", "google.com", "yolasite.com", "tripod.com", "angelfire.com", "webnode.com",
  "webnode.page", "jimdosite.com", "jimdofree.com", "simplesite.com", "myfreesites.net", "bravesites.com",
  "dudaone.com", "duda.co", "site123.me", "ucraft.site", "tumblr.com", "substack.com", "medium.com",
  "notion.site", "neocities.org",
  // Application hosting a page can be deployed to in a minute.
  "netlify.app", "vercel.app", "web.app", "firebaseapp.com", "github.io", "gitlab.io", "pages.dev",
  "herokuapp.com", "azurewebsites.net", "amazonaws.com", "appspot.com", "glitch.me", "repl.co",
  // Booking systems. The shop's calendar lives there; the host is the vendor's.
  "booksy.com", "setmore.com", "acuityscheduling.com", "vagaro.com", "schedulicity.com", "mindbodyonline.com",
  "mindbody.io", "bookeo.com", "fareharbor.com", "peek.com", "xola.com", "checkfront.com", "resova.us",
  "rezdy.com", "tripworks.com", "youcanbook.me", "calendly.com", "squareup.com", "square.com",
  // Marketplaces, directories and ticket sellers. A product of ours is never claimed through one of these.
  "yelp.com", "yelp.ca", "tripadvisor.com", "tripadvisor.ca", "viator.com", "getyourguide.com", "groupon.com",
  "airbnb.com", "booking.com", "expedia.com", "classpass.com", "eventbrite.com", "eventbrite.ca", "meetup.com",
  "nextdoor.com", "patch.com", "facebook.com", "instagram.com",
  // Link pages, shorteners and mail blasts, which are an address and not a site.
  "linktr.ee", "linktree.com", "bio.link", "beacons.ai", "msha.ke", "t.co", "goo.gl", "g.page", "bit.ly",
  "tinyurl.com", "mailchi.mp", "campaign-archive.com",
  // Consumer mail. Anyone can hold an address at one, so one proves nothing about the business.
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.ca", "yahoo.co.uk", "yahoo.com.au", "yahoo.fr",
  "ymail.com", "outlook.com", "outlook.es", "hotmail.com", "hotmail.ca", "hotmail.co.uk", "hotmail.fr",
  "hotmail.es", "icloud.com", "aol.com", "aim.com", "me.com", "mac.com", "live.com", "live.ca", "live.fr",
  "msn.com", "protonmail.com", "proton.me", "mail.com", "email.com", "usa.com", "post.com", "consultant.com",
  "gmx.com", "gmx.net", "zoho.com", "yandex.com", "mail.ru", "fastmail.com", "hushmail.com", "inbox.com",
  "web.de", "t-online.de", "libero.it", "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "qq.com",
  "163.com", "126.com", "sina.com", "naver.com", "daum.net", "hanmail.net", "rediffmail.com",
  // Internet providers' own mail, which is the same thing one street further back.
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "bellsouth.net", "cox.net", "earthlink.net",
  "rr.com", "roadrunner.com", "twc.com", "charter.net", "centurylink.net", "embarqmail.com", "frontier.com",
  "frontiernet.net", "windstream.net", "suddenlink.net", "optonline.net", "mediacombb.net", "wowway.com",
  "cableone.net", "juno.com", "netzero.net", "pacbell.net", "swbell.net", "ameritech.net", "prodigy.net",
  "btinternet.com", "shaw.ca", "rogers.com", "bell.net", "sympatico.ca", "telus.net", "telusplanet.net",
  "cogeco.ca", "videotron.ca", "eastlink.ca",
];
const SHARED_HOSTS = new RegExp("(^|\\.)(" + SHARED_HOST_LIST.map((h) => h.replace(/\./g, "\\.")).join("|") + ")$", "i");

const emailKey = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);

/** "info@sunsetwatersports.com" -> "i...@sunsetwatersports.com". Enough to tell the owner which inbox, not enough to scrape. */
export function maskEmail(email: string): string {
  const [user, domain] = email.trim().toLowerCase().split("@");
  return (user || "").slice(0, 1) + "...@" + (domain || "");
}

export function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : "https://" + url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url.toLowerCase().replace(/^www\./, "");
  }
}

/** A domain the operator owns, or null for map-only rows, site builders and free mail. */
export function ownDomain(host: string | null | undefined): string | null {
  const h = (host || "").trim().toLowerCase().replace(/^www\./, "").split("/")[0];
  if (!h || !h.includes(".") || h.startsWith("osm-") || SHARED_HOSTS.test(h)) return null;
  return h;
}

/** The domains on one row that the business really owns, in the order the row listed them, without repeats. */
export function ownDomains(domains: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const d of domains || []) {
    const own = ownDomain(d);
    if (own && !out.includes(own)) out.push(own);
  }
  return out;
}

export function writeClaimIndex(): { path: string; count: number; withEmail: number } {
  const rows = db.prepare("SELECT domain, website, email FROM operators WHERE origin != 'demo'").all() as { domain: string; website: string | null; email: string | null }[];
  const idx: Index = {};
  let withEmail = 0;
  for (const r of rows) {
    const id = catalogId(r.domain);
    const domains = ownDomains([r.domain, r.website ? hostOf(r.website) : ""]);
    const entry: Entry = { d: domains };
    // Only an address an owner could be asked to write from: `contactEmail` decodes the ones a site hid from
    // scrapers and drops a template's own inbox, a masked name and markup. A row with none falls through to
    // the domain rule, which is better than hashing something nobody can type and telling the owner their
    // claim link goes to "i...@********ng.com".
    const email = (contactEmail(r.email) || "").toLowerCase();
    if (EMAIL.test(email)) {
      entry.k = emailKey(email);
      entry.h = maskEmail(email);
      withEmail++;
    }
    idx[id] = entry;
  }
  writeFileSync(indexPath, JSON.stringify(idx));
  // Keep the same one-string-per-entry shape the reader holds, so a sync in this process and a fresh read
  // of the file it just wrote cannot answer differently.
  cache = new Map(Object.entries(idx).map(([id, e]) => [id, JSON.stringify(e).slice(1, -1)]));
  return { path: indexPath, count: rows.length, withEmail };
}

/**
 * The index as one short string per listing, rather than as 423,187 parsed objects.
 *
 * `public/claim-index.json` is 33.8 MB and holds a row for every operator we have ever crawled, published or
 * not. Reading and parsing it whole, which is what this did, retained 145 MB of heap for the life of the
 * process and spiked resident memory to 262 MB on the way, measured on the shipped file. The API runs on a
 * 512 MB instance that is also serving guests, and the first caller is `GET /claims/:id/rule`, which is a
 * public route any claim screen opens: one request and the process carries that for ever. Streamed into one
 * string per entry it retains 75 MB and peaks at 174 MB, and the lookups stay O(1), which they have to be
 * because that route is public and a scan of 33.8 MB per call would block the loop for everyone.
 *
 * The body is kept verbatim and parsed on the one lookup that wants it, so what `Entry` means here is still
 * exactly what `JSON.parse` makes of what `writeClaimIndex` wrote. An entry is a flat object by that
 * function's own type (a hash, a list of domains and a masked hint), so it carries no nested brace; one that
 * somehow did would be missed rather than misread, and a listing missing from the index already falls back
 * to its detail file, which is the narrower rule.
 */
let cache: Map<string, string> | null = null;
let loading: Promise<Map<string, string>> | null = null;

async function readIndex(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!existsSync(indexPath)) return out;
  // `"<id>":{...}` with no brace inside. The longest entry in the shipped file is 191 characters; a chunk
  // boundary can fall inside one, so the tail past the last whole entry is carried into the next chunk.
  const ENTRY = /"([a-z0-9-]{1,120})":\{([^{}]*)\}/g;
  let carry = "";
  for await (const chunk of createReadStream(indexPath, { encoding: "utf8", highWaterMark: 1 << 20 })) {
    const text = carry + (chunk as string);
    ENTRY.lastIndex = 0;
    let end = 0;
    for (let m = ENTRY.exec(text); m; m = ENTRY.exec(text)) {
      end = m.index + m[0].length;
      out.set(m[1], m[2]);
    }
    carry = text.slice(Math.max(end, text.length - 1024));
  }
  return out;
}

function loadIndex(): Promise<Map<string, string>> {
  if (cache) return Promise.resolve(cache);
  // Two claim screens opening at once must not each read the file.
  if (!loading) {
    loading = readIndex().then(
      (m) => {
        cache = m;
        loading = null;
        return m;
      },
      (e) => {
        loading = null;
        throw e;
      },
    );
  }
  return loading;
}

/** The one entry a lookup wants, parsed where it sits. */
function entryOf(index: Map<string, string>, id: string): Entry | undefined {
  const body = index.get(id);
  if (body === undefined) return undefined;
  try {
    return JSON.parse("{" + body + "}") as Entry;
  } catch {
    return undefined;
  }
}

export type ClaimRule = {
  /** False when neither the index nor the public catalog knows this id. */
  known: boolean;
  /** True when the operator's site published an email we can match against. */
  hasEmail: boolean;
  /** Masked on-file address, for the claim screen. */
  hint: string | null;
  /** Domains the operator owns. Any address there may claim. */
  domains: string[];
  /** The partner a product is sold on (Viator and the like). Set means nobody claims this here. */
  partner: string | null;
};

/**
 * What it takes to claim listing `id`. Falls back to the public detail file when the index has no row.
 *
 * The index is written from the operators table, which never holds a partner's product, so an affiliate row
 * always arrives here by the fallback and the detail file is the thing that knows. That matters: every one of
 * the 6,492 shipped partner rows carries `src: "viator.com"`, and the domain rule below reads that as a domain
 * the business owns, so any address at viator.com could have a working claim link mailed to it for any one of
 * them and trade it for an operator session. `backend/AGENTS.md`: "An affiliate row is never an operator: no
 * claim link, no outreach, no Instant Book, no request, no Otto." POST /bookings and the voice routes already
 * say so; this is the first item on that list and it was the one still open.
 */
export async function claimRule(id: string): Promise<ClaimRule> {
  const e = entryOf(await loadIndex(), id);
  // Read each domain on the row rather than trust the file. The index was written by whichever sync last ran,
  // which may have been built before a host was known to be one nobody owns, and a stale row granting
  // `@aim.com` a listing cannot wait for the next sync to stop granting it.
  if (e) return { known: true, hasEmail: !!e.k, hint: e.h || null, domains: ownDomains(e.d), partner: null };
  const item = await readJson<{ src?: string; affiliate?: { label?: string } }>(`o/${id}.json`).catch(() => null);
  if (item?.affiliate) return { known: true, hasEmail: false, hint: null, domains: [], partner: item.affiliate.label || "the partner's site" };
  const d = item?.src ? ownDomain(hostOf(item.src)) : null;
  return { known: !!item, hasEmail: false, hint: null, domains: d ? [d] : [], partner: null };
}

/** True when `email` is the address on the operator's site or lives at a domain the operator owns. */
export async function emailMayClaim(id: string, email: string): Promise<{ ok: boolean; rule: ClaimRule }> {
  const rule = await claimRule(id);
  const em = email.trim().toLowerCase();
  if (rule.partner || !EMAIL.test(em)) return { ok: false, rule };
  const e = entryOf(await loadIndex(), id);
  if (e?.k && emailKey(em) === e.k) return { ok: true, rule };
  const host = em.split("@")[1] || "";
  const ok = rule.domains.some((d) => host === d || host.endsWith("." + d));
  return { ok, rule };
}

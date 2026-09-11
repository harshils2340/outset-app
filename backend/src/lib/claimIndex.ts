import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db/client.ts";
import { readJson } from "./store.ts";

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

/** Hosts an operator publishes on but does not own. An address there proves nothing. */
const SHARED_HOSTS =
  /(^|\.)(wixsite\.com|wix\.com|squarespace\.com|weebly\.com|godaddysites\.com|wordpress\.com|webflow\.io|myshopify\.com|square\.site|business\.site|blogspot\.com|carrd\.co|strikingly\.com|sites\.google\.com|google\.com|facebook\.com|instagram\.com|linktr\.ee|gmail\.com|googlemail\.com|yahoo\.com|yahoo\.ca|outlook\.com|hotmail\.com|hotmail\.ca|icloud\.com|aol\.com|me\.com|live\.com|live\.ca|msn\.com|protonmail\.com|proton\.me|comcast\.net|att\.net|verizon\.net|sbcglobal\.net|bellsouth\.net|cox\.net|shaw\.ca|rogers\.com|bell\.net|sympatico\.ca|telus\.net)$/i;

const emailKey = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);

/** "info@sunsetwatersports.com" -> "i...@sunsetwatersports.com". Enough to tell the owner which inbox, not enough to scrape. */
export function maskEmail(email: string): string {
  const [user, domain] = email.trim().toLowerCase().split("@");
  return (user || "").slice(0, 1) + "...@" + (domain || "");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

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

export function writeClaimIndex(): { path: string; count: number; withEmail: number } {
  const rows = db.prepare("SELECT domain, website, email FROM operators WHERE origin != 'demo'").all() as { domain: string; website: string | null; email: string | null }[];
  const idx: Index = {};
  let withEmail = 0;
  for (const r of rows) {
    const id = "o-" + slug(r.domain);
    const domains = Array.from(new Set([ownDomain(r.domain), r.website ? ownDomain(hostOf(r.website)) : null].filter((x): x is string => !!x)));
    const entry: Entry = { d: domains };
    const email = (r.email || "").trim().toLowerCase();
    if (EMAIL.test(email)) {
      entry.k = emailKey(email);
      entry.h = maskEmail(email);
      withEmail++;
    }
    idx[id] = entry;
  }
  writeFileSync(indexPath, JSON.stringify(idx));
  cache = idx;
  return { path: indexPath, count: rows.length, withEmail };
}

let cache: Index | null = null;
function loadIndex(): Index {
  if (!cache) cache = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, "utf8")) as Index) : {};
  return cache;
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
};

/** What it takes to claim listing `id`. Falls back to the public detail file when the index has no row. */
export async function claimRule(id: string): Promise<ClaimRule> {
  const e = loadIndex()[id];
  if (e) return { known: true, hasEmail: !!e.k, hint: e.h || null, domains: e.d };
  const item = await readJson<{ src?: string }>(`o/${id}.json`).catch(() => null);
  const d = item?.src ? ownDomain(hostOf(item.src)) : null;
  return { known: !!item, hasEmail: false, hint: null, domains: d ? [d] : [] };
}

/** True when `email` is the address on the operator's site or lives at a domain the operator owns. */
export async function emailMayClaim(id: string, email: string): Promise<{ ok: boolean; rule: ClaimRule }> {
  const rule = await claimRule(id);
  const em = email.trim().toLowerCase();
  if (!EMAIL.test(em)) return { ok: false, rule };
  const e = loadIndex()[id];
  if (e?.k && emailKey(em) === e.k) return { ok: true, rule };
  const host = em.split("@")[1] || "";
  const ok = rule.domains.some((d) => host === d || host.endsWith("." + d));
  return { ok, rule };
}

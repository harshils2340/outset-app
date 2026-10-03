import { createHash } from "node:crypto";
import { db } from "../db/client.ts";

/**
 * The id a listing carries, which is its operator's own domain: "aqua-tots.com" -> "o-aqua-tots-com".
 *
 * Every surface keys off it. The guest app opens a listing at "#o=<id>", the detail file is "public/o/<id>.json",
 * the claim index and the claim link's signature are keyed by it, outreach emails carry it, and the static
 * "/l/<id>" page is named after it. So it has to name one business.
 *
 * The slug alone does not. It folds every run of punctuation to a single hyphen and cuts at 48 characters, so
 * "aqua-tots.com" and "aqua_tots.com" both ask for "o-aqua-tots-com", and any two domains agreeing on their
 * first 48 characters would too. The 23 September catalog shipped one such pair, two Aqua-Tots locations with
 * one id between them, and every writer settled it differently: catalog.json carried both rows, the app's own
 * merge kept the first (Westerville, Ohio, with its cover and its tags), while the detail file and the claim
 * index were written by the second. A guest opening the Westerville card got a page headed "Dallas, TX" with a
 * Dallas phone number and none of the shop's own facts, and the only address allowed to claim that listing was
 * one at the other shop's domain.
 *
 * A collision is settled here instead, once, from the domains alone: the first domain in order keeps the plain
 * id and each of the others gets its own, with a stable six characters of its domain's hash on the end. Order
 * does not come into it, so the catalog, the detail files, the live index, the claim index and the outreach
 * drafts all answer the same without having to agree on how they walk the table. One business, one id, and the
 * 46,324 ids the catalog already publishes are untouched.
 */
export function slugDomain(domain: string): string {
  return (domain || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

const tag = (domain: string, chars: number) => createHash("sha256").update(domain).digest("hex").slice(0, chars);

/** Every domain's id, each distinct from the others, whatever order the domains arrive in. */
export function idsForDomains(domains: Iterable<string>): Map<string, string> {
  const list = [...new Set([...domains].map((d) => (d || "").trim().toLowerCase()))].sort();
  const owner = new Map<string, string>();
  for (const d of list) {
    const s = slugDomain(d);
    if (!owner.has(s)) owner.set(s, d);
  }
  const taken = new Set<string>();
  const out = new Map<string, string>();
  // The owners first: a plain id can then never be taken by a suffix that happens to spell it.
  for (const d of list) {
    if (owner.get(slugDomain(d)) !== d) continue;
    const id = "o-" + slugDomain(d);
    taken.add(id);
    out.set(d, id);
  }
  for (const d of list) {
    if (out.has(d)) continue;
    let id = "";
    for (let chars = 6; chars <= 64; chars += 2) {
      id = "o-" + slugDomain(d) + "-" + tag(d, chars);
      if (!taken.has(id)) break;
    }
    taken.add(id);
    out.set(d, id);
  }
  return out;
}

let cache: Map<string, string> | null = null;

/** Built once per process from the whole operators table, so a row the sync filters out still cannot move an id. */
function ids(): Map<string, string> {
  if (!cache) {
    let domains: string[] = [];
    try {
      domains = (db.prepare("SELECT domain FROM operators").all() as { domain: string }[]).map((r) => r.domain);
    } catch (e) {
      // No table yet (a fresh container, a script run before `npm run ingest`): the plain slug is the answer
      // for every domain that has no rival, and there are no rivals in an empty catalog.
      console.warn("[catalogId] could not read operator domains: " + (e as Error).message);
    }
    cache = idsForDomains(domains);
  }
  return cache;
}

/** The id for one domain. Falls back to the plain slug for a domain the catalog does not hold. */
export function catalogId(domain: string): string {
  const d = (domain || "").trim().toLowerCase();
  return ids().get(d) ?? "o-" + slugDomain(d);
}

/** After an import or a delete, so the next id read sees the rows that are there now. */
export function resetCatalogIds(): void {
  cache = null;
}

import { promises as dns } from "node:dns";

/**
 * Whether an address can receive mail at all, judged from its domain's DNS before anything is sent.
 *
 * A bounce is the worst thing a cold email can do to the sending mailbox: Gmail reads a run of them as a
 * scraped list, and the scraped list is exactly what this is, however carefully it was read off each
 * operator's own site. Sites go dark, domains lapse, and a contact page keeps quoting an address whose
 * domain no longer takes mail. Asking DNS first costs a few milliseconds a domain and keeps those out of the
 * day's batch entirely, so they never count as a bounce.
 *
 * The decision is deliberately narrow. Only "this domain has no mail exchanger and no address at all" is a
 * no. A resolver that cannot answer (no network, a timeout, a sandbox with DNS blocked) is not evidence
 * about the domain, so the address goes through as it would have before this check existed.
 */

export type Lookup = { mx: boolean | null; a: boolean | null };

export function decide(l: Lookup): boolean {
  if (l.mx === true || l.a === true) return true;
  // Both lookups answered and both said the name does not exist: nothing can deliver there.
  if (l.mx === false && l.a === false) return false;
  // At least one lookup gave no answer at all (network, timeout): not evidence, let it through.
  return true;
}

/**
 * What a failed lookup says about the domain: `false` for an answer that the name has nothing there, `null`
 * for no answer at all.
 *
 * Only two codes are the domain's own. `ENOTFOUND` is NXDOMAIN, the authoritative server saying the name does
 * not exist. `ENODATA` is NOERROR with an empty answer, the name existing with no record of that type.
 *
 * `ESERVFAIL` is neither, and used to be read as one. It is SERVFAIL, which is the resolver saying it could
 * not complete the question: an upstream it cannot reach, a DNSSEC signature it cannot validate, its own
 * overload. That is exactly the "a resolver that cannot answer is not evidence" case above, and reading it as
 * "this domain does not exist" is fail-closed in the one direction that costs something. The cloud sender
 * (scripts/otto-cloud.mts) writes a `failed` touch for every address this refuses, and a failed touch takes
 * that address out of the pool for good, so one resolver hiccup could retire every business it happened to
 * ask about. guards.ts's `skipMark` carries the same warning about the laptop's queue.
 */
export function readDnsError(code: string | undefined): false | null {
  return code === "ENOTFOUND" || code === "ENODATA" ? false : null;
}

async function has(fn: () => Promise<unknown[]>): Promise<boolean | null> {
  try {
    const r = await fn();
    return r.length > 0;
  } catch (e) {
    return readDnsError((e as { code?: string }).code);
  }
}

const cache = new Map<string, Promise<boolean>>();

/** True unless the address's domain is known to take no mail. Cached per domain for the life of the process. */
export function isDeliverable(email: string): Promise<boolean> {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return Promise.resolve(false);
  let p = cache.get(domain);
  if (!p) {
    p = Promise.all([has(() => dns.resolveMx(domain)), has(() => dns.resolve4(domain))]).then(([mx, a]) => decide({ mx, a }));
    cache.set(domain, p);
  }
  return p;
}

/**
 * Whether the business's own website still has a name. On 4 October 2026 one escape room in eight in the queue had
 * a website whose domain no longer existed: a business that has closed or moved on, whose gmail or desk inbox is
 * where bounces and abandoned, full mailboxes come from (13 bounces in three days, about 6% of sends, against the
 * 2-3% past which Gmail starts reading a sender as a scraped list). Dead only when every name tried, with and
 * without www, answered that nothing is there; no website at all, or a resolver that cannot answer, is not
 * evidence and lets the business through, the same rule as `decide` above.
 */
export function siteAlive(lookups: { a: boolean | null; aaaa: boolean | null }[]): boolean {
  return !lookups.length || lookups.some((l) => l.a !== false || l.aaaa !== false);
}

/** The names a website answers under: its own host, and the same with or without www. None for no website. */
export function siteHosts(website: string | null | undefined): string[] {
  const raw = (website || "").trim();
  if (!raw) return [];
  let host = "";
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw).hostname.toLowerCase();
  } catch {
    return [];
  }
  if (!host.includes(".") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return [];
  const bare = host.replace(/^www\./, "");
  return bare === host ? [host, "www." + host] : [host, bare];
}

const sites = new Map<string, Promise<boolean>>();

/** True unless the business's website is known to be gone. Cached per host for the life of the process. */
export function siteResolves(website: string | null | undefined): Promise<boolean> {
  const hosts = siteHosts(website);
  if (!hosts.length) return Promise.resolve(true);
  let p = sites.get(hosts[0]);
  if (!p) {
    p = Promise.all(hosts.map(async (h) => {
      const [a, aaaa] = await Promise.all([has(() => dns.resolve4(h)), has(() => dns.resolve6(h))]);
      return { a, aaaa };
    })).then(siteAlive);
    sites.set(hosts[0], p);
  }
  return p;
}

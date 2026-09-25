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

const NO_SUCH = new Set(["ENOTFOUND", "ENODATA", "ESERVFAIL"]);

async function has(fn: () => Promise<unknown[]>): Promise<boolean | null> {
  try {
    const r = await fn();
    return r.length > 0;
  } catch (e) {
    const code = (e as { code?: string }).code || "";
    return NO_SUCH.has(code) ? false : null;
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

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

import { query } from "../db/pg.ts";
import { hostPageAddress } from "./guards.ts";

/**
 * Is this address the business's own? The last check before an Otto pitch goes out, after Gardner Village's
 * marketing manager wrote back on 7 October 2026 "I'm not A Great Escape. Please reach out to their company."
 * An audit of the whole pool (161,496 rows) that day found these shapes of an address that reaches someone
 * other than the business the email names, or a business that is not who Otto is for:
 *
 *   host page        the business only has a page on someone else's site, and the address is that site's
 *                    (guards.ts hostPageAddress: a shopping village, a hotel's spa page, a tourism board)
 *   other location   a chain's listing carries another branch's address: True REST in Washington DC at
 *                    sandiego@truerest.com, Congo River in Daytona at clearwater@congoriver.com
 *   another business one address on several listings, named for one of them: Skeggy's Axe House at
 *                    sangokurasake@gmail.com
 *   department       an inbox for donations, jobs, billing, the webmaster or the press, not anyone who decides
 *                    (orders@ is not one: at a restaurant or caterer it is the inbox the owner reads)
 *   public           a city, county, state, school district or army-corps facility: not a business
 *   corporate chain  a location of a national brand run from head office (Dave & Buster's, Massage Envy)
 *
 * Each rule is narrow on purpose: it names what it caught and a test pins a real kept row beside each one.
 */
export type RecipientRow = { operator_id: string; name: string; domain: string; website: string | null; email: string; city: string | null };

export type PoolContext = {
  /** Every address on more than one listing, with the names of those listings. */
  shared: Map<string, string[]>;
  /**
   * Every city of two or more words the pool has a listing in, squashed (sandiego, saratogasprings,
   * newportbeach): an address whose whole local part is one of these names a place, not a person. A one-word
   * city is left out because so many are first names too (Blair, Shannon, Lincoln, Crawford).
   */
  places: Set<string>;
};

const squash = (s: string | null | undefined) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
const tokens = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4);

const DEPARTMENT = /^(abuse|privacy|legal|careers?|jobs?|hr|hiring|recruit(ing|ment)?|accounting|accounts|ap|ar|billing|invoices?|payroll|press|media|pr|webmaster|web|security|compliance|donations?|donate|giving|development|volunteers?|lostandfound|orderservice|returns|warranty|dmca|unsubscribe)@/i;
const PUBLIC_HOST = /\.(gov|mil|edu|gc\.ca)$|\.gov\.[a-z]{2}$|\.k12\.|\.(state|ci|co|city|town|cityof)\.[a-z]{2}\.us$|^[a-z-]+\.[a-z]{2}\.us$|^(city|town|village|county|township)of[a-z-]+\.|army\.mil$/;
const PUBLIC_NAME = /\b(city of|town of|village of|county of|township of|parks? (and|&) rec(reation)?|recreation department|municipal|army corps|state park|provincial park|national park)\b/i;
/** Head-office domains of national chains; a franchisee on its own domain is not on this list. */
const CHAIN_DOMAINS = new Set(["daveandbusters.com", "topgolf.com", "mainevent.com", "round1usa.com", "bowlero.com", "bowlluckystrike.com",
  "andrettikarting.com", "andrettiindoorkarting.com", "k1speed.com", "puttshack.com", "skyzone.com", "urbanair.com", "urbanairtrampolinepark.com",
  "greatwolf.com", "sixflags.com", "ripleys.com", "madametussauds.com", "legolanddiscoverycenter.com", "legolanddiscoverycentre.com",
  "massageenvy.com", "handandstone.com", "f45training.com", "clubpilates.com", "orangetheory.com", "planetfitness.com", "crunch.com",
  "lafitness.com", "24hourfitness.com", "goldsgym.com", "cinemark.com", "regmovies.com", "amctheatres.com", "chuckecheese.com",
  "altitudetrampolinepark.com", "launchtrampolinepark.com", "rockinjump.com", "flipnosis.com", "escaperoom.com", "theescapegame.com"]);

/** One read of the pool: the shared addresses and the multi-city domains. */
export async function loadPoolContext(): Promise<PoolContext> {
  const shared = new Map<string, string[]>();
  for (const r of await query<{ email: string; names: string[] }>(
    "select lower(email) as email, array_agg(name) as names from outreach_pool group by lower(email) having count(*) > 1"))
    shared.set(r.email, r.names);
  const places = new Set<string>();
  for (const r of await query<{ city: string }>("select distinct city from outreach_pool where city ~ '[ -]'"))
    if (squash(r.city).length >= 8) places.add(squash(r.city));
  return { shared, places };
}

/** Why this address must not get this business's pitch, or null when it is the business's own. */
export type WrongRecipient = { kind: "host page" | "other location" | "another business" | "department" | "public" | "chain"; why: string };
export function wrongRecipient(r: RecipientRow, ctx: PoolContext): WrongRecipient | null {
  const email = r.email.trim().toLowerCase();
  const [local, at] = email.split("@");
  const host = r.domain.toLowerCase().replace(/^www\./, "");
  const lp = squash(local);
  if (hostPageAddress(r)) return { kind: "host page", why: `the address is ${host}'s, whose page only lists ${r.name}` };
  // Another branch's address only when the listing's own page names this listing's city and not the address's:
  // plunj.co/locations/loveland with saratogasprings@plunj.co. A sample without that read half of them wrong
  // (portjefferson@ for Port Jefferson Station, westroxbury@ for a Boston listing in West Roxbury).
  const web = squash((r.website || "").replace(/^https?:\/\//i, ""));
  const city = squash(r.city);
  if (at === host && ctx.places.has(lp) && city.length >= 5 && !city.startsWith(lp) && !lp.startsWith(city) && !web.includes(lp) && web.includes(city) && !squash(r.name).includes(lp))
    return { kind: "other location", why: `${email} is the ${local} location's, not ${r.city}'s` };
  const names = ctx.shared.get(email);
  if (names) {
    const initials = (n: string) => n.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !["the", "a", "an", "of", "and", "at"].includes(w)).map((w) => w[0]).join("");
    const owns = (n: string) => tokens(n).some((t) => lp.includes(squash(t))) || (initials(n).length >= 3 && lp.startsWith(initials(n)));
    // The listing's own domain counts as its name: Space KTV's site is lairktv.com and its address lairktv@.
    const label = squash(host.split(".")[0]);
    const mine = owns(r.name) || (label.length >= 5 && (lp.includes(label) || label.includes(lp)));
    const other = names.find((n) => n !== r.name && owns(n));
    if (!mine && other) return { kind: "another business", why: `${email} belongs to ${other}` };
  }
  if (DEPARTMENT.test(email)) return { kind: "department", why: `${local}@ is a department inbox` };
  // A public address, or a public site's page with an address at it. A private business that only has a listing
  // on a village's site and its own gmail is still a business (Seaside RV Campground, villageoftahsis.com).
  if (PUBLIC_HOST.test(at || "") || (PUBLIC_HOST.test(host) && at === host) || PUBLIC_NAME.test(r.name)) return { kind: "public", why: "a public facility, not a business" };
  const chain = [host, at || ""].map((h) => h.split(".").slice(-2).join(".")).find((h) => CHAIN_DOMAINS.has(h));
  if (chain) return { kind: "chain", why: `a ${chain} location, run from head office` };
  return null;
}

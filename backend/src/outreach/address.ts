import { contactEmail } from "../../../src/lib/email.ts";

/**
 * Which address a claim email may be sent to.
 *
 * Two questions, and they are not the same one. Is this an address at all: `contactEmail` answers that, and
 * is the reader the claim index, the dashboard prefill and the sync already share, so an address a site hid
 * from robots is decoded and a site template's placeholder inbox is not an address at all. And is it this
 * operator's address: an inbox scraped off a partner's page (a river walk listing a Legoland inbox) must not
 * get a link that claims the business, so keep the operator's own domain, a personal mailbox, or nothing.
 *
 * The crawl stores what `contactEmail` reads, but every row scraped before it did keeps what the site showed,
 * and those rows are drafted from as they stand. Reading them the same way here is what stops a claim email
 * going to `%69nfo@theirshop.com`, which is a hard bounce against our own sending domain and an operator who
 * never hears from us.
 */

/** Mailbox hosts where an address belongs to a person rather than to a business's domain. */
const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|icloud|aol|me|live|msn|comcast|att|verizon|bellsouth|shaw|rogers|telus|sympatico|bell)\./;
/** A role inbox says nothing about who owns it, so it only counts on the operator's own domain. */
const ROLE = /^(info|hello|hi|contact|contactus|book|booknow|booking|bookings|reservation|reservations|res|sales|tours|tour|office|admin|support|help|team|staff|mail|email|enquiries|enquiry|inquiries|inquiry|customerservice|service|services|guest|guests|guestservices|groups|events|parties|media|press|marketing|jobs|careers|hr|billing|accounts|accounting|noreply|no-reply|donotreply|webmaster|privacy|legal|tickets|ticketing|charters|charter|cruises|cruise|rentals|rental|rent|frontdesk|reception|welcome|questions|feedback|newsletter|weddings|catering|dispatch|crew|hq|main|home|web|website|online|marina|waivers|programs|registrar|director|buyers|warehouse|orders)@/;
/**
 * A word that makes a mailbox a desk rather than a person wherever it sits in the local part: paddlinginfo@,
 * mikescharters@, captainsteve@ are the business, not someone's own inbox.
 */
const DESK_WORD = /(info|book|reserv|sales|office|admin|support|contact|hello|tour|charter|rental|cruise|order|event|team|staff|service|mail|marina|waiver|program|registrar|director|buyer|warehouse|frontdesk|reception|dispatch|crew|captain|pilot|instructor|guide|school|lesson|class|shop|store|fish|dive|kayak|boat|sail|parasail|jetski|rent|ski|surf|charters)/;

/**
 * The inbox of whoever runs the place rather than of a desk: owner@, manager@, gm@. Harshil, 4 October 2026: find the
 * managers' and owners' direct inboxes, not info@. Better than any desk, below a named person's own mailbox.
 */
const DECIDER = /^(owner|owners|manager|managers|management|gm|generalmanager|general\.manager|ceo|founder|founders|president)$/;

function localPart(email: string): string {
  return email.split("@")[0];
}

function ownDomain(host: string, own: string): boolean {
  return host === own || host.endsWith("." + own) || own.endsWith("." + host);
}

/**
 * Whether a mailbox reads as one person's: a first name or first.last, no desk word, and not the business's
 * own name used as a mailbox (islandtimeparasail@gmail.com is the shop, ron@capitolboatclub.com is Ron).
 */
export function looksPersonal(email: string, domain: string): boolean {
  const local = localPart(email.toLowerCase());
  if (!/^[a-z]{2,20}(?:[._-][a-z]{1,20}){0,2}$/.test(local)) return false;
  if (DESK_WORD.test(local)) return false;
  const stem = (domain || "").toLowerCase().replace(/^www\./, "").split(".")[0].replace(/[^a-z]/g, "");
  const flat = local.replace(/[._-]/g, "");
  if (stem.length >= 5 && flat.length >= 6 && (flat.includes(stem) || stem.includes(flat))) return false;
  return true;
}

/**
 * Where a pitch should go, from 0 (not this operator's, never) up. The owner's own mailbox at their domain
 * beats their personal gmail or the manager's inbox there (manager@, gm@, owner@), which beat a mailbox that is
 * neither a person nor a desk (a brand-named gmail),
 * which beats a desk. Every desk scores the same, so a crawl candidate that is just another desk (waivers@,
 * paddlinginfo@) never displaces the front desk already on file: ties keep the first candidate, the front
 * desk. A role inbox on a stranger's domain is nobody's and scores 0, same as before any ranking existed.
 */
function rank(email: string, own: string): number {
  const host = email.split("@")[1];
  const mine = ownDomain(host, own);
  const free = FREE_MAIL.test(host);
  if (!mine && !free) return 0;
  if (DECIDER.test(localPart(email))) return mine ? 4 : 2;
  if (looksPersonal(email, own)) return mine ? 5 : 4;
  if (ROLE.test(email) || DESK_WORD.test(localPart(email))) return 1;
  return mine ? 3 : 2;
}

/**
 * The owners crawl reads addresses out of page text, and a label glued to one by the markup comes along:
 * "Email info@shop.com" becomes emailinfo@shop.com, "Page hello@" becomes pagehello@. Such a candidate ends
 * with another candidate at the same host; it is the same mailbox misspelt and would bounce, so it goes.
 */
function dropGlued(candidates: string[]): string[] {
  return candidates.filter((c) => {
    const [local, host] = c.split("@");
    return !candidates.some((d) => {
      const [dl, dh] = d.split("@");
      return d !== c && dh === host && dl.length < local.length && local.endsWith(dl);
    });
  });
}

/**
 * The address a pitch goes to. `ownerEmails` are the mailboxes the owners crawl read off the operator's own
 * site (facts owner_email); with none, this is exactly the old rule over the front-desk column. A crawl
 * candidate with digits in it is a phone number glued to an address by a site's markup, not a mailbox.
 */
export function outreachAddress(op: { email: string | null; domain: string }, ownerEmails: string[] = []): string | null {
  const own = (op.domain || "").toLowerCase().replace(/^www\./, "");
  if (!own) return null;
  const candidates: string[] = [];
  const front = (contactEmail(op.email) || "").toLowerCase();
  if (front) candidates.push(front);
  for (const raw of ownerEmails) {
    const e = (contactEmail(raw) || "").toLowerCase();
    if (!e || candidates.includes(e) || /\d/.test(localPart(e))) continue;
    candidates.push(e);
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const e of dropGlued(candidates)) {
    const score = rank(e, own);
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The first name to open with, only when the mailbox is that person's by the site's own word: an owner_name
 * fact ("Jeff Rogers (owner)", "Mike") whose first name starts the local part (jeff@, jeff.rogers@). A name
 * the site gave for someone else, or a mailbox that is a desk, opens with nothing.
 */
export function ownerFirstName(email: string, ownerNames: string[]): string | null {
  // "capt.rayn@" is Rayn's, not Capt's: a title in front of the mailbox is skipped the same way it is in the name.
  const local = localPart(email.toLowerCase()).replace(TITLE_PREFIX, "");
  if (DESK_WORD.test(local)) return null;
  for (const raw of ownerNames) {
    const tokens = raw.replace(/\s*\(.*\)\s*$/, "").trim().split(/\s+/);
    while (tokens.length && TITLE_WORD.test(tokens[0])) tokens.shift();
    const first = tokens[0] || "";
    if (first.length < 3 || !/^[A-Z][a-z]+$/.test(first)) continue;
    if (local === first.toLowerCase() || local.startsWith(first.toLowerCase() + ".") || local.startsWith(first.toLowerCase() + "_") || local.startsWith(first.toLowerCase() + "-")) return first;
  }
  return null;
}

/** A title, not a name: "Capt Rayn", "Dr. Lee", "Coach Ann". Never what a greeting opens with. */
const TITLE_WORD = /^(capt|captain|cpt|dr|mr|mrs|ms|miss|chef|coach|rev|sir|skipper|pilot|instructor)\.?$/i;
const TITLE_PREFIX = /^(capt|captain|cpt|dr|mr|mrs|ms|chef|coach|skipper)[._-]/;

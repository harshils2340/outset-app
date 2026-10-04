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
 * mikescharters@, captainsteve@ are the business, not someone's own inbox. So are a vendor's and an events
 * desk's: on 4 October 2026 the owners lookup moved an escape room's pitch to farskymediacompany@gmail.com, the
 * web designer named in its footer, and others to corporate@, donations@, hiring@, birthdays@ and coaches@.
 * The short words stop short of common surnames: Szymanski is not a ski desk, Brent is not a rental, nor are
 * Fisher, Bishop, Stafford, Storey, Booker or Ismail a fishing, shop, staff, store, booking or mail desk.
 */
const DESK_WORD = /(info|book(?!er)|reserv|sales|office|admin|support|contact|hello|tour|charter|rental|cruise|order|event|team|staff(?!ord)|service|(?<!is)mail|marina|waiver|program|registrar|director|buyer|warehouse|frontdesk|reception|dispatch|crew|captain|pilot|instructor|guide|school|lesson|class|(?<!bi)shop|store(?![yr])|fish(?!er|man|burn)|dive|kayak|boat|sail|parasail|jetski|(?:^|[._-]|water|snow|heli|aqua)ski|skis|skiing|surf|charters|corporate|media|design|digital|marketing|agency|creative|consult|solutions|graphic|photo|productions|member|youth|coach|donation|hiring|retail|birthday|party|parties|yoga|communication|facilit|payroll|invoice|volunteer|league|webmaster|wix|tech|racing|experience|concierge|merch(?!ant)|camping|women|entertain|partner|enroll)/;

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
  // The business's own name in the mailbox, whole or in part: coyoteyouth@ at coyoterockgym.ca, a site's typo
  // rockfischlimbing@ beside rockfishclimbing.com, escaperoomaltoona@ at escapealtoona.com. Five letters in a row.
  if (stem.length >= 5 && flat.length >= 6 && sharedRun(flat, stem) >= 5) return false;
  return true;
}

/** The longest run of letters two strings share. */
function sharedRun(a: string, b: string): number {
  let best = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  return best;
}

/** Gmail takes no mailbox under six characters, dots aside: rg@gmail.com, read off a site, is nobody's. */
export function impossibleGmail(email: string): boolean {
  const [local, host] = email.toLowerCase().split("@");
  if (host !== "gmail.com" && host !== "googlemail.com") return false;
  const name = (local || "").split("+")[0].replace(/\./g, "");
  return name.length < 6 || name.length > 30;
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

/** Edits between two strings, a swapped neighbouring pair counting as one (optimal string alignment). */
function edits(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/**
 * The address on file misspelt: same host, a long mailbox, two edits or fewer. RockFish Climbing's site printed
 * rockfischlimbing@gmail.com beside rockfishclimbing@gmail.com; a typo is a bounce, so the one on file stays.
 */
function misspelt(candidate: string, front: string): boolean {
  const [cl, ch] = candidate.split("@");
  const [fl, fh] = front.split("@");
  return !!front && ch === fh && cl !== fl && Math.min(cl.length, fl.length) >= 6 && edits(cl, fl) <= 2;
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
    if (!e || candidates.includes(e) || /\d/.test(localPart(e)) || impossibleGmail(e) || misspelt(e, front)) continue;
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

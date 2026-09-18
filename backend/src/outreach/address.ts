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
const ROLE = /^(info|hello|contact|book|bookings|reservations|sales|tours|office|admin|support)@/;

export function outreachAddress(op: { email: string | null; domain: string }): string | null {
  const e = (contactEmail(op.email) || "").toLowerCase();
  if (!e) return null;
  const host = e.split("@")[1];
  const own = (op.domain || "").toLowerCase().replace(/^www\./, "");
  if (!own) return null;
  if (host === own || host.endsWith("." + own) || own.endsWith("." + host)) return e;
  if (FREE_MAIL.test(host)) return e;
  if (ROLE.test(e)) return null;
  return null;
}

/**
 * What has to be true before a commercial email goes to a business that never asked for one.
 *
 * Every check here is a way to mail thousands of real operators and only find out afterwards, so they are
 * gathered in one pure function the tests can drive: a suppression list nobody could read, links signed with
 * a secret the API cannot verify, an unsubscribe link pointing at a laptop, no postal address, the test
 * sender. `sendOutreach` reads the environment and prints whatever comes back; nothing here touches it.
 */

export type OutreachChecks = {
  /** `process.env.CLAIM_SECRET`. Unset means `claimSecret()` invents one, which the API has never seen. */
  claimSecret: string;
  /** `process.env.MAIL_FROM`. */
  mailFrom: string;
  /** `mailPostal()`. */
  postal: string;
  /** The unsubscribe link this machine would put in the mail, from `unsubPageUrl`. */
  unsubUrl: string;
  /** What `loadSuppression` could actually read. */
  suppression: { fromDb: boolean; fromApi: boolean; error?: string };
};

/** A link a stranger can open: https, a real public host, not this machine. */
export function publicHttpsLink(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  // A bare address is nobody's mail server and nobody's website.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return false;
  return host.includes(".");
}

/**
 * Reasons this send must not happen, in the order they are worth reading. Empty means go.
 * A dry run prints the same list as a warning and carries on, because printing is the point of a dry run.
 */
export function outreachBlockers(c: OutreachChecks): string[] {
  const out: string[] = [];

  if (!c.suppression.fromDb && !c.suppression.fromApi) {
    out.push(
      "The unsubscribe list could not be read" +
        (c.suppression.error ? " (" + c.suppression.error + ")" : "") +
        ". Every address that unsubscribed, hard bounced or reported spam would be mailed again. Set DATABASE_URL, or wait for the API to answer.",
    );
  }

  if (!c.claimSecret.trim()) {
    out.push(
      "CLAIM_SECRET is not set, so this machine signs with a secret of its own and the API cannot check anything it signs: the claim link and the unsubscribe link in every one of these emails would be dead on arrival. Set CLAIM_SECRET to the value on outset-api.",
    );
  }

  if (!publicHttpsLink(c.unsubUrl)) {
    out.push(
      "The unsubscribe link would be " + (c.unsubUrl || "(empty)") + ", which nobody who gets this mail can open. Set SITE_URL to https://onoutset.com/ before sending.",
    );
  }

  if (!c.postal.trim()) {
    out.push("Set MAIL_POSTAL to a PO box or mailbox (not a made-up street) before sending to businesses.");
  }

  const from = c.mailFrom.trim();
  if (!(/@onoutset\.com>/i.test(from) || /@onoutset\.com$/i.test(from))) {
    out.push("MAIL_FROM is still the Resend test address. Set MAIL_FROM to Harshil <hello@onoutset.com>.");
  }

  return out;
}

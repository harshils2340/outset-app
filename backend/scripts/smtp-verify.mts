import "../src/env.ts";
import nodemailer from "nodemailer";
import { smtpIdentities } from "../src/lib/mail.ts";

/**
 * Logs in to Gmail with every configured sending mailbox (MAIL_SMTP_USER, then MAIL_SMTP_USER_2 and up), on
 * both ports, and sends nothing. Run it after pasting a new app password, and on any new network before a
 * ramp day: on 26 September 2026 Harshil's network could not reach port 587 at all (the IPv6 route was
 * dead) while 465 logged in fine, which is why mail.ts now falls back to 465.
 *
 *   npx tsx scripts/smtp-verify.mts
 */
for (const id of smtpIdentities()) {
  for (const [port, secure] of [[id.port, id.port === 465], [465, true]] as const) {
    const t = nodemailer.createTransport({ host: id.host, port, secure, connectionTimeout: 15000, auth: { user: id.user, pass: id.pass } });
    try { await t.verify(); console.log(id.user + " on " + id.host + ":" + port + ": login ok"); } catch (e) { console.log(id.user + " on " + id.host + ":" + port + ": " + (e as Error).message.slice(0, 70)); }
    if (id.port === 465) break;
  }
}
process.exit(0);

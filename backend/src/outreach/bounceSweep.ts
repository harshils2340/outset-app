import { ImapFlow } from "imapflow";
import { nowIso } from "../db/client.ts";
import { smtpIdentities } from "../lib/mail.ts";
import { recordUnsub } from "../lib/unsub.ts";
import { recordOutreachEvent } from "../lib/outreachLog.ts";
import { pgConfigured, query } from "../db/pg.ts";
import { recordTouch } from "./touches.ts";

/**
 * Reads the bounces out of every sending mailbox and folds them into every record we keep, so a dead address
 * is never mailed again from anywhere and never counted as a send that reached someone.
 *
 * Gmail accepts a message at SMTP time and only learns later that the receiving server refused it (Harshil,
 * 27 September 2026, forwarded one: "550 Please turn on SMTP Authentication in your mail client ... is not
 * permitted to relay through this server without authentication", the recipient's own server misconfigured).
 * The refusal comes back as a Delivery Status Notification into the mailbox that sent it. Each one is signed
 * by Gmail's mailer-daemon and names the address in an X-Failed-Recipients header, so this logs in to each
 * mailbox over IMAP with the same app password the sender uses, collects those, and for every dead address:
 * puts it on the suppression list with reason 'bounce' (the list every sender and the claim mail read), records
 * the event in the API's funnel log, and marks it bounced in the shared outreach record. The caller adds
 * whatever local marking its own disk needs (scripts/bounces.mts marks the laptop's SQLite draft failed).
 * Re-running is safe; every step is idempotent. A delay notice, where Gmail is still retrying, is left alone.
 */
export type Bounce = { email: string; mailbox: string; reason: string; at: string };

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export async function collectBounces(days: number): Promise<Bounce[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const ids = smtpIdentities();
  const own = new Set(ids.map((i) => i.user.toLowerCase()));
  const found = new Map<string, Bounce>();
  for (const id of ids) {
    const host = id.host === "smtp.gmail.com" ? "imap.gmail.com" : id.host.replace(/^smtp\./, "imap.");
    const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: id.user, pass: id.pass }, logger: false });
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        // imapflow answers `false` for a search it could not run; nothing found and nothing readable read the same here.
        const uids = (await client.search({ from: "mailer-daemon", since }, { uid: true })) || [];
        let n = 0;
        for await (const msg of client.fetch(uids, { uid: true, envelope: true, headers: ["x-failed-recipients", "subject"], bodyParts: ["1"] }, { uid: true })) {
          const headers = msg.headers?.toString("utf8") || "";
          const subject = msg.envelope?.subject || "";
          const body = msg.bodyParts?.get("1")?.toString("utf8") || "";
          if (/delay/i.test(subject) && !/\b5\d\d[ -]/.test(body)) continue;
          const failedHeader = /x-failed-recipients:\s*(.+)/i.exec(headers)?.[1] || "";
          const candidates = (failedHeader.match(EMAIL) || body.match(EMAIL) || []).map((e) => e.toLowerCase()).filter((e) => !own.has(e) && !/mailer-daemon|google\.com$|googlemail\.com$/.test(e));
          const reason = (/\b5\d\d[ -][\s\S]{0,140}/.exec(body)?.[0] || subject || "bounce").replace(/\s+/g, " ").trim().slice(0, 160);
          const at = msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : nowIso();
          for (const email of new Set(candidates)) {
            if (!found.has(email)) found.set(email, { email, mailbox: id.user, reason, at });
            n++;
          }
        }
        console.log(`${id.user}: ${uids.length} bounce notice(s) in the last ${days} days, ${n} failed address(es)`);
      } finally {
        lock.release();
      }
    } catch (e) {
      console.error(`${id.user}: could not read bounces: ${(e as Error).message.slice(0, 120)}`);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
  return [...found.values()];
}

/**
 * Suppress a dead address everywhere. `operatorIds` are the businesses it belongs to when the caller knows
 * them from its own disk; otherwise the published pool is asked, and an address nobody has on record is
 * still suppressed under its own name.
 */
export async function suppressBounce(b: Bounce, operatorIds: string[] = []): Promise<void> {
  await recordUnsub(b.email, "bounce");
  await recordOutreachEvent(b.email, "bounce", b.at);
  let ids = operatorIds;
  if (!ids.length && pgConfigured()) {
    try {
      ids = (await query<{ operator_id: string }>("select operator_id from outreach_pool where email = $1", [b.email])).map((r) => r.operator_id);
    } catch {
      ids = [];
    }
  }
  if (!ids.length) ids = ["unknown:" + b.email];
  for (const id of ids) await recordTouch({ operatorId: id, email: b.email, status: "bounce", mailbox: b.mailbox, at: b.at }).catch(() => undefined);
}

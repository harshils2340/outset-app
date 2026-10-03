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
 * Replies to the Otto pitch, read from every sending mailbox (and from the inbox hello@onoutset.com forwards
 * into, which keeps the original sender). The 2 October copy promises 'Reply "no" and I won't email again',
 * so any human reply from an address or company domain we mailed stops every further send to that business,
 * whatever it says: the resend and any later touch both skip a 'replied' business. Out-of-office and other
 * automatic answers do not count, since nobody chose to stop anything; they are returned flagged so the log
 * still shows them. Free-mail domains match on the full address only, never the domain.
 */
export type Reply = { from: string; mailbox: string; subject: string; at: string; operatorIds: string[]; auto: boolean; snippet: string; redirect: string | null };

const AUTO_SUBJECT = /^(automatic reply|auto(matic)?[- ]?(reply|response)|out of (the )?office|away|we regret to inform|thank you for (your )?(email|contacting|reaching)|undeliverable|delivery status|forwarding e-?mail)/i;

// Only phrases a person answering the pitch would not write. Two real auto-replies came back as ordinary
// "Re:" mail with none of the auto headers (Ocean Obsession, 29 September: "This email doesn't get checked
// often"; Commisso Estate Winery, 1 October: "this domain will be removed ... Please forward your email to"),
// and both were reported to Harshil as replies. A missed human reply costs more than a false alarm, so softer
// lines a person might type ("I will get back to you soon") are deliberately left out.
const AUTO_BODY = /doesn['’]?t get (checked|read|monitored)|(is|isn['’]?t|not) (being )?(regularly |frequently |often )?(checked|monitored)|no longer (in use|monitored|active|being monitored)|will be (removed|discontinued|deactivated|shut down)|(please )?(forward|re-?send|redirect) your (e-?mail|message)|this is an automated|auto(matic|mated)?[- ]?(reply|response|responder)|out of (the )?office|i am (currently )?(away|out of|on (vacation|leave|holiday))/i;

/** Text of a fetched body part: base64 and quoted-printable decoded, html stripped. */
export function bodyText(raw: string): string {
  let s = raw;
  const compact = s.replace(/\s+/g, "");
  if (compact.length >= 24 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    s = Buffer.from(compact, "base64").toString("utf8");
  } else if (/=\r?\n|=[0-9A-F]{2}/.test(s)) {
    s = Buffer.from(s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
  }
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** The part of a reply the sender wrote, before the quoted original. */
function newPart(text: string): string {
  return text.split(/-{2,}\s*original message|^on .{0,120}wrote:|^from: |_{8,}/im)[0];
}

/**
 * Whether a message is automatic, and the address it points to instead when it names one: the better contact
 * an unread inbox hands off to ("please email: Mirela..."), which is worth more than the address we wrote to.
 */
export function classifyReply(m: { from: string; subject: string; headers: string; body: string; own: Set<string> }): { auto: boolean; redirect: string | null; text: string } {
  const text = newPart(bodyText(m.body)).replace(/\s+/g, " ").trim();
  const byHeader = /auto-submitted:\s*auto-(replied|generated)|x-autoreply|x-autorespond|precedence:\s*(auto_reply|bulk|junk)/.test(m.headers.toLowerCase());
  const auto = byHeader || AUTO_SUBJECT.test(m.subject) || (text.length < 700 && AUTO_BODY.test(text));
  const redirect = auto
    ? (text.match(EMAIL) || []).map((e) => e.toLowerCase()).find((e) => e !== m.from && !m.own.has(e) && !e.endsWith("@onoutset.com") && !/no-?reply|donotreply|mailer-daemon/.test(e)) || null
    : null;
  return { auto, redirect, text };
}

export async function collectReplies(days: number, index: { byEmail: Map<string, Set<string>>; byDomain: Map<string, Set<string>> }): Promise<Reply[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const ids = smtpIdentities();
  const own = new Set(ids.map((i) => i.user.toLowerCase()));
  const out: Reply[] = [];
  for (const id of ids) {
    const host = id.host === "smtp.gmail.com" ? "imap.gmail.com" : id.host.replace(/^smtp\./, "imap.");
    const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: id.user, pass: id.pass }, logger: false });
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uids = (await client.search({ since }, { uid: true })) || [];
        for await (const msg of client.fetch(uids, { uid: true, envelope: true, headers: ["auto-submitted", "x-autoreply", "x-autorespond", "precedence"], bodyParts: ["1"] }, { uid: true })) {
          const from = (msg.envelope?.from?.[0]?.address || "").toLowerCase();
          if (!from || own.has(from) || /mailer-daemon|postmaster/.test(from)) continue;
          const domain = from.split("@")[1] || "";
          const ops = index.byEmail.get(from) || index.byDomain.get(domain);
          if (!ops) continue;
          const subject = msg.envelope?.subject || "";
          const c = classifyReply({ from, subject, headers: msg.headers?.toString("utf8") || "", body: msg.bodyParts?.get("1")?.toString("utf8") || "", own });
          out.push({ from, mailbox: id.user, subject, at: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : nowIso(), operatorIds: [...ops], auto: c.auto, snippet: c.text.slice(0, 400), redirect: c.redirect });
        }
      } finally {
        lock.release();
      }
    } catch (e) {
      console.error(`${id.user}: could not read replies: ${(e as Error).message.slice(0, 120)}`);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
  return out;
}

/**
 * An automatic reply that names a better contact: hand the business to Harshil (status 'handoff', which every
 * send and the resend skip) so no follow-up goes to an inbox that told us it is unread or going away.
 */
export async function markRedirect(r: Reply): Promise<void> {
  for (const op of r.operatorIds) await recordTouch({ operatorId: op, email: r.from, status: "handoff", mailbox: r.mailbox, at: r.at }).catch(() => undefined);
}

/** Mark a human reply on every business it belongs to, so nothing more is ever sent to them. */
export async function markReplied(r: Reply): Promise<void> {
  for (const op of r.operatorIds) await recordTouch({ operatorId: op, email: r.from, status: "replied", mailbox: r.mailbox, at: r.at }).catch(() => undefined);
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

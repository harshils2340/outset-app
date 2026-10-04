import nodemailer from "nodemailer";
import { setDefaultResultOrder } from "node:dns";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { maskEmail } from "./claimIndex.ts";

/**
 * Sign-in codes and booking mail go through Resend as hello@onoutset.com.
 * Claim outreach goes through Gmail SMTP when MAIL_SMTP_USER / MAIL_SMTP_PASS are set,
 * so it looks like a person writing, not a brand blast. Gmail still picks the tab.
 * Unsubscribe stays in the body. Bulk List-Unsubscribe headers are what Gmail files as Promotions.
 */
// Gmail's SMTP host resolves to IPv6 first, and on a network with no IPv6 route the connect fails outright
// ("connect EHOSTUNREACH 2607:f8b0:...:587", 26 September 2026) instead of falling back. Prefer IPv4.
setDefaultResultOrder("ipv4first");

const RESEND_FROM = process.env.MAIL_FROM || "Harshil <hello@onoutset.com>";
const SMTP_USER = (process.env.MAIL_SMTP_USER || "").trim();
const SMTP_PASS = (process.env.MAIL_SMTP_PASS || "").trim();
const SMTP_FROM = process.env.MAIL_SMTP_FROM || (SMTP_USER ? "Harshil <" + SMTP_USER + ">" : "");

export type SmtpIdentity = { user: string; pass: string; from: string; host: string; port: number };

/**
 * Every mailbox cold mail may go from. MAIL_SMTP_USER / MAIL_SMTP_PASS is the first; MAIL_SMTP_USER_2 /
 * MAIL_SMTP_PASS_2 up to _MAILBOX_LIMIT add more (Harshil's other accounts, 26 September 2026), each sending as
 * "Harshil <that address>". Gmail on 587 unless MAIL_SMTP_HOST_n / MAIL_SMTP_PORT_n say otherwise, so a
 * mailbox on another provider (a university's mailservices host, say) sits beside the Gmail ones. One
 * personal mailbox is good for about 50 cold mails a day, so the way past 50 is more mailboxes, each warmed
 * and capped on its own (otto-ramp.mts), never one mailbox pushed harder. Raised from 9 to 20 on 29 September
 * 2026 when Harshil planned to add a 10th: pick a ceiling with headroom rather than raising it again on the
 * next mailbox added.
 */
const MAILBOX_LIMIT = 20;
export function smtpIdentities(env: Record<string, string | undefined> = process.env): SmtpIdentity[] {
  const out: SmtpIdentity[] = [];
  const u1 = (env.MAIL_SMTP_USER || "").trim();
  const p1 = (env.MAIL_SMTP_PASS || "").trim();
  if (u1 && p1) {
    out.push({ user: u1, pass: p1, from: env.MAIL_SMTP_FROM || "Harshil <" + u1 + ">", host: (env.MAIL_SMTP_HOST || "smtp.gmail.com").trim(), port: Number(env.MAIL_SMTP_PORT || 587) });
  }
  for (let i = 2; i <= MAILBOX_LIMIT; i++) {
    const u = (env["MAIL_SMTP_USER_" + i] || "").trim();
    const p = (env["MAIL_SMTP_PASS_" + i] || "").trim();
    if (u && p && !out.some((o) => o.user === u)) {
      out.push({ user: u, pass: p, from: "Harshil <" + u + ">", host: (env["MAIL_SMTP_HOST_" + i] || "smtp.gmail.com").trim(), port: Number(env["MAIL_SMTP_PORT_" + i] || 587) });
    }
  }
  return out;
}

/**
 * A raw newline in a header value is how header injection works: an extra Bcc or Cc line, a spoofed From, a
 * whole second message smuggled into one send. `subject` and `replyTo` can carry a crawled (and sometimes
 * hacked) operator's own name straight from the catalog, or a guest's own booking-form input, so neither is
 * trusted text by the time it reaches here, whatever protection Resend's JSON body or nodemailer's own header
 * composer already happens to have. Folds a run of CR/LF into one space rather than rejecting the whole send
 * over a formatting character in a field that is not itself the address.
 */
function sanitizeHeaderText(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}
/** No whitespace (a folded or embedded newline included), no `<`/`>` (a display-name wrapper is not a bare address), one @, one dot after it. */
const BARE_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export async function sendMail(msg: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  commercial?: boolean;
  /** Files to attach (a CSV export to the founder, for instance). Never used on guest or operator mail. */
  attachments?: MailAttachment[];
  /** Which sending mailbox (its address) a commercial mail goes from; the first configured one when unset. */
  via?: string;
  /** The Message-ID this mail answers, so a follow-up sits in the same thread as the first email. */
  inReplyTo?: string;
}): Promise<{ sent: boolean; id?: string; error?: string; via?: string }> {
  const to = sanitizeHeaderText(msg.to);
  if (!BARE_EMAIL.test(to)) return { sent: false, error: "bad address" };
  // A malformed reply-to (an injection attempt, a guest's typo) is worth losing, not worth losing the whole
  // mail over: dropped silently, same as if the caller had never set one.
  const replyToRaw = msg.replyTo ? sanitizeHeaderText(msg.replyTo) : undefined;
  const replyTo = replyToRaw && BARE_EMAIL.test(replyToRaw) ? replyToRaw : undefined;
  // A Message-ID is one <token>, nothing else: anything wider could carry a second header.
  const inReplyTo = msg.inReplyTo && /^<[^\s<>]+@[^\s<>]+>$/.test(msg.inReplyTo.trim()) ? msg.inReplyTo.trim() : undefined;
  const clean = { ...msg, subject: sanitizeHeaderText(msg.subject).slice(0, 300), replyTo, inReplyTo };
  if (msg.commercial) {
    const ids = smtpIdentities();
    const id = msg.via ? ids.find((i) => i.user === msg.via) : ids[0];
    if (msg.via && !id) return { sent: false, error: "no such sending mailbox: " + msg.via };
    if (id) return sendSmtp(to, clean, id);
  }
  return sendResend(to, clean);
}

export type MailAttachment = { filename: string; content: Buffer | string; contentType?: string };

async function sendSmtp(
  to: string,
  msg: { subject: string; text: string; html?: string; replyTo?: string; attachments?: MailAttachment[]; inReplyTo?: string },
  id: SmtpIdentity = smtpIdentities()[0],
): Promise<{ sent: boolean; id?: string; error?: string; via?: string }> {
  if (!id) return { sent: false, error: "no sending mailbox configured" };
  // The mailbox's own port first, and on a network that cannot reach it (a timeout or no route, not a refusal
  // from the server) once more on 465, which some networks and VPNs leave open when they block 587.
  const port = id.port;
  try {
    return await smtpOnce(to, msg, id, port, port === 465);
  } catch (e) {
    const err = (e as Error).message;
    if (port === 587 && /ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|ECONNRESET/.test(err)) {
      try {
        return await smtpOnce(to, msg, id, 465, true);
      } catch (e2) {
        return { sent: false, error: err + "; on 465: " + (e2 as Error).message, via: id.user };
      }
    }
    return { sent: false, error: err, via: id.user };
  }
}

async function smtpOnce(
  to: string,
  msg: { subject: string; text: string; html?: string; replyTo?: string; attachments?: MailAttachment[]; inReplyTo?: string },
  id: SmtpIdentity,
  port: number,
  secure: boolean,
): Promise<{ sent: boolean; id?: string; error?: string; via?: string }> {
  {
    const transport = nodemailer.createTransport({
      host: id.host,
      port,
      secure,
      connectionTimeout: 20_000,
      auth: { user: id.user, pass: id.pass },
    });
    const info = await transport.sendMail({
      from: id.from || id.user,
      to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
      replyTo: msg.replyTo || process.env.MAIL_REPLY_TO || "hello@onoutset.com",
      ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo, references: msg.inReplyTo } : {}),
    });
    return { sent: true, id: String(info.messageId || "smtp"), via: id.user };
  }
}

async function sendResend(
  to: string,
  msg: { subject: string; text: string; html?: string; replyTo?: string; commercial?: boolean; attachments?: MailAttachment[] },
): Promise<{ sent: boolean; id?: string; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    // The subject of a sign-in mail is the code itself and the body of a claim mail is a working claim link, so
    // with no mail key this used to write "sign in as any operator" into the server log. Only the shape is logged.
    const secret = /sign-in code|claim link/i.test(msg.subject);
    console.log(`[mail:dry] to=${maskEmail(to)} subject=${JSON.stringify(secret ? msg.subject.replace(/[0-9]{4,}/g, "******") : msg.subject)}${secret ? ` (${msg.text.length} chars, body withheld)` : "\n" + msg.text}\n`);
    dumpMail(to, msg);
    return { sent: false, error: "no mail key" };
  }
  // No List-Unsubscribe headers on outreach. The body already has a stop link.
  // Those headers are a bulk/marketing signal and push Gmail into Promotions.
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + process.env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        reply_to: msg.replyTo,
        ...(msg.attachments?.length
          ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64"), content_type: a.contentType })) }
          : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { sent: false, error: "resend " + res.status + " " + (await res.text()).slice(0, 200) };
    const j = (await res.json()) as { id?: string };
    return { sent: true, id: j.id };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

/**
 * With MAIL_DUMP_DIR set (the local end-to-end harness does), every email that would have been sent is also
 * written there as .html and .txt, so a person or a screenshot can check how it reads before it goes to anyone.
 */
let dumped = 0;
function dumpMail(to: string, msg: { subject: string; text: string; html?: string }): void {
  const dir = (process.env.MAIL_DUMP_DIR || "").trim();
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const stem = String(++dumped).padStart(3, "0") + "-" + msg.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    writeFileSync(join(dir, stem + ".txt"), `To: ${to}\nSubject: ${msg.subject}\n\n${msg.text}`);
    if (msg.html) writeFileSync(join(dir, stem + ".html"), msg.html);
  } catch (e) {
    console.error("[mail] dump failed: " + (e as Error).message);
  }
}

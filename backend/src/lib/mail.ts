import nodemailer from "nodemailer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { maskEmail } from "./claimIndex.ts";

/**
 * Sign-in codes and booking mail go through Resend as hello@onoutset.com.
 * Claim outreach goes through Gmail SMTP when MAIL_SMTP_USER / MAIL_SMTP_PASS are set,
 * so it looks like a person writing, not a brand blast. Gmail still picks the tab.
 * Unsubscribe stays in the body. Bulk List-Unsubscribe headers are what Gmail files as Promotions.
 */
const RESEND_FROM = process.env.MAIL_FROM || "Harshil <hello@onoutset.com>";
const SMTP_USER = (process.env.MAIL_SMTP_USER || "").trim();
const SMTP_PASS = (process.env.MAIL_SMTP_PASS || "").trim();
const SMTP_FROM = process.env.MAIL_SMTP_FROM || (SMTP_USER ? "Harshil <" + SMTP_USER + ">" : "");

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
}): Promise<{ sent: boolean; id?: string; error?: string }> {
  const to = sanitizeHeaderText(msg.to);
  if (!BARE_EMAIL.test(to)) return { sent: false, error: "bad address" };
  // A malformed reply-to (an injection attempt, a guest's typo) is worth losing, not worth losing the whole
  // mail over: dropped silently, same as if the caller had never set one.
  const replyToRaw = msg.replyTo ? sanitizeHeaderText(msg.replyTo) : undefined;
  const replyTo = replyToRaw && BARE_EMAIL.test(replyToRaw) ? replyToRaw : undefined;
  const clean = { ...msg, subject: sanitizeHeaderText(msg.subject).slice(0, 300), replyTo };
  if (msg.commercial && SMTP_USER && SMTP_PASS) return sendSmtp(to, clean);
  return sendResend(to, clean);
}

async function sendSmtp(
  to: string,
  msg: { subject: string; text: string; html?: string; replyTo?: string },
): Promise<{ sent: boolean; id?: string; error?: string }> {
  try {
    const transport = nodemailer.createTransport({
      host: process.env.MAIL_SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.MAIL_SMTP_PORT || 587),
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    const info = await transport.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
      replyTo: msg.replyTo || process.env.MAIL_REPLY_TO || "hello@onoutset.com",
    });
    return { sent: true, id: String(info.messageId || "smtp") };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

async function sendResend(
  to: string,
  msg: { subject: string; text: string; html?: string; replyTo?: string; commercial?: boolean },
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

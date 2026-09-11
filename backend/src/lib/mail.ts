import nodemailer from "nodemailer";

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

export async function sendMail(msg: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  commercial?: boolean;
}): Promise<{ sent: boolean; id?: string; error?: string }> {
  const to = msg.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { sent: false, error: "bad address" };
  if (msg.commercial && SMTP_USER && SMTP_PASS) return sendSmtp(to, msg);
  return sendResend(to, msg);
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
      html: msg.html,
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
    console.log(`[mail:dry] to=${to} subject=${JSON.stringify(msg.subject)}\n${msg.text}\n`);
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

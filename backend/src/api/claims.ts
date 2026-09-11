import { Hono } from "hono";
import { ID, clientIp, rateLimit } from "./auth.ts";
import { claimToken } from "../lib/claim.ts";
import { claimRule, emailMayClaim, maskEmail } from "../lib/claimIndex.ts";
import { sendMail } from "../lib/mail.ts";
import { readJson } from "../lib/store.ts";

/**
 * Claiming from the operator site. The owner finds their listing, types the address on their website (or one
 * at their domain), and the signed claim link goes to that inbox and nowhere else. Anyone else gets told which
 * address to use. The link itself is the same stateless one the outreach emails carry, so nothing has to be
 * remembered between the request and the click; the owner's name and phone ride along in the link.
 */

const SITE = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/");
const SUPPORT = process.env.MAIL_REPLY_TO || "hello@onoutset.com";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const claims = new Hono();

/** What the claim screen shows before the owner types: which address the link can go to. */
claims.get("/claims/:id/rule", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const r = await claimRule(id);
  return c.json({ known: r.known, hasEmail: r.hasEmail, hint: r.hint, domains: r.domains });
});

/** The owner asks for their claim link. It goes only to the address on their site or one at their domain. */
claims.post("/claims/:id/request", rateLimit(10, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; name?: string; phone?: string };
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  const name = String(body.name || "").trim().slice(0, 120);
  const phone = String(body.phone || "").trim().slice(0, 40);
  if (!EMAIL.test(email)) return c.json({ error: "enter a valid email" }, 400);

  const { ok, rule } = await emailMayClaim(id, email);
  if (!ok) {
    const reason = !rule.known ? "unknown" : rule.hasEmail || rule.domains.length ? "mismatch" : "none";
    console.log(`[claim] ${id}: ${reason} for ${maskEmail(email)} from ${clientIp(c)}`);
    return c.json({ ok: false, reason, hint: rule.hint, domains: rule.domains });
  }

  const item = await readJson<{ title?: string }>(`o/${id}.json`).catch(() => null);
  const title = item?.title || "your business";
  const owner = Buffer.from(JSON.stringify({ n: name, e: email, p: phone })).toString("base64url");
  const link = `${SITE}#claim=${id}&k=${claimToken(id)}&o=${owner}`;
  const text = [
    `Hi ${name || "there"},`,
    "",
    `Here is the link that opens the Outset dashboard for ${title}. It is only for the owner, so please do not forward it:`,
    link,
    "",
    "It opens with no code. Check your prices and photos, set your hours, and switch bookings on when you are ready.",
    "",
    `If you did not ask for this, ignore this email and nothing changes. Questions: ${SUPPORT}`,
    "",
    "Harshil",
    "Outset",
  ].join("\n");
  const r = await sendMail({ to: email, subject: `Your Outset claim link for ${title}`, text, replyTo: process.env.MAIL_REPLY_TO || undefined });
  console.log(`[claim] ${id}: link for ${maskEmail(email)} from ${clientIp(c)} ${r.sent ? "sent " + r.id : "not sent (" + r.error + ")"}`);
  return c.json({ ok: true, sent: r.sent, to: maskEmail(email) });
});

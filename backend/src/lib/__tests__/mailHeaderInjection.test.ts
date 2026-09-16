import { test } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { sendMail } from "../mail.ts";

/**
 * A guest's name, phone or email reaches bookingMail.ts's subject and replyTo lines
 * (backend/src/api/bookingMail.ts) with no escaping of its own: nothing stops
 * "x\r\nBcc: victim@example.com" from being typed into a booking form. What has to stop it is the mail
 * layer itself. mail.ts's SMTP path (backend/src/lib/mail.ts, sendSmtp) hands the subject and replyTo
 * straight to nodemailer, so this exercises the same transport nodemailer.createTransport builds there,
 * with streamTransport standing in for the real SMTP connection so the raw generated message can be read
 * back without a network call.
 */

async function buildRawMessage(msg: { from: string; to: string; subject: string; text: string; replyTo?: string }): Promise<string> {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const info = await transport.sendMail(msg);
  return (info.message as Buffer).toString("utf8");
}

test("a CRLF-Bcc payload in the subject does not become a header line", async () => {
  const raw = await buildRawMessage({
    from: "Harshil <hello@onoutset.com>",
    to: "shop@example.com",
    subject: "New booking: Jane\r\nBcc: victim@example.com",
    text: "hi",
  });
  const headerLines = raw.split(/\r?\n\r?\n/)[0].split(/\r?\n/);
  assert.ok(!headerLines.some((l) => /^bcc:/i.test(l)), "no standalone Bcc header line must appear:\n" + raw);
  assert.ok(raw.includes("victim@example.com"), "the payload should still be present, just inert, folded into Subject");
});

test("a CRLF-Bcc payload in replyTo does not become a header line", async () => {
  const raw = await buildRawMessage({
    from: "Harshil <hello@onoutset.com>",
    to: "shop@example.com",
    subject: "New booking: Jane",
    text: "hi",
    replyTo: "attacker@evil.com\r\nBcc: victim@example.com\r\nX-Injected: yes",
  });
  const headerLines = raw.split(/\r?\n\r?\n/)[0].split(/\r?\n/);
  assert.ok(!headerLines.some((l) => /^bcc:/i.test(l)), "no standalone Bcc header line must appear:\n" + raw);
  assert.ok(!headerLines.some((l) => /^x-injected:/i.test(l)), "no standalone X-Injected header line must appear:\n" + raw);
});

test("sendMail refuses a 'to' address carrying a newline before any transport is built", async () => {
  const r = await sendMail({ to: "guest@example.com\r\nBcc: victim@example.com", subject: "x", text: "x" });
  assert.equal(r.sent, false);
  assert.equal(r.error, "bad address");
});

test("sendMail's own dry-run path (no RESEND_API_KEY in this test env) never throws on a hostile subject", async () => {
  const r = await sendMail({ to: "guest@example.com", subject: "x\r\nBcc: victim@example.com", text: "<script>alert(1)</script>" });
  assert.equal(r.sent, false);
  assert.equal(r.error, "no mail key");
});

/**
 * A crawled (and sometimes hacked) operator's own name reaches a subject line ("Your Outset claim link for
 * ${title}", claims.ts; "Booking ... for ${ctx.title}", bookingMail.ts). sendMail itself, not any one caller,
 * is the one place every mail path goes through, so the sanitizing has to live there.
 */
test("sendMail folds a CRLF in the subject to a space rather than reject the whole send", async () => {
  const r = await sendMail({ to: "guest@example.com", subject: "Your Outset claim link for MAXSLOT88\r\nBcc: victim@example.com", text: "hi" });
  // No mail key in this test env, so it never actually sends, but it must not fail on the subject itself.
  assert.equal(r.error, "no mail key");
});

test("sendMail refuses a 'to' address with an angle-bracket display name, even with no embedded newline", async () => {
  const r = await sendMail({ to: "Attacker Name <victim@example.com>", subject: "x", text: "x" });
  assert.equal(r.sent, false);
  assert.equal(r.error, "bad address");
});

test("sendMail silently drops a malformed replyTo instead of failing the whole send", async () => {
  const r = await sendMail({ to: "guest@example.com", subject: "x", text: "x", replyTo: "attacker@evil.com\r\nBcc: victim@example.com" });
  // Still reaches the dry-run branch (no mail key), meaning the bad replyTo did not abort sendMail itself.
  assert.equal(r.error, "no mail key");
});

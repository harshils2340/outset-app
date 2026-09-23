import "../src/env.ts";
import { composeOutreach } from "../src/outreach/drafts.ts";
import { sendMail } from "../src/lib/mail.ts";
import { db } from "../src/db/client.ts";

const domain = process.argv[2];
if (!domain) {
  console.error("Usage: npx tsx scripts/_thin-sample.mts <domain>");
  process.exit(1);
}
const op = db.prepare("SELECT * FROM operators WHERE domain = ?").get(domain);
if (!op) {
  console.error("no operator with domain " + domain);
  process.exit(1);
}
const c = composeOutreach(op as never, "harshils2340@gmail.com");
const r = await sendMail({ to: "harshils2340@gmail.com", subject: c.subject, text: c.body, html: c.html, replyTo: process.env.MAIL_REPLY_TO, commercial: true });
console.log(r.sent ? "sent " + r.id : "failed: " + r.error);
process.exit(0);

import "../src/env.ts";
import { sendMail } from "../src/lib/mail.ts";

const name = "Newport Landing Whale Watching";
const body = `Hi,

I'm Harshil, I run Outset, an instant-booking marketplace for local activities across the US and Canada: https://onoutset.com

If you're open to it, we'll build a page for ${name} from your own site, your photos, services, and prices, and send it to you before anything goes live. Nothing gets published without your OK, and you can edit or take down anything on it, any time.

Want to see how easy that editing is first? Try a live sandbox listing here. It's not your business, nothing you touch there is saved anywhere but your own browser:
https://onoutset.com/operators#demo

If you'd like us to build yours, just reply and we'll send it over.

Best,
Harshil`;

const r = await sendMail({
  to: "harshils2340@gmail.com",
  subject: "Want a free Outset page for " + name + "? Your call.",
  text: body,
  replyTo: process.env.MAIL_REPLY_TO,
  commercial: true,
});
console.log(r.sent ? "sent " + r.id : "failed: " + r.error);
process.exit(0);

import "../src/env.ts";
import { sendMail } from "../src/lib/mail.ts";
import { mailPostal, unsubPageUrl } from "../src/lib/unsub.ts";

const SITE = "https://onoutset.com/";
const TERMS = SITE + "terms.html";
const PRIVACY = SITE + "privacy.html";
const TAGLINE = "Instant booking for local activities.";
const name = "Newport Landing Whale Watching";
const to = "harshils2340@gmail.com";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function link(href: string, label: string): string {
  return "<a href=\"" + esc(href) + "\">" + esc(label) + "</a>";
}

const who = "I'm Harshil, the founder of Outset, an instant-booking marketplace for local activities across the US and Canada.";
const browse = "Take a look: " + SITE;
const offer = "We can build " + name + " a complete page, your photos, services and prices, all set up and ready to go, for free. We just need your OK to do it.";
const trySample = "Want to see how easy it is first? Here's a sample listing you can click around and edit yourself, so you can see exactly how simple it is to set up:";
const demoUrl = SITE + "operators#demo";
// The real number, not a guess: about 52,000 businesses already on the catalog. No claimed-operator count,
// no revenue lift, no booking total - none of those are real yet, and a fabricated one already went out
// once tonight (Capt. Dave's "over 15,000 bookings"). This is the only stat that's actually true right now.
const scale = "You'd be joining about 52,000 other real local businesses already on Outset across the US and Canada, and more join every week.";
const cta = "Just reply \"yes\" and I'll have it built and sent to you today.";
const stop = unsubPageUrl(to);
const postal = mailPostal();

const lines = [
  "Hi,", "", who, browse, "", offer, "", trySample, demoUrl, "", scale, cta, "", "Best,", "Harshil",
  "", "Outset — " + TAGLINE,
  "", TERMS, PRIVACY, "If you'd rather not get emails like this: " + stop,
];
if (postal) lines.push(postal);

const paras = [
  "<p>Hi,</p>",
  "<p>" + esc(who) + "<br>" + link(SITE, "Take a look") + "</p>",
  "<p>" + esc(offer) + "</p>",
  "<p>" + esc(trySample) + "<br>" + link(demoUrl, "See a sample listing") + "</p>",
  "<p>" + esc(scale) + "<br>" + esc(cta) + "</p>",
  "<p>Best,<br>Harshil</p>",
  '<p style="margin-top:24px;padding-top:16px;border-top:1px solid #e3e3e3;font-size:13px;color:#666">' +
    '<img src="' + SITE + 'apple-touch-icon.png" width="28" height="28" alt="Outset" style="border-radius:8px;vertical-align:middle;margin-right:8px">' +
    '<b style="color:#222;font-size:14px">Outset</b> <span style="color:#888">— ' + esc(TAGLINE) + "</span><br>" +
    link(TERMS, "Terms") + " &nbsp;·&nbsp; " + link(PRIVACY, "Privacy") + " &nbsp;·&nbsp; " + link(stop, "Unsubscribe") +
    (postal ? "<br>" + esc(postal) : "") + "</p>",
];

const body = lines.join("\n");
const html = '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#222">' + paras.join("") + "</div>";

const r = await sendMail({ to, subject: "Can I build " + name + " a free booking page?", text: body, html, replyTo: process.env.MAIL_REPLY_TO, commercial: true });
console.log(r.sent ? "sent " + r.id : "failed: " + r.error);
console.log("\n---plain text---\n" + body);
process.exit(0);

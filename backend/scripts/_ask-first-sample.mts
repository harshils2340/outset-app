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
const ask = "If you're open to it, I'd like to build a page for " + name + " from your own site, your photos, services and prices, and send it to you before anything goes live.";
const control = "Nothing gets published without your OK, and you can edit or take anything down, any time.";
const howHead = "How it works:";
const bullets = [
  { label: "No cost", text: "free to build, free to list. We only take 5% when a booking actually happens." },
  { label: "You approve first", text: "we send you the finished page before it's public. Say no and nothing goes live." },
  { label: "Try it yourself", text: "a live sandbox listing you can edit right now. Not your business, nothing saved beyond your own browser." },
];
const demoUrl = SITE + "operators#demo";
const cta = "Want us to build yours? Just reply and we'll send it over.";
const stop = unsubPageUrl(to);
const postal = mailPostal();

const lines = [
  "Hi,", "", who, "", ask, control, "", howHead, "",
  ...bullets.map((b, i) => "• " + b.label + ": " + b.text + (i === 2 ? "\n  " + demoUrl : "")),
  "", cta, "", "Best,", "Harshil",
  "", "Outset — " + TAGLINE,
  "", TERMS, PRIVACY, "If you'd rather not get emails like this: " + stop,
];
if (postal) lines.push(postal);

const paras = [
  "<p>Hi,</p>",
  "<p>" + esc(who) + "</p>",
  "<p>" + esc(ask) + "<br>" + esc(control) + "</p>",
  "<p><b>" + esc(howHead) + "</b></p>",
  "<ul>" + bullets.map((b, i) => "<li><b>" + esc(b.label) + ":</b> " + esc(b.text) + (i === 2 ? " " + link(demoUrl, "Try the sandbox") : "") + "</li>").join("") + "</ul>",
  "<p>" + esc(cta) + "</p>",
  "<p>Best,<br>Harshil</p>",
  '<p style="margin-top:24px;padding-top:16px;border-top:1px solid #e3e3e3;font-size:13px;color:#666">' +
    '<img src="' + SITE + 'apple-touch-icon.png" width="28" height="28" alt="Outset" style="border-radius:8px;vertical-align:middle;margin-right:8px">' +
    '<b style="color:#222;font-size:14px">Outset</b> <span style="color:#888">— ' + esc(TAGLINE) + "</span><br>" +
    link(TERMS, "Terms") + " &nbsp;·&nbsp; " + link(PRIVACY, "Privacy") + " &nbsp;·&nbsp; " + link(stop, "Unsubscribe") +
    (postal ? "<br>" + esc(postal) : "") + "</p>",
];

const body = lines.join("\n");
const html = '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#222">' + paras.join("") + "</div>";

const r = await sendMail({ to, subject: "Want a free Outset page for " + name + "? Your call.", text: body, html, replyTo: process.env.MAIL_REPLY_TO, commercial: true });
console.log(r.sent ? "sent " + r.id : "failed: " + r.error);
console.log("\n---plain text---\n" + body);
process.exit(0);

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail } from "../emailTemplate.ts";

/**
 * Every value in an EmailInput starts as a guest's name or note, an operator's title or address, or a
 * crawled catalog field: hostile input by the same rule as anything the site renders. The HTML half goes
 * to a real inbox that will render it as markup, so a name of "<script>alert(1)</script>" or
 * '"><img src=x onerror=alert(1)>' must never survive as a live tag or a broken-out attribute.
 */

test("a script tag in a guest name is escaped, not executed, in the HTML part", () => {
  const { html } = renderEmail({
    heading: "Jane <script>alert(1)</script> booked Kayak Tour",
    intro: ["<b>bold</b> note from the guest"],
    rows: [{ label: "Guest", value: '"><script>alert(document.cookie)</script>' }],
  });
  assert.ok(!/<script>alert/i.test(html), "a live script tag must not appear");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;b&gt;bold&lt;/b&gt;"));
  assert.ok(html.includes("&quot;&gt;&lt;script&gt;alert(document.cookie)&lt;/script&gt;"));
});

test("an attribute break-out attempt in a row value cannot reach a real attribute", () => {
  const { html } = renderEmail({
    heading: "Booking",
    intro: ["ok"],
    rows: [{ label: '"><img src=x onerror=alert(1)>', value: "fine" }],
  });
  assert.ok(!/<img/i.test(html), "an injected img tag must not appear");
  assert.ok(html.includes("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"));
});

test("a cta url and label are escaped the same way as any other field", () => {
  const { html } = renderEmail({
    heading: "Booking",
    intro: ["ok"],
    cta: { label: '"><script>alert(1)</script>', url: "https://onoutset.com/#o=abc" },
  });
  assert.ok(!/<script>alert/i.test(html));
  assert.ok(html.includes(`href="https://onoutset.com/#o=abc"`));
});

test("the plain-text part carries the same content with no markup to escape", () => {
  const { text } = renderEmail({
    heading: "Jane <script>alert(1)</script> booked Kayak Tour",
    intro: ["hello"],
  });
  // text/plain is never rendered as HTML by a mail client, so the raw characters are fine here;
  // the guarantee that matters is that the HTML half (tested above) never carries them unescaped.
  assert.ok(text.includes("Jane <script>alert(1)</script> booked Kayak Tour"));
});

/**
 * Every email Outset sends is built here: the sign-in code, the claim link, the three booking emails, the
 * accept and decline notes, the outreach pitch and the Otto pitch. The document said what language it was in
 * nowhere, while `index.html`, the two static page generators, the unsubscribe page and the founder's own
 * sessions window all name `lang="en"`. With no language declared a mail client falls back to the reader's
 * own system language: a screen reader reads an English confirmation in a French or German voice, and Outlook
 * and Gmail offer to translate a message that is already in the reader's language.
 */
test("the email names the language it is written in", () => {
  const { html } = renderEmail({ heading: "You're booked", intro: ["See you Saturday."] });
  assert.match(html, /^<!doctype html><html lang="en">/);
  assert.ok(!/<html>/.test(html), "no copy of the tag may go out without the attribute");
});

test("the language is named on every shape of email this template draws", () => {
  const shapes = [
    { heading: "Your code is 123456", intro: ["Type it on the sign-in screen."] },
    { eyebrow: "Sign in", heading: "Claim Bayside Jet Ski", intro: ["Open the dashboard."], cta: { label: "Open", url: "https://example.com" } },
    { heading: "New booking", intro: ["Jane booked."], rows: [{ label: "When", value: "Sat, Oct 10 at 2:00 PM" }], lines: [{ label: "Total", amount: "$120.00", total: true }], priceNote: "Charged to your card.", after: ["Reply to reach them."], footer: "Outset" },
  ];
  for (const e of shapes) assert.match(renderEmail(e).html, /<html lang="en">/);
});

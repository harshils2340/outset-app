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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Set before claim.ts is loaded, so claimSecret() never writes backend/data/claim-secret.txt from a test run.
process.env.CLAIM_SECRET ||= "unsub-test-secret";
const { unsub } = await import("../unsub.ts");
const { unsubToken } = await import("../../lib/unsub.ts");

/**
 * Opening the unsubscribe link is not the same as asking to be unsubscribed.
 *
 * GET used to take the address off the list on the load, which is the same mistake the claim link made until
 * 22 September 2026, when a link-safety scanner claimed a real listing by opening its URL. Every mail client
 * of that kind (Outlook Safe Links, Gmail's, corporate gateways) opens every link in an incoming email before
 * the recipient reads it, and here the damage is silent: the shop lands on the suppression list, no outreach
 * ever reaches it again, and neither side learns why. The same load is what a recipient clicking to see what
 * the link says gets.
 *
 * So the GET asks and the POST acts. The POST is deliberately unchanged, because Gmail one-click and the
 * site's own unsubscribe page both go through it, and one click is all CAN-SPAM and CASL ask for.
 *
 * Nothing here needs a database: the GET path no longer reaches one, which is the point.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../unsub.ts"), "utf8");

const body = async (res: Response) => (await res.text()).replace(/\s+/g, " ");

test("opening the unsubscribe link asks rather than unsubscribing", async () => {
  const res = await unsub.request("/unsubscribe?t=" + encodeURIComponent(unsubToken("owner@shop.example")));
  assert.equal(res.status, 200);
  const html = await body(res);
  assert.match(html, /owner@shop\.example/, "the page does not say which address goes off the list");
  assert.match(html, /<form method="post"/, "there is no button, so the GET must still be doing the work");
  assert.doesNotMatch(html, /You are unsubscribed/, "the load reports the address as already off the list");
});

test("the GET handler cannot record an unsubscribe at all", () => {
  const start = src.indexOf('unsub.get("/unsubscribe"');
  assert.ok(start > -1, "the unsubscribe page route is gone");
  const handler = src.slice(start, src.indexOf("\n});", start));
  assert.doesNotMatch(handler, /apply\(|recordUnsub\(/, "the GET route records an unsubscribe on a page load again");
  // The POST is the one that acts, and it has to keep acting: it is Gmail's one-click endpoint.
  const post = src.slice(src.indexOf('unsub.post("/unsubscribe"'));
  assert.match(post.slice(0, post.indexOf("\n});")), /apply\(/, "the POST no longer records the unsubscribe");
});

test("a link with no usable token says so instead of showing a button", async () => {
  for (const q of ["", "?t=", "?t=nonsense", "?t=" + encodeURIComponent(unsubToken("owner@shop.example")) + "x"]) {
    const res = await unsub.request("/unsubscribe" + q);
    assert.equal(res.status, 400, "GET /unsubscribe" + q + " answered " + res.status);
    const html = await body(res);
    assert.match(html, /not valid/, "GET /unsubscribe" + q + " does not say the link is dead");
    assert.doesNotMatch(html, /<form/, "GET /unsubscribe" + q + " offers a button for a token it cannot read");
  }
});

test("the address and the token are escaped into the page", async () => {
  // The token carries the address as base64, so a crafted one decodes to whatever it likes.
  const nasty = 'a"><script>alert(1)</script>@shop.example';
  const res = await unsub.request("/unsubscribe?t=" + encodeURIComponent(unsubToken(nasty)));
  assert.equal(res.status, 200);
  const html = await body(res);
  assert.doesNotMatch(html, /<script>alert/, "the address is written into the page as markup");
  assert.match(html, /&lt;script&gt;/, "the address is not on the page at all any more");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { outreachBlockers, publicHttpsLink, type OutreachChecks } from "../guards.ts";

/**
 * Outreach is a commercial email to a business that never asked for one, so every one of these is a legal
 * or a reputational hole, not a nicety: mailing someone who opted out, a dead unsubscribe link, no postal
 * address. The send path reads the environment once and asks this.
 */

const ready: OutreachChecks = {
  claimSecret: "c0ffee".repeat(8),
  mailFrom: "Harshil <hello@onoutset.com>",
  postal: "Outset, PO Box 12, Toronto ON",
  unsubUrl: "https://onoutset.com/unsubscribe.html?t=abc.def",
  suppression: { fromDb: true, fromApi: true },
};

test("a fully configured send has nothing in its way", () => {
  assert.deepEqual(outreachBlockers(ready), []);
});

test("the API answering with the list is enough on a machine with no database", () => {
  assert.deepEqual(outreachBlockers({ ...ready, suppression: { fromDb: false, fromApi: true, error: "DATABASE_URL is not set" } }), []);
});

test("the database alone is enough when the API cannot be reached", () => {
  assert.deepEqual(outreachBlockers({ ...ready, suppression: { fromDb: true, fromApi: false, error: "fetch failed" } }), []);
});

/**
 * The one that would have mailed everybody. The local SQLite copy is empty on the machine that sends, so a
 * failed read is not "nobody has unsubscribed", it is "I do not know", and the difference is every person
 * who ever asked us to stop.
 */
test("a suppression list nobody could read stops the send, and says why", () => {
  const b = outreachBlockers({ ...ready, suppression: { fromDb: false, fromApi: false, error: "fetch failed" } });
  assert.equal(b.length, 1);
  assert.match(b[0], /unsubscribe list could not be read/);
  assert.match(b[0], /fetch failed/);
});

test("an unset CLAIM_SECRET stops the send, because every link in the mail would be dead", () => {
  for (const secret of ["", "   "]) {
    const b = outreachBlockers({ ...ready, claimSecret: secret });
    assert.equal(b.length, 1, JSON.stringify(secret));
    assert.match(b[0], /CLAIM_SECRET/);
  }
});

test("an unsubscribe link pointing at the laptop stops the send", () => {
  const b = outreachBlockers({ ...ready, unsubUrl: "http://localhost:5173/unsubscribe.html?t=abc.def" });
  assert.equal(b.length, 1);
  assert.match(b[0], /localhost/);
  assert.match(b[0], /SITE_URL/);
});

test("the postal address and the sending address are still checked, with the words they always used", () => {
  assert.match(outreachBlockers({ ...ready, postal: "" })[0], /^Set MAIL_POSTAL to a PO box/);
  assert.match(outreachBlockers({ ...ready, mailFrom: "Outset <onboarding@resend.dev>" })[0], /^MAIL_FROM is still the Resend test address/);
  assert.deepEqual(outreachBlockers({ ...ready, mailFrom: "hello@onoutset.com" }), []);
});

test("nothing configured at all reports every reason, not just the first", () => {
  const b = outreachBlockers({ claimSecret: "", mailFrom: "", postal: "", unsubUrl: "", suppression: { fromDb: false, fromApi: false } });
  assert.equal(b.length, 5);
});

test("a link is only a link if a stranger can open it", () => {
  for (const url of ["https://onoutset.com/unsubscribe.html?t=a.b", "https://www.onoutset.com/unsubscribe.html"]) {
    assert.equal(publicHttpsLink(url), true, url);
  }
  for (const url of ["", "not a url", "http://onoutset.com/x", "https://localhost/x", "https://localhost:5173/x", "https://outset.local/x", "https://192.168.1.4/x", "https://[::1]/x", "https://outset/x"]) {
    assert.equal(publicHttpsLink(url), false, url);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { maskEmail } from "../../lib/claimIndex.ts";

/**
 * What this API writes into its own logs about a person.
 *
 * Render keeps them, the founder reads them, and a support export carries them further. Every line in the
 * API that names a mailbox already ran it through `maskEmail` but one: the Resend suppression webhook, which
 * is the whole account's and not outreach's alone, so a guest's booking confirmation that bounces or that
 * they mark as spam arrives there too. The first letter and the domain are what a rising count is read by;
 * the rest of a person's address is not.
 */

const dir = new URL("../", import.meta.url);
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts"));

/** The names this API holds a mailbox under, as the routes themselves spell them. */
const MAILBOX = /\$\{(?:maskEmail\()?\s*([A-Za-z_.?[\]]*\b(?:email|Email|address|toEmail|recipient)\b[A-Za-z_.?[\]]*)/g;

test("no log line in the API prints a mailbox in clear", () => {
  for (const f of sources) {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const line of src.split("\n")) {
      if (!/console\.(log|warn|error)\(/.test(line)) continue;
      for (const m of line.matchAll(MAILBOX)) {
        assert.match(m[0], /maskEmail\(/, `${f}: a log line prints ${m[1]} unmasked`);
      }
    }
  }
});

test("the suppression webhook masks the address it says it suppressed", () => {
  const src = readFileSync(new URL("webhooks.ts", dir), "utf8");
  assert.match(src, /suppressed \$\{maskEmail\(address\)\}/, "the bounce and complaint line is masked");
  // What the mask leaves: the first letter and the whole domain, which is what a rising count is read by.
  assert.equal(maskEmail("Harshil.S@gmail.com"), "h...@gmail.com");
  assert.equal(maskEmail("bookings@tampajetski.com"), "b...@tampajetski.com");
});

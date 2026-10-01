import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * "An affiliate row is never an operator: no claim link, no outreach, no Instant Book, no request, no Otto"
 * (backend/AGENTS.md). POST /bookings and the voice routes already refuse one. The claim link, which is the
 * first item on that list, did not.
 *
 * Every one of the 6,492 shipped partner rows carries `src: "viator.com"` and no row in claim-index.json, so
 * claimRule fell through to the detail file and read that src as a domain the business owns. Any address at
 * viator.com could therefore have a signed claim link mailed to it for any partner product and trade it at
 * /claims/:id/exchange for an operator session over a listing whose photos, prices and copy are licensed from
 * the partner and are not ours to let anyone edit.
 *
 * STORE_DIR points the catalog reader at a throwaway folder, and the refusal happens before the route reaches
 * Postgres or any mail transport, so this runs with no database.
 */

process.env.CLAIM_SECRET ||= "affiliate-claim-test-secret";
// readJson takes the GitHub API path for anything STORE_DIR does not hold while a token is set; these files
// are all in STORE_DIR, and an unset token keeps a missing one a local miss rather than a network call.
delete process.env.GITHUB_TOKEN;
const dir = mkdtempSync(join(tmpdir(), "outset-affiliate-claim-"));
mkdirSync(join(dir, "o"), { recursive: true });
writeFileSync(
  join(dir, "o", "a-viator-t1.json"),
  JSON.stringify({
    title: "Tampa Bay Dolphin Cruise",
    area: "Tampa, FL",
    src: "viator.com",
    affiliate: { source: "viator", label: "Viator", url: "https://www.viator.com/tours/Tampa/x/d123-T1?pid=P1" },
  }),
);
writeFileSync(
  join(dir, "o", "a-tiqets-t2.json"),
  JSON.stringify({ title: "Salvador Dali Museum entry", area: "St Petersburg, FL", src: "tiqets.com", affiliate: { source: "tiqets", label: "Tiqets", url: "https://www.tiqets.com/x" } }),
);
// An ordinary unclaimed operator, which the same fallback path serves: it must keep working exactly as before.
writeFileSync(join(dir, "o", "o-sunsetwatersports-com.json"), JSON.stringify({ title: "Sunset Watersports", area: "Clearwater, FL", src: "https://sunsetwatersports.com/" }));
process.env.STORE_DIR = dir;

const { claimRule, emailMayClaim } = await import("../../lib/claimIndex.ts");
const { claims } = await import("../claims.ts");

const request = (id: string, email: string) =>
  claims.request(`/claims/${id}/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name: "Sam Owner", phone: "813 555 0111" }),
  });

test("a partner's product names its partner and is claimable by nobody", async () => {
  const rule = await claimRule("a-viator-t1");
  assert.equal(rule.partner, "Viator");
  assert.deepEqual(rule.domains, []);
  // The address that used to pass: viator.com read out of `src` as a domain the business owns.
  assert.equal((await emailMayClaim("a-viator-t1", "anyone@viator.com")).ok, false);
  assert.equal((await emailMayClaim("a-viator-t1", "anyone@www.viator.com")).ok, false);
});

test("the claim route refuses a partner's product and says where it is booked", async () => {
  const res = await request("a-viator-t1", "anyone@viator.com");
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error?: string }).error, "This experience is booked on Viator, not on Outset");
});

test("the partner named is the one on the listing, not a hardcoded one", async () => {
  const res = await request("a-tiqets-t2", "anyone@tiqets.com");
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error?: string }).error, "This experience is booked on Tiqets, not on Outset");
});

test("the claim screen's own rule read says which partner, so it can say so before anyone types", async () => {
  const res = await claims.request("/claims/a-viator-t1/rule");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { known: boolean; domains: string[]; partner: string | null };
  assert.equal(body.partner, "Viator");
  assert.equal(body.known, true);
  assert.deepEqual(body.domains, []);
});

test("an ordinary operator still claims from its own domain", async () => {
  const rule = await claimRule("o-sunsetwatersports-com");
  assert.equal(rule.partner, null);
  assert.deepEqual(rule.domains, ["sunsetwatersports.com"]);
  assert.equal((await emailMayClaim("o-sunsetwatersports-com", "owner@sunsetwatersports.com")).ok, true);
  assert.equal((await emailMayClaim("o-sunsetwatersports-com", "owner@gmail.com")).ok, false);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));

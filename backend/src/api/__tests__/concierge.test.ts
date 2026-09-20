import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The two concierge routes, driven as a caller reaches them.
 *
 * Both are public and both are dearer than they look: one question fans out into a handful of requests to
 * somebody else's booking provider. Every other public route in this API is counted per caller, and these two
 * were not, so a stranger could point our server at a vendor and we would pay for it in reputation.
 *
 * The catalog is a scratch file with the real schema and no rows in it, so nothing here reaches the network:
 * with nothing to shortlist the route answers with a question back, which is the path worth counting anyway.
 */

process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-concierge-api-")), "catalog.db");
process.env.CLAIM_SECRET = process.env.CLAIM_SECRET || "test-secret-for-the-concierge-routes";
const { migrate } = await import("../../db/client.ts");
migrate();
const { concierge } = await import("../concierge.ts");

const ask = (body: unknown) =>
  concierge.request("/concierge/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify(body),
  });

test("an empty question is refused before anything is searched", async () => {
  const r = await ask({ text: "   " });
  assert.equal(r.status, 400);
  const long = await ask({ text: "x".repeat(301) });
  assert.equal(long.status, 400);
});

test("a sentence with nothing to search on gets a question back, not an empty screen", async () => {
  const r = await ask({ text: "something fun" });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { followUp: string | null; options: unknown[]; counts: { total: number } };
  assert.ok(body.followUp && body.followUp.length > 10);
  assert.deepEqual(body.options, []);
  assert.equal(body.counts.total, 0);
});

test("the number of shops to ask cannot be turned into a negative", async () => {
  /**
   * `ask` is handed to Array.slice, which reads a negative count from the end: -5 dropped the shops we can
   * actually quote instead of asking fewer of them.
   */
  const r = await ask({ text: "escape room in kitchener ontario", ask: -5 });
  assert.equal(r.status, 200);
  const huge = await ask({ text: "escape room in kitchener ontario", ask: 9999 });
  assert.equal(huge.status, 200);
});

test("the route is counted per caller, like every other public one", async () => {
  // The four above are already on the count for this address, so the ceiling arrives 56 questions from here.
  let sawLimit = false;
  for (let i = 0; i < 70; i += 1) {
    const r = await ask({ text: "something fun" });
    if (r.status === 429) {
      sawLimit = true;
      assert.equal(i < 60, true, "the ceiling should be sixty an hour, not fewer");
      break;
    }
  }
  assert.ok(sawLimit, "an uncounted route lets a stranger point our server at a booking vendor");
});

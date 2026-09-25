import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Unclaimed } from "../../data/types";
import { currentDeals } from "../companyAgent";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The guest app's real type check, and the one line it caught.
 *
 * `npm run build` starts with `tsc -b`, and `tsc -b` is the only command that type-checks this side: the root
 * `tsconfig.json` has `"files": []` and two references, so `tsc --noEmit -p .` compiles nothing at all and
 * answers clean whatever is broken. Two errors shipped on 25 September behind that silence, an unused import
 * and `zoneFor`'s null reaching a parameter that took `string | undefined`, and the site could not be built
 * from `main` for three hours. The unit suite is the cheapest place to notice next time.
 */
test("the guest app type-checks the way its own build does", () => {
  execFileSync("npx", ["tsc", "-b"], { cwd: ROOT, stdio: "pipe" });
});

/** The behaviour behind the second error: a shop whose area names no region we know has no time zone at all. */
test("a shop with no time zone still has its deal window read", () => {
  const item = {
    id: "o-x",
    title: "X",
    area: "Somewhere Odd",
    promos: [{ text: "20% off tours during the months of July and August", days: [1, 2], title: "20% off tours" }],
  } as unknown as Unclaimed;
  assert.equal(currentDeals(item, new Date("2026-07-15T12:00:00Z")).length, 1);
  assert.equal(currentDeals(item, new Date("2026-09-25T12:00:00Z")).length, 0);
});

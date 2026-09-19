import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * "Show N places", on the two modals that print it.
 *
 * The Filters modal counted what its own range left. The Where, when and who modal counted `base`, the pool
 * the filters count from, which is the list before the price range is applied. So with a range set the two
 * buttons sat on one page at one moment and promised different numbers: driven in a browser, Filters said
 * "Show 90 places" and Where, when and who said "Show 828", and the page drew 90.
 *
 * Both now count the list the page will actually draw.
 */

// The rehearsal runs these from `backend/`, so the path is read from this file rather than the shell.
const home = readFileSync(new URL("../../components/web/WebHome.tsx", import.meta.url), "utf8");

test("the refine modal promises the list the page draws", () => {
  assert.match(home, /const shownCount = \(gridList \?\? searchList \?\? base\)\.length;/);
  assert.match(home, /Show \{shownCount\.toLocaleString\(\)\} \{shownCount === 1 \? "place" : "places"\}/);
  // The old count must not come back: `base` is the pool before the price range.
  assert.equal(home.includes("Show {base.length.toLocaleString()}"), false);
});

test("the Filters modal still counts inside its own range", () => {
  // Its draft range is applied to the published prices, which is what makes the two agree.
  assert.match(home, /const matches = range\.min == null && range\.max == null \? total : sortedPrices\.filter/);
});

test("the price filter is what the two counts have to agree about", () => {
  // Both lists the refine modal can now be counting are filtered by price; that is the whole fix.
  assert.match(home, /const gridList = useMemo\(\(\) => \{[\s\S]*?base\.filter\(inPrice\)/);
  assert.match(home, /const searchList = useMemo\(\(\) => \{[\s\S]*?pool\.filter\(inPrice\)/);
});

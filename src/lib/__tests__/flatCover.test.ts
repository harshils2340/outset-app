import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * A cover that loads and shows nothing.
 *
 * `lib/deadCovers.ts` is the rule: browse promises a photograph, so a listing whose cover will not load leaves
 * every grid rather than standing there with a generated illustration. Both listing surfaces probe their
 * photos at thumbnail size and refuse two kinds, a URL that does not answer and a picture that is flat, and
 * only the first ever reached that store, through `Photo`'s `onBroken`. The second loads perfectly, so the
 * grids kept the listing and drew a white rectangle. Driving this needs real images over the network, which
 * this routine has none of, so these read the source: they fail if either surface stops reporting it.
 */

const surfaces: [string, string][] = [
  ["the desktop listing", "../../components/web/WebListing.tsx"],
  ["the phone booking sheet", "../../components/booking/Sheets.tsx"],
];

for (const [name, path] of surfaces) {
  const src = readFileSync(new URL(path, import.meta.url), "utf8");

  test(`${name} reports a cover its own probe refused`, () => {
    assert.match(src, /import \{ reportDeadCover(?:, [^}]+)? \} from "\.\.\/\.\.\/lib\/deadCovers"/, "the store is imported");
    const drop = src.slice(src.indexOf("const drop = (src: string)"));
    const body = drop.slice(0, drop.indexOf("\n  const media"));
    assert.match(body, /if \(src === item\.cover\) reportDeadCover\(item\.id\)/, "a refused cover is reported");
    assert.match(body, /setBroken\(/, "and the tile still drops out of this page's own hero");
  });

  test(`${name} hands that same drop to the photo probe`, () => {
    assert.match(src, /probePhotos\([^;]*?, drop\)/, "so a flat cover reaches the report, not only a dead one");
  });
}

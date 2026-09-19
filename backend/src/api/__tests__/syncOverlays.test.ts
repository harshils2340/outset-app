import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Anything that builds the catalog loads the claimed operators' edits first.
 *
 * `overlays` in sync/contacts.ts is module state. `buildCatalogItems` reads it to merge each claimed shop's own
 * menu, hours, photos, prices and policies over the crawled record, and to know that a claimed listing is never
 * dropped by the crawl-quality filters. Nothing forces the order, and a catalog built before the map is filled
 * is a catalog with every operator's work stripped back to whatever a crawler last saw.
 *
 * `npm run sync` gets it right. `POST /contacts/sync` did not, and published that catalog.
 *
 * Read from the source, the way the CORS test does, so no database has to be stood up.
 */

const here = dirname(fileURLToPath(import.meta.url));
const files = [
  { label: "POST /contacts/sync", path: join(here, "../routes.ts") },
  { label: "npm run sync", path: join(here, "../../index.ts") },
];

test("every caller of syncCatalogToApp loads the claimed profiles first", () => {
  for (const { label, path } of files) {
    const src = readFileSync(path, "utf8");
    let searched = false;
    for (const m of src.matchAll(/syncCatalogToApp\(\)/g)) {
      searched = true;
      const before = src.slice(0, m.index);
      assert.match(
        before,
        /loadProfileOverlays\(\)/,
        `${label} calls syncCatalogToApp() with no loadProfileOverlays() before it, so it would publish a catalog with every claimed shop's edits stripped`,
      );
    }
    assert.ok(searched, `${label} no longer calls syncCatalogToApp(); update this test`);
  }
});

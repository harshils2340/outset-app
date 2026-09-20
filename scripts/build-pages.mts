/**
 * The static pages a search engine reads: one per activity and city, and one per listing.
 *
 * These are generated into `dist` during the site build rather than committed. There are about 3,000 city pages
 * and 38,000 listing pages, roughly 270 MB, and every nightly sync rewrites most of them; committing that put
 * 200 MB a week of churn into a repository already carrying the catalog itself, which is why `.git` reached 2.4 GB.
 * The inputs they are built from, public/catalog.json and public/o, are committed, so the build is reproducible
 * and the pages cost the repository nothing.
 *
 * Runs after `vite build`, which has already copied `public` into `dist`. Any failure fails the build: a deploy
 * with no landing pages and no sitemap would quietly drop the whole site out of the index.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeLandingPages, type Item } from "../backend/src/sync/pages.ts";
import { writeListingPages } from "../backend/src/sync/listingPages.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
const t0 = Date.now();

const catalog = JSON.parse(readFileSync(join(root, "public/catalog.json"), "utf8")) as { operators: Item[] };
const browse = catalog.operators.filter((i) => !(i as { unlisted?: boolean }).unlisted);

// The browse catalog carries no menu, hours or policy: the per-listing files do, and the listing pages are made of
// exactly those. A listing whose file is missing keeps whatever the browse record holds.
const detailDir = join(root, "public/o");
const details = new Map<string, Item>();
for (const f of readdirSync(detailDir)) {
  if (!f.endsWith(".json")) continue;
  try {
    const j = JSON.parse(readFileSync(join(detailDir, f), "utf8")) as Item;
    if (j && typeof j.id === "string") details.set(j.id, j);
  } catch {
    /* a half-written file is not worth failing a deploy over */
  }
}
const full = browse.map((i) => ({ ...i, ...(details.get(i.id) || {}) }) as Item);

const landing = writeLandingPages(full, { publicDir: out });
const listings = writeListingPages(full, landing, { publicDir: out });
console.log(
  `pages: ${landing.pages} activity and city (${landing.metroPages} metro, ${landing.cityPages ?? 0} city, ${landing.kindPages} everywhere), ` +
    `${listings.pages} listings, in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
if (!landing.pages || !listings.pages) {
  console.error("build-pages: produced nothing, refusing to ship a site with no indexable pages");
  process.exit(1);
}

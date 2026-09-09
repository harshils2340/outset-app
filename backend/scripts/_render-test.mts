import "../src/env.ts";
import { crawlSite, selectPages, estimateTokens } from "../src/enrich/crawl.ts";
import { buildDoc } from "../src/enrich/extract.ts";
import { closeBrowser } from "../src/scrape/render.ts";
for (const site of ["https://www.bcairboats.com/", "http://www.jumpfloridaskydiving.com/", "https://www.mysteryspot.com/", "http://www.montereywharf.com/"]) {
  const t0 = Date.now();
  const c = await crawlSite(site);
  const pages = selectPages(c.pages);
  console.log(site, "pages", c.pages.length, "kept", pages.length, "tokens", pages.length ? estimateTokens(buildDoc("x", pages)) : 0, "vendor", c.bookingVendor, Math.round((Date.now() - t0) / 1000) + "s");
  if (pages[0]) console.log("   ", pages[0].text.replace(/\n/g, " | ").slice(0, 220));
}
closeBrowser();
process.exit(0);

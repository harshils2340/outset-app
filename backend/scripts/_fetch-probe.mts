import "../src/env.ts";
import { fetchHtml } from "../src/scrape/fetch.ts";
for (const u of ["https://www.bcairboats.com/", "https://texasatvrentals.net/", "https://aaajetski.com/"]) {
  const r = await fetchHtml(u).catch((e) => ({ status: -1, html: String(e), finalUrl: u }));
  console.log(u, r.status, (r.html || "").length);
}

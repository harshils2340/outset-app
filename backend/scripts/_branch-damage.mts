import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { toCatalogItem } from "../src/sync/contacts.ts";
const rows = db.prepare(`SELECT o.id, o.domain, o.name, o.website, o.city, o.region, o.metro_id, o.family, o.icon_key, o.rating, o.review_count, o.origin, o.lat, o.lon FROM operators o WHERE origin!='demo' AND EXISTS (SELECT 1 FROM offerings x WHERE x.operator_id=o.id AND x.price_cents IS NOT NULL) ORDER BY random() LIMIT 1500`).all() as any[];
let withPriceDb = 0, withPriceOut = 0, lostAll = 0; const lost: string[] = [];
for (const r of rows) {
  withPriceDb++;
  const it = toCatalogItem(r) as any;
  const priced = (it.options || []).filter((o: any) => o.price != null).length;
  if (priced) withPriceOut++; else { lostAll++; if (lost.length < 12) lost.push(r.domain + " (" + r.city + ")"); }
}
console.log(`sample ${withPriceDb} operators with priced offerings in DB -> ${withPriceOut} keep a price after build; ${lostAll} lose every price`);
console.log(lost.join("\n"));
process.exit(0);

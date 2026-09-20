import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { toCatalogItem } from "../src/sync/contacts.ts";
const names = ["Ctrl V", "Borkholder", "Griffo", "Breakout Games", "Big Air", "Bowlerama", "Brimming Horn", "Fells Point Surf", "Brandywine Zoo", "Davey"];
for (const n of names) {
  const r = db.prepare("SELECT id, domain, name, website, city, region, metro_id, family, icon_key, rating, review_count, origin, lat, lon FROM operators WHERE name LIKE ? ORDER BY review_count DESC LIMIT 1").get("%" + n + "%") as any;
  if (!r) { console.log(n, "not found"); continue; }
  const before = { off: (db.prepare("SELECT count(*) c FROM offerings WHERE operator_id=?").get(r.id) as any).c, facts: (db.prepare("SELECT count(*) c FROM facts WHERE operator_id=? AND fact_key IN ('requirement','policy','includes','bring','group','spec','meeting_point')").get(r.id) as any).c };
  const it = toCatalogItem(r) as any;
  const after = { off: it.options.length, facts: (it.requirements?.length||0)+(it.policies?.length||0)+(it.includes?.length||0)+(it.bring?.length||0)+(it.groupInfo?.length||0)+(it.highlights?.length||0)+(it.meetingPoint?1:0) };
  console.log(r.name.padEnd(28), r.city, "| offerings", before.off, "->", after.off, "| fact lines", before.facts, "->", after.facts, "|", it.options.slice(0,3).map((o: any) => o.name + " " + (o.price ?? "-") + (o.per || "")).join("; "));
}
process.exit(0);

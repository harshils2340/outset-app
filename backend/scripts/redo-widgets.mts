import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { widgetForOperator } from "../src/enrich/widgets.ts";

/** Re-read every FareHarbor and Xola menu with the fixed price parser. Replaces confidence 'widget' rows only. */
const rows = db
  .prepare(
    `SELECT o.id, o.domain, o.website, f.fact_value AS booking_url FROM operators o
     JOIN facts f ON f.operator_id = o.id AND f.fact_key = 'booking_url'
     WHERE f.fact_value LIKE '%fareharbor.com%' OR f.fact_value LIKE '%xola.%'
     GROUP BY o.id ORDER BY (o.metro_id IS NULL), o.review_count DESC NULLS LAST`,
  )
  .all() as { id: string; domain: string; website: string | null; booking_url: string }[];
let i = 0;
let done = 0;
let offerings = 0;
const worker = async () => {
  while (i < rows.length) {
    const op = rows[i++];
    try {
      const r = await widgetForOperator(op);
      if (r) {
        done += 1;
        offerings += r.offerings;
      }
    } catch (e) {
      console.error(op.domain + ": " + (e as Error).message.slice(0, 80));
    }
    if (i % 200 === 0) console.log(`${i}/${rows.length} re-read, ${done} with menus, ${offerings} offerings`);
  }
};
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`Widgets: ${rows.length} operators re-read, ${done} with menus, ${offerings} offerings.`);
process.exit(0);

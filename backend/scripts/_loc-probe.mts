import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { locationsFromSite } from "../src/enrich/locations.ts";
const op = db.prepare("SELECT id, domain, website, lat, lon, city FROM operators WHERE domain = ?").get(process.argv[2]) as any;
console.log(op?.website);
console.log(await locationsFromSite(op));
console.log(db.prepare("SELECT city, region, street, source FROM locations WHERE operator_id = ? LIMIT 12").all(op.id));

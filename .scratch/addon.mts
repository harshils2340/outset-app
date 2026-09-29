import fs from "node:fs";
import { plainWords } from "../src/lib/catalog.ts";
import { tidyLine } from "../src/lib/listingDerive.ts";
const dir = "/home/user/outset-app/public/o";
let rows = 0, changedName = 0, changedDetail = 0, listings = 0;
const ex: string[] = [], exD: string[] = [];
for (const f of fs.readdirSync(dir)) {
  const j = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
  let any = false;
  for (const a of j.addons || []) {
    rows++;
    const n = String(a.name || "");
    const t = tidyLine(n);
    if (t !== n) { changedName++; any = true; if (ex.length < 40) ex.push(j.id + " | " + JSON.stringify(n) + " -> " + JSON.stringify(t)); }
    const d = a.detail ? String(a.detail) : "";
    if (d && tidyLine(d) !== d) { changedDetail++; if (exD.length < 20) exD.push(j.id + " | " + JSON.stringify(d) + " -> " + JSON.stringify(tidyLine(d))); }
  }
  if (any) listings++;
}
console.log("addon rows:", rows, "listings with a name tidyLine changes:", listings, "names changed:", changedName, "details changed:", changedDetail);
ex.forEach((s) => console.log("  " + s));
console.log("--- details");
exD.forEach((s) => console.log("  " + s));

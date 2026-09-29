import fs from "node:fs";
import { tidyRowName } from "../src/lib/menuRow.ts";
const dir = "/home/user/outset-app/public/o";
let optDetail = 0, varLabel = 0, addonDetail = 0;
const exD: string[] = [], exL: string[] = [];
const seenD = new Set<string>(), seenL = new Set<string>();
for (const f of fs.readdirSync(dir)) {
  const j = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
  for (const o of j.options || []) {
    const d = o.detail;
    if (typeof d === "string" && d && tidyRowName(d) !== d) { optDetail++; if (exD.length < 40 && !seenD.has(j.id)) { seenD.add(j.id); exD.push(j.id + " | " + JSON.stringify(d) + " -> " + JSON.stringify(tidyRowName(d))); } }
  }
  for (const s of j.services || []) for (const v of s.variants || []) {
    const l = v.label;
    if (typeof l === "string" && l && tidyRowName(l) !== l) { varLabel++; if (exL.length < 40 && !seenL.has(j.id)) { seenL.add(j.id); exL.push(j.id + " | " + JSON.stringify(l) + " -> " + JSON.stringify(tidyRowName(l))); } }
  }
  for (const a of j.addons || []) {
    const d = (a as any).detail;
    if (typeof d === "string" && d && tidyRowName(d) !== d) addonDetail++;
  }
}
console.log("option.detail rows changed by tidyRowName:", optDetail);
console.log("variant.label changed:", varLabel);
console.log("addon.detail changed:", addonDetail);
console.log("--- detail examples"); exD.forEach((s) => console.log("  " + s));
console.log("--- label examples"); exL.forEach((s) => console.log("  " + s));

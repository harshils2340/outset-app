import fs from "node:fs";
import { tidyLine } from "../src/lib/listingDerive.ts";
import { tidyRowName } from "../src/lib/menuRow.ts";
const dir = "/home/user/outset-app/public/o";
const bad: string[] = [];
let n = 0;
for (const f of fs.readdirSync(dir)) {
  const j = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
  const look = (kind: string, s: string) => {
    if (!s) return;
    const shown = tidyLine(s);
    const tidied = tidyLine(tidyRowName(s));
    if (shown !== tidied) { n++; bad.push(j.id + " | " + kind + " | shown " + JSON.stringify(shown) + " | would be " + JSON.stringify(tidied)); }
  };
  for (const o of j.options || []) look("option.detail", String(o.detail || ""));
  for (const s of j.services || []) for (const v of s.variants || []) look("variant.label", String(v.label || ""));
}
console.log("sub-lines the surfaces still show untidied:", n);
bad.slice(0, 40).forEach((s) => console.log("  " + s));

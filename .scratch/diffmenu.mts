import fs from "node:fs";
import { bookableMenu } from "../src/lib/menuRow.ts";
const dir = "/home/user/outset-app/public/o";
let changed = 0, shapeChanged = 0, subChanged = 0;
const exShape: string[] = [], exSub: string[] = [];
for (const f of fs.readdirSync(dir)) {
  const raw = fs.readFileSync(dir + "/" + f, "utf8");
  const j = JSON.parse(raw);
  const before = JSON.parse(raw);
  const after: any = bookableMenu(j);
  const shapeOf = (x: any) => JSON.stringify({ o: (x.options || []).map((o: any) => [o.name, o.price]), s: (x.services || []).map((s: any) => [s.name, s.variants.map((v: any) => [v.optionIdx, v.price])]), a: (x.addons || []).map((a: any) => a.name) });
  const subOf = (x: any) => JSON.stringify({ d: (x.options || []).map((o: any) => o.detail || ""), l: (x.services || []).map((s: any) => s.variants.map((v: any) => v.label || "")) });
  // compare against what bookableMenu produced before this change: names only tidy
  const a = shapeOf(after), b = shapeOf(before);
  if (a !== b) { }
  const sa = subOf(after), sb = subOf(before);
  if (sa !== sb) { subChanged++; if (exSub.length < 8) exSub.push(j.id); }
}
console.log("listings whose sub-lines bookableMenu now changes:", subChanged, exSub);

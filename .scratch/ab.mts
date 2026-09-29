import fs from "node:fs";
import { bookableMenu as nu } from "../src/lib/menuRow.ts";
import { bookableMenu as old } from "./menuRowOld.ts";
const dir = "/home/user/outset-app/public/o";
let sub = 0, shape = 0;
const exSub: string[] = [], exShape: string[] = [];
const shapeOf = (x: any) => JSON.stringify({ o: (x.options || []).map((o: any) => [o.name, o.price, o.per ?? null]), s: (x.services || []).map((s: any) => [s.name, (s.variants || []).map((v: any) => [v.optionIdx, v.price, v.moreOptions ?? null])]), a: (x.addons || []).map((a: any) => a.name) });
const subOf = (x: any) => JSON.stringify({ d: (x.options || []).map((o: any) => o.detail || ""), l: (x.services || []).map((s: any) => (s.variants || []).map((v: any) => v.label || "")) });
for (const f of fs.readdirSync(dir)) {
  const raw = fs.readFileSync(dir + "/" + f, "utf8");
  const A: any = old(JSON.parse(raw));
  const B: any = nu(JSON.parse(raw));
  if (shapeOf(A) !== shapeOf(B)) { shape++; if (exShape.length < 12) exShape.push(JSON.parse(raw).id); }
  if (subOf(A) !== subOf(B)) {
    sub++;
    if (exSub.length < 30) {
      const da = JSON.parse(subOf(A)), db = JSON.parse(subOf(B));
      const id = JSON.parse(raw).id;
      da.d.forEach((v: string, i: number) => { if (v !== db.d[i] && exSub.length < 30) exSub.push(id + " | detail " + JSON.stringify(v) + " -> " + JSON.stringify(db.d[i])); });
      da.l.forEach((g: string[], i: number) => g.forEach((v: string, k: number) => { if (v !== db.l[i][k] && exSub.length < 30) exSub.push(id + " | label " + JSON.stringify(v) + " -> " + JSON.stringify(db.l[i][k])); }));
    }
  }
}
console.log("menu shape changed on:", shape, exShape);
console.log("sub-lines changed on listings:", sub);
exSub.forEach((s) => console.log("  " + s));

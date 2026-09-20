import { lookup } from "node:dns/promises";
for (const h of ["aaajetski.com", "www.bcairboats.com"]) {
  try { console.log(h, await lookup(h)); } catch (e) { console.log(h, "ERR", (e as Error).message); }
}

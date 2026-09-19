/**
 * Rewrite public/catalog-lite.json from the catalog already on disk, with no database and no crawl. The nightly
 * sync does this as part of its run; this is for changing how the shard is sampled without waiting for one.
 *
 *   npx tsx scripts/rebuild-lite.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildLiteShard, type LiteRow } from "../src/sync/liteShard.ts";

const full = new URL("../../public/catalog.json", import.meta.url);
const out = new URL("../../public/catalog-lite.json", import.meta.url);
const operators = (JSON.parse(readFileSync(full, "utf8")) as { operators: LiteRow[] }).operators;
const lite = buildLiteShard(operators);
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), operators: lite, contacts: {} }));
const mix = new Map<string, number>();
for (const o of lite) mix.set(String(o.art), (mix.get(String(o.art)) || 0) + 1);
console.log(`catalog-lite.json: ${lite.length} of ${operators.length}`);
console.log([...mix].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, n]) => `${a}:${n}`).join(" "));

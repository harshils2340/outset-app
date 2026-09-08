// One-off repair: structure re-reads used to delete every 'site' fact, photos included.
// The last synced catalog still has each operator's cover and photos, so put them back from there.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client.ts";

type Op = { id: string; src: string; cover?: string; photos?: string[]; video?: string; videoEmbed?: string };
const cat = JSON.parse(readFileSync(new URL("../../public/catalog.json", import.meta.url), "utf8")) as { operators: Op[] };
const byDomain = db.prepare("SELECT id, website FROM operators WHERE domain = ?");
const hasCover = db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = 'cover' LIMIT 1");
const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')");
let restored = 0;
let photos = 0;
const tx = db.transaction(() => {
  for (const o of cat.operators) {
    if (!o.cover) continue;
    const domain = o.src.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
    const row = byDomain.get(domain) as { id: string; website: string | null } | undefined;
    if (!row || hasCover.get(row.id)) continue;
    const src = row.website || "https://" + domain;
    ins.run(randomUUID(), row.id, "cover", o.cover, src);
    for (const p of new Set([o.cover, ...(o.photos || [])])) {
      ins.run(randomUUID(), row.id, "photo", p, src);
      photos += 1;
    }
    restored += 1;
  }
});
tx();
console.log(`restored covers for ${restored} operators, ${photos} photo rows`);

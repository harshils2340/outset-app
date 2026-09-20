import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { toCatalogItem } from "../src/sync/contacts.ts";
const rows = db.prepare(`SELECT o.id, o.domain, o.name, o.website, o.city, o.region, o.metro_id, o.family, o.icon_key, o.rating, o.review_count, o.origin, o.lat, o.lon FROM operators o WHERE origin!='demo' AND EXISTS (SELECT 1 FROM offerings x WHERE x.operator_id=o.id AND x.price_cents IS NOT NULL) ORDER BY o.id LIMIT 1500`).all() as any[];
const why: Record<string, number> = {}; const ex: Record<string, string[]> = {};
for (const r of rows) {
  const it = toCatalogItem(r) as any;
  if ((it.options || []).some((o: any) => o.price != null)) continue;
  const offs = db.prepare("SELECT name, detail, price_cents, source_url FROM offerings WHERE operator_id=? AND price_cents IS NOT NULL").all(r.id) as any[];
  const hosts = new Set(offs.map((o) => { try { return new URL(o.source_url || "").hostname.replace(/^www\./, ""); } catch { return "?"; } }));
  const own = r.domain.replace(/^www\./, "");
  const offDomain = [...hosts].every((h) => h !== own && !h.endsWith("." + own) && !/fareharbor|xola|peek|bookeo|rezdy|checkfront|filestack/.test(h));
  const cheap = offs.every((o) => o.price_cents < 100);
  const merch = /\b(t-?shirt|hoodie|hat|bottle|gift ?card|ml\b|crossbow|arrow|membership|donation)\b/i;
  const allMerch = offs.every((o) => merch.test(o.name + " " + (o.detail || "")));
  const k = offDomain ? "off-domain source (" + [...hosts].slice(0,2).join(",") + ")" : cheap ? "all under $1" : allMerch ? "all merch/spirits" : "other filter";
  const key = k.startsWith("off-domain") ? "off-domain source" : k;
  why[key] = (why[key] || 0) + 1;
  (ex[key] ||= []).length < 4 && ex[key].push(r.domain + ": " + offs.slice(0, 2).map((o) => o.name + " $" + (o.price_cents / 100)).join("; ") + " <" + [...hosts].slice(0, 1) + ">");
}
console.log(why); for (const k of Object.keys(ex)) console.log("== " + k + "\n  " + ex[k].join("\n  "));
process.exit(0);

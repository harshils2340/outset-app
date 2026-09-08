import { load } from "cheerio";
import { fetchHtml } from "../src/scrape/fetch.ts";
const home = await fetchHtml("https://aaajetski.com/");
const $ = load(home.html);
const set = new Set<string>();
$("a[href]").each((_, el) => { try { const u = new URL($(el).attr("href")!, "https://aaajetski.com/"); if (u.hostname.endsWith("aaajetski.com")) set.add(u.origin + u.pathname); } catch {} });
for (const u of set) {
  const r = await fetchHtml(u).catch(() => null);
  if (!r || r.status !== 200) { console.log("FAIL", u); continue; }
  const $$ = load(r.html);
  const ps = $$("p").map((_, n) => $$(n).text().replace(/\s+/g, " ").trim()).get().filter((d) => d.length >= 80);
  console.log(u, "| h1:", $$("h1").first().text().trim().slice(0, 60), "| paras>=80:", ps.length, "| first:", (ps[0] || "").slice(0, 90));
}

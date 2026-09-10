import { randomUUID } from "node:crypto";
import { db, migrate, nowIso } from "../db/client.ts";
import { CATEGORIES, METROS, inferCategory } from "../taxonomy/catalog.ts";
import { TAMPA_UNCLAIMED } from "./tampaUnclaimed.ts";
import { NATIONAL_TARGETS } from "./nationalTargets.ts";
import { refreshAllScores } from "../lib/completeness.ts";

export function seedTaxonomy(): void {
  migrate();
  // Already seeded: skip the writes so a read-only command never waits on another process's lock.
  const have = db.prepare("SELECT (SELECT COUNT(*) FROM metros) AS m, (SELECT COUNT(*) FROM categories) AS c").get() as { m: number; c: number };
  if (have.m >= METROS.length && have.c >= CATEGORIES.length) return;
  const insM = db.prepare(
    "INSERT OR REPLACE INTO metros (id, name, region, country, kind) VALUES (?, ?, ?, ?, ?)",
  );
  for (const m of METROS) insM.run(m.id, m.name, m.region, m.country, m.kind);
  const insC = db.prepare(
    "INSERT OR REPLACE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const c of CATEGORIES) insC.run(c.id, c.family, c.label, c.iconKey, c.serviceStyle, c.searchQuery);
}

export function addTarget(opts: {
  website: string;
  metroId: string;
  name?: string;
  categoryId?: string;
}): string {
  seedTaxonomy();
  const domain = opts.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const site = opts.website.startsWith("http") ? opts.website : "https://" + domain;
  const now = nowIso();
  const cat = opts.categoryId
    ? CATEGORIES.find((c) => c.id === opts.categoryId)
    : inferCategory(opts.name || domain);
  if (!cat) throw new Error("unknown category");
  const metro = METROS.find((m) => m.id === opts.metroId);
  if (!metro) throw new Error("unknown metro");
  db.prepare(
    `INSERT INTO operators (
      id, domain, name, website, metro_id, city, region, country, family, category_id, icon_key,
      claim_status, booking_mode, origin, completeness, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed', 'request', 'public_site', 0, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET updated_at = excluded.updated_at`,
  ).run(
    randomUUID(),
    domain,
    opts.name || domain,
    site,
    metro.id,
    metro.name,
    metro.region,
    metro.country,
    cat.family,
    cat.id,
    cat.iconKey,
    now,
    now,
  );
  const row = db.prepare("SELECT id FROM operators WHERE domain = ?").get(domain) as { id: string };
  return row.id;
}

export function ingestTampaUnclaimed(): number {
  seedTaxonomy();
  const now = nowIso();
  let n = 0;
  for (const u of TAMPA_UNCLAIMED) {
    const domain = u.src.replace(/^www\./, "");
    const cat = CATEGORIES.find((c) => c.id === u.art) || inferCategory([u.title, u.art].join(" "));
    const existing = db.prepare("SELECT id FROM operators WHERE domain = ?").get(domain) as { id: string } | undefined;
    const id = existing?.id || randomUUID();
    db.prepare(
      `INSERT INTO operators (
        id, domain, name, website, metro_id, city, region, country, family, category_id, icon_key,
        claim_status, booking_mode, origin, completeness, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'tampa', ?, 'FL', 'US', ?, ?, ?, 'unclaimed', 'request', 'seed', 0, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET
        name = excluded.name,
        website = excluded.website,
        city = excluded.city,
        family = excluded.family,
        category_id = excluded.category_id,
        icon_key = excluded.icon_key,
        updated_at = excluded.updated_at`,
    ).run(id, domain, u.title, "https://" + domain, u.area, cat.family, cat.id, u.art, now, now);

    const op = db.prepare("SELECT id FROM operators WHERE domain = ?").get(domain) as { id: string };
    db.prepare("DELETE FROM offerings WHERE operator_id = ? AND confidence = 'seed'").run(op.id);
    for (const o of u.options) {
      db.prepare(
        `INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, source_url, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'seed')`,
      ).run(
        randomUUID(),
        op.id,
        o.name,
        o.detail || null,
        o.detail || null,
        o.price == null ? null : Math.round(o.price * 100),
        o.per || "each",
        "https://" + domain,
      );
    }
    db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'seed'").run(op.id);
    for (const spec of u.specs) {
      db.prepare(
        "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'seed')",
      ).run(randomUUID(), op.id, "spec", spec, "https://" + domain);
    }
    for (const inc of u.includes) {
      db.prepare(
        "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'seed')",
      ).run(randomUUID(), op.id, "includes", inc, "https://" + domain);
    }
    db.prepare(
      "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'seed')",
    ).run(randomUUID(), op.id, "published_gap", u.gap, "https://" + domain);
    if (u.extraNote) {
      db.prepare(
        "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'seed')",
      ).run(randomUUID(), op.id, "extra", u.extraNote, "https://" + domain);
    }
    db.prepare(
      "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'tampa-unclaimed-seed', 1, ?)",
    ).run(randomUUID(), op.id, "https://" + domain, now, "Facts copied from the operator site in Sept 2026. Not invented.");
    n += 1;
  }
  refreshAllScores();
  return n;
}

export function ingestNationalTargets(): number {
  let n = 0;
  for (const t of NATIONAL_TARGETS) {
    addTarget({
      website: t.website,
      metroId: t.metroId,
      categoryId: t.categoryId,
      name: t.name,
    });
    n += 1;
  }
  refreshAllScores();
  return n;
}

export function ingestAll(): { tampa: number; national: number } {
  const tampa = ingestTampaUnclaimed();
  const national = ingestNationalTargets();
  return { tampa, national };
}

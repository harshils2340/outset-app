import { randomUUID } from "node:crypto";
import { db } from "../db/client.ts";

type OpRow = {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  category_id: string | null;
  calendar_vendor: string | null;
};

export function scoreOperator(operatorId: string): number {
  const op = db.prepare("SELECT * FROM operators WHERE id = ?").get(operatorId) as OpRow | undefined;
  if (!op) return 0;
  const offerings = db.prepare("SELECT price_cents FROM offerings WHERE operator_id = ?").all(operatorId) as {
    price_cents: number | null;
  }[];
  const facts = db.prepare("SELECT fact_key FROM facts WHERE operator_id = ?").all(operatorId) as { fact_key: string }[];
  const keys = new Set(facts.map((f) => f.fact_key));

  let n = 0;
  if (op.name) n += 10;
  if (op.website) n += 10;
  if (op.city) n += 10;
  if (op.phone) n += 10;
  if (op.email) n += 10;
  if (op.category_id) n += 10;
  if (offerings.length) n += 15;
  if (offerings.some((o) => o.price_cents != null)) n += 10;
  if (keys.has("hours")) n += 5;
  if (op.calendar_vendor) n += 5;
  if (keys.has("description")) n += 5;
  return Math.min(100, n);
}

export function refreshGaps(operatorId: string): string[] {
  const op = db.prepare("SELECT * FROM operators WHERE id = ?").get(operatorId) as OpRow | undefined;
  if (!op) return [];
  const offerings = db.prepare("SELECT price_cents FROM offerings WHERE operator_id = ?").all(operatorId) as {
    price_cents: number | null;
  }[];
  const facts = db.prepare("SELECT fact_key FROM facts WHERE operator_id = ?").all(operatorId) as { fact_key: string }[];
  const keys = new Set(facts.map((f) => f.fact_key));

  const gaps: { field: string; note: string }[] = [];
  if (!op.phone) gaps.push({ field: "phone", note: "No public phone on the site we fetched." });
  if (!op.email) gaps.push({ field: "email", note: "No public booking email. Outreach stays undeliverable until we have one." });
  if (!op.city) gaps.push({ field: "city", note: "City is not in schema.org address or the homepage." });
  if (!offerings.length) gaps.push({ field: "services", note: "No service menu published in JSON-LD or seed facts." });
  if (offerings.length && offerings.every((o) => o.price_cents == null)) {
    gaps.push({ field: "price", note: "Services exist but public prices were not published." });
  }
  if (!keys.has("hours")) gaps.push({ field: "hours", note: "Opening hours are not published." });
  if (!keys.has("weight_limit") && !keys.has("age")) {
    gaps.push({ field: "eligibility", note: "Age, weight, or license rules were not published. Do not invent them." });
  }
  gaps.push({
    field: "availability",
    note: "Live calendar is not claimed. Guests can request info only. Never show open slots.",
  });

  db.prepare("DELETE FROM gaps WHERE operator_id = ?").run(operatorId);
  for (const g of gaps) {
    db.prepare("INSERT INTO gaps (id, operator_id, field, note) VALUES (?, ?, ?, ?)").run(
      randomUUID(),
      operatorId,
      g.field,
      g.note,
    );
  }
  const score = scoreOperator(operatorId);
  db.prepare("UPDATE operators SET completeness = ? WHERE id = ?").run(score, operatorId);
  return gaps.map((g) => g.note);
}

/**
 * Rescore operators. With no argument it walks every row, which on the 140,000-operator catalog is minutes of
 * CPU: the API used to run that twice at boot (once per seed ingest) and took over twelve minutes to answer
 * /health. Ingests pass the ids they touched so boot rescores a few dozen rows, not the whole table.
 */
/**
 * Rescore only what a job could have changed. The full walk over 142,000 operators takes about forty minutes of one
 * core, and a discovery or widget run touches a few hundred rows; those are the ones whose gaps moved.
 */
export function refreshRecentScores(hours = 24): number {
  const ids = db.prepare("SELECT id FROM operators WHERE updated_at > datetime('now', ?) OR created_at > datetime('now', ?)").all("-" + hours + " hours", "-" + hours + " hours") as { id: string }[];
  refreshAllScores(ids.map((r) => r.id));
  return ids.length;
}

export function refreshAllScores(only?: string[]): void {
  const ids = only ? only.map((id) => ({ id })) : (db.prepare("SELECT id FROM operators").all() as { id: string }[]);
  for (const row of ids) refreshGaps(row.id);
}

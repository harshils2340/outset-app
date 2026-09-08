import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const dataDir = join(root, "data");
const dbPath = join(dataDir, "outset.db");

mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath);
// Several commands run at once against this file. Wait for a writer instead of failing with "database is locked".
db.exec("PRAGMA busy_timeout = 15000");

export function migrate(): void {
  const sql = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(sql);
  // Columns added after the first schema. SQLite has no ADD COLUMN IF NOT EXISTS.
  const cols = new Set(
    (db.prepare("PRAGMA table_info(operators)").all() as { name: string }[]).map((c) => c.name),
  );
  for (const [col, type] of [["street","TEXT"],["postal","TEXT"],["hours","TEXT"],["lat","REAL"],["lon","REAL"],["osm_ref","TEXT"]]) {
    if (!cols.has(col)) db.exec(`ALTER TABLE operators ADD COLUMN ${col} ${type}`);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

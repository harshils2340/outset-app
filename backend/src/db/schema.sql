PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metros (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  country TEXT NOT NULL CHECK (country IN ('US', 'CA')),
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  label TEXT NOT NULL,
  icon_key TEXT NOT NULL,
  service_style TEXT NOT NULL,
  search_query TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  street TEXT,
  postal TEXT,
  hours TEXT,
  lat REAL,
  lon REAL,
  osm_ref TEXT,
  metro_id TEXT REFERENCES metros(id),
  city TEXT,
  region TEXT,
  country TEXT CHECK (country IN ('US', 'CA', NULL)),
  family TEXT,
  category_id TEXT REFERENCES categories(id),
  icon_key TEXT NOT NULL,
  claim_status TEXT NOT NULL DEFAULT 'unclaimed',
  booking_mode TEXT NOT NULL DEFAULT 'request',
  origin TEXT NOT NULL,
  calendar_vendor TEXT,
  completeness INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  review_count INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offerings (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  detail TEXT,
  duration TEXT,
  price_cents INTEGER,
  price_unit TEXT,
  currency TEXT DEFAULT 'USD',
  source_url TEXT,
  confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source_url TEXT,
  confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gaps (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  note TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  fetched_at TEXT,
  http_status INTEGER,
  extractor TEXT NOT NULL,
  robots_allowed INTEGER NOT NULL DEFAULT 1,
  note TEXT
);

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id TEXT PRIMARY KEY,
  operator_id TEXT,
  url TEXT NOT NULL,
  metro_id TEXT,
  category_id TEXT,
  status TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS outreach_drafts (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  to_email TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operators_metro ON operators(metro_id);
CREATE INDEX IF NOT EXISTS idx_operators_category ON operators(category_id);
CREATE INDEX IF NOT EXISTS idx_offerings_op ON offerings(operator_id);
CREATE INDEX IF NOT EXISTS idx_facts_op ON facts(operator_id);

-- Every paid extraction call, so the budget cap is enforced across runs and batches.
CREATE TABLE IF NOT EXISTS extract_spend (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  usd REAL NOT NULL DEFAULT 0,
  batch_id TEXT,
  at TEXT NOT NULL
);

-- Extra places an operator runs from. The operators row keeps the primary pin; chains get one row per site here.
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  name TEXT,
  street TEXT,
  city TEXT,
  region TEXT,
  postal TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_locations_operator ON locations(operator_id);

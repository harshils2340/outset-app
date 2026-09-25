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
  created_at TEXT NOT NULL,
  -- 'listing' (the claim-your-free-page pitch) or 'otto' (the AI phone line pitch): two different offers
  -- sharing one table and one Gmail sending identity, so every dedup and generation query must scope by
  -- this column or the two campaigns silently starve or suppress each other.
  kind TEXT NOT NULL DEFAULT 'listing'
);

CREATE TABLE IF NOT EXISTS mail_unsub (
  email_hash TEXT PRIMARY KEY,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operators_metro ON operators(metro_id);
CREATE INDEX IF NOT EXISTS idx_operators_category ON operators(category_id);
-- Discovery matches every incoming place against the operators we already have, by domain, then phone, then the
-- name with a city or a pin. Domain is unique so it was already indexed; the other three were full scans of
-- 142,000 rows with lower() run on every one of them, four times per result. A Google Maps result took about
-- thirty seconds to file, which does not make a full pass slow, it makes it impossible.
CREATE INDEX IF NOT EXISTS idx_operators_phone ON operators(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operators_name_lower ON operators(lower(name));
CREATE INDEX IF NOT EXISTS idx_operators_name_city_lower ON operators(lower(name), lower(city));
-- Every foreign key pointing at operators needs one of these. SQLite checks the children on each parent delete,
-- and without an index that check is a full scan of the child table per row: removing 130,000 rows that had been
-- imported by mistake scanned gaps and outreach_drafts 130,000 times each and ran for over ten minutes before it
-- was given up on.
CREATE INDEX IF NOT EXISTS idx_operators_osm_ref ON operators(osm_ref);
CREATE INDEX IF NOT EXISTS idx_gaps_op ON gaps(operator_id);
CREATE INDEX IF NOT EXISTS idx_outreach_drafts_op ON outreach_drafts(operator_id);
-- Both send queues (send.ts, sendOtto.ts) dedupe by correlated NOT EXISTS on to_email (already sent, handed
-- off). Without this index that is a full scan per candidate row, and the daily ramp's queue query took over
-- two minutes against 20,000 drafts (25 September 2026); with it the same query is instant.
CREATE INDEX IF NOT EXISTS idx_outreach_drafts_to_email ON outreach_drafts(to_email, status);
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

CREATE INDEX IF NOT EXISTS idx_sources_op ON sources(operator_id, extractor);
CREATE INDEX IF NOT EXISTS idx_facts_op_key ON facts(operator_id, fact_key);

-- Affiliate inventory: products a partner API licenses us to display (photos, descriptions, prices) in return
-- for sending the booking to them. Never an operator: no claim link, no outreach, no Instant Book, no slots.
-- Every row is what the API returned, verbatim, with the partner-attributed booking URL it gave us, and
-- `fetched_at` so the sync can honour the licence's content TTL (Viator: under 24 hours) and drop stale rows.
CREATE TABLE IF NOT EXISTS affiliate_products (
  id TEXT PRIMARY KEY,                 -- "a-<source>-<product code>", the catalog id
  source TEXT NOT NULL,                -- 'viator' | 'tiqets' | 'headout' | 'klook'
  product_code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  images TEXT NOT NULL DEFAULT '[]',   -- JSON array of CDN URLs, largest usable variant first
  from_cents INTEGER,
  currency TEXT,
  rating REAL,
  review_count INTEGER,
  duration TEXT,
  destination_id TEXT,
  destination_name TEXT,
  metro_id TEXT REFERENCES metros(id),
  lat REAL,
  lon REAL,
  tags TEXT NOT NULL DEFAULT '[]',     -- JSON array of the partner's tag/category labels
  booking_url TEXT NOT NULL,           -- the partner-attributed link the guest books on
  flags TEXT NOT NULL DEFAULT '[]',    -- JSON: FREE_CANCELLATION, LIKELY_TO_SELL_OUT, ...
  raw TEXT,                            -- the API's own record, for fields the columns do not carry
  fetched_at TEXT NOT NULL,
  UNIQUE (source, product_code)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_metro ON affiliate_products(metro_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_source ON affiliate_products(source, fetched_at);

-- One row per source: where the last incremental pull left off, so a refresh asks only for what changed.
CREATE TABLE IF NOT EXISTS affiliate_sync (
  source TEXT PRIMARY KEY,
  cursor TEXT,
  last_full_at TEXT,
  last_refresh_at TEXT
);

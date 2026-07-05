CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  query_template TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'company',
  companies TEXT NOT NULL DEFAULT '[]',
  product TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]',
  topic_mode TEXT NOT NULL DEFAULT 'exclusive',
  source TEXT NOT NULL,
  domain TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  evidence_level TEXT NOT NULL DEFAULT 'media',
  confidence TEXT NOT NULL DEFAULT 'medium',
  collection_source TEXT NOT NULL DEFAULT 'seed',
  ai_classification TEXT NOT NULL DEFAULT '{}',
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  found_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  logs TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signals_date ON signals (date DESC);
CREATE INDEX IF NOT EXISTS idx_signals_domain ON signals (domain);
CREATE INDEX IF NOT EXISTS idx_collection_runs_started ON collection_runs (started_at DESC);

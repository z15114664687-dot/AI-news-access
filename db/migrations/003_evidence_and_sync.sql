ALTER TABLE signals ADD COLUMN discovered_at TEXT;
ALTER TABLE signals ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE signals ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE signals ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE signals ADD COLUMN reviewed_at TEXT;
ALTER TABLE signals ADD COLUMN reviewed_revision INTEGER;
ALTER TABLE signals ADD COLUMN source_url_override TEXT;
UPDATE signals SET discovered_at = created_at;

CREATE TABLE material_records (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  signal_id TEXT NOT NULL REFERENCES signals(id),
  revision INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 1,
  snapshot_generation TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, external_id)
);
CREATE INDEX idx_material_signal ON material_records(signal_id);
CREATE TABLE material_versions (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, external_id, revision),
  FOREIGN KEY (provider, external_id) REFERENCES material_records(provider, external_id)
);
CREATE TABLE sync_state (
  provider TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'snapshot',
  cursor TEXT,
  next_page TEXT,
  generation TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT,
  lease_token TEXT,
  lease_until TEXT
);
ALTER TABLE reports ADD COLUMN evidence_snapshot TEXT NOT NULL DEFAULT '[]';

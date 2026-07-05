ALTER TABLE signals ADD COLUMN source_key TEXT;

CREATE INDEX IF NOT EXISTS idx_signals_source_key ON signals (source_key);

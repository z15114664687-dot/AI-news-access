ALTER TABLE signals ADD COLUMN topic_override TEXT;
CREATE TABLE topic_judgments (
  input_hash TEXT PRIMARY KEY,
  input_json TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

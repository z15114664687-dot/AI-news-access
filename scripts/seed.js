const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "ai-intel.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), filePath), "utf8"));
}

function migrate() {
  const sql = fs.readFileSync(path.join(process.cwd(), "db", "001_init.sql"), "utf8");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(sql);
}

function seedSources(config) {
  const statement = db.prepare(
    `INSERT INTO sources (name, domain, query_template, enabled)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(domain) DO UPDATE SET
       name = excluded.name,
       query_template = excluded.query_template,
       updated_at = CURRENT_TIMESTAMP`,
  );

  for (const source of config.sources) {
    statement.run(source.name, source.domain, source.query);
  }
}

function seedSignals(signals) {
  const statement = db.prepare(
    `INSERT INTO signals (
      id, date, entity, entity_type, companies, product, title, summary, topics, topic_mode,
      source, domain, url, evidence_level, confidence, collection_source, ai_classification, confirmed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed', ?, 1)
    ON CONFLICT(url) DO UPDATE SET
      date = excluded.date,
      entity = excluded.entity,
      entity_type = excluded.entity_type,
      companies = excluded.companies,
      product = excluded.product,
      title = excluded.title,
      summary = excluded.summary,
      topics = excluded.topics,
      topic_mode = excluded.topic_mode,
      source = excluded.source,
      domain = excluded.domain,
      evidence_level = excluded.evidence_level,
      confidence = excluded.confidence,
      updated_at = CURRENT_TIMESTAMP`,
  );

  for (const signal of signals) {
    statement.run(
      signal.id,
      signal.date,
      signal.entity,
      signal.entityType || "company",
      JSON.stringify(signal.companies || [signal.entity]),
      signal.product || "",
      signal.title,
      signal.summary,
      JSON.stringify(signal.topics || []),
      signal.topicMode || "exclusive",
      signal.source,
      signal.domain,
      signal.url,
      signal.evidenceLevel || "media",
      signal.confidence || "medium",
      JSON.stringify({ method: "seed", topics: signal.topics || [] }),
    );
  }
}

migrate();
const config = readJson("data/collector-config.json");
const signals = readJson("data/signals.json");
seedSources(config);
seedSignals(signals.signals);
db.close();

console.log(`Seeded ${config.sources.length} sources and ${signals.signals.length} signals into ${dbPath}.`);

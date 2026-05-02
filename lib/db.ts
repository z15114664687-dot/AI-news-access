import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { CollectionRun, Signal, SignalFilters, Source } from "./types";

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "ai-intel.db");
const globalForSqlite = globalThis as unknown as { sqliteDb?: Database.Database };

function ensureDataDir() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

function openDatabase() {
  ensureDataDir();
  const database = new Database(dbPath);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  return database;
}

export const db = globalForSqlite.sqliteDb || openDatabase();
if (process.env.NODE_ENV !== "production") globalForSqlite.sqliteDb = db;

export function migrate() {
  const sql = fs.readFileSync(path.join(process.cwd(), "db", "001_init.sql"), "utf8");
  db.exec(sql);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapSignal(row: Record<string, unknown>): Signal {
  return {
    id: String(row.id),
    date: String(row.date),
    entity: String(row.entity),
    entityType: String(row.entity_type),
    companies: parseJson<string[]>(row.companies, []),
    product: String(row.product || ""),
    title: String(row.title),
    summary: String(row.summary),
    topics: parseJson<string[]>(row.topics, []),
    topicMode: String(row.topic_mode),
    source: String(row.source),
    domain: String(row.domain),
    url: String(row.url),
    evidenceLevel: row.evidence_level as Signal["evidenceLevel"],
    confidence: row.confidence as Signal["confidence"],
    collectionSource: String(row.collection_source),
    aiClassification: parseJson<Record<string, unknown>>(row.ai_classification, {}),
    confirmed: Boolean(row.confirmed),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRun(row: Record<string, unknown>): CollectionRun {
  return {
    id: String(row.id),
    status: row.status as CollectionRun["status"],
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    foundCount: Number(row.found_count),
    insertedCount: Number(row.inserted_count),
    skippedCount: Number(row.skipped_count),
    errorCount: Number(row.error_count),
    logs: parseJson<Array<Record<string, unknown>>>(row.logs, []),
  };
}

export async function listSignals(filters: SignalFilters = {}) {
  const rows = db.prepare("SELECT * FROM signals ORDER BY date DESC, updated_at DESC").all() as Array<Record<string, unknown>>;
  return rows.map(mapSignal).filter((signal) => {
    if (filters.company && !signal.companies.includes(filters.company)) return false;
    if (filters.companies?.length && !filters.companies.some((company) => signal.companies.includes(company))) return false;
    if (filters.topic && !signal.topics.includes(filters.topic)) return false;
    if (filters.topics?.length && !filters.topics.some((topic) => signal.topics.includes(topic))) return false;
    if (filters.startDate && signal.date < filters.startDate) return false;
    if (filters.endDate && signal.date > filters.endDate) return false;
    if (filters.query) {
      const query = filters.query.toLowerCase();
      const text = [
        signal.title,
        signal.summary,
        signal.entity,
        signal.product,
        signal.source,
        signal.domain,
        signal.companies.join(" "),
        signal.topics.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  });
}

export async function listSources() {
  const rows = db.prepare("SELECT * FROM sources ORDER BY name ASC").all() as Array<Record<string, unknown>>;
  return rows.map(
    (row): Source => ({
      id: Number(row.id),
      name: String(row.name),
      domain: String(row.domain),
      queryTemplate: String(row.query_template),
      enabled: Boolean(row.enabled),
    }),
  );
}

export async function listCollectionRuns(limit = 20) {
  const rows = db.prepare("SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
  return rows.map(mapRun);
}

export async function findSignalByUrl(url: string) {
  return db.prepare("SELECT id FROM signals WHERE url = ?").get(url) || null;
}

export async function insertSignal(signal: Omit<Signal, "createdAt" | "updatedAt">) {
  db.prepare(
    `INSERT INTO signals (
      id, date, entity, entity_type, companies, product, title, summary, topics, topic_mode,
      source, domain, url, evidence_level, confidence, collection_source, ai_classification, confirmed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    signal.id,
    signal.date,
    signal.entity,
    signal.entityType,
    JSON.stringify(signal.companies),
    signal.product,
    signal.title,
    signal.summary,
    JSON.stringify(signal.topics),
    signal.topicMode,
    signal.source,
    signal.domain,
    signal.url,
    signal.evidenceLevel,
    signal.confidence,
    signal.collectionSource,
    JSON.stringify(signal.aiClassification),
    signal.confirmed ? 1 : 0,
  );
}

export async function createCollectionRun(id: string) {
  db.prepare("INSERT INTO collection_runs (id, status, logs) VALUES (?, 'running', '[]')").run(id);
}

export async function finishCollectionRun(
  id: string,
  status: string,
  stats: { foundCount: number; insertedCount: number; skippedCount: number; errorCount: number; logs: Array<Record<string, unknown>> },
) {
  db.prepare(
    `UPDATE collection_runs
     SET status = ?, finished_at = CURRENT_TIMESTAMP, found_count = ?, inserted_count = ?, skipped_count = ?, error_count = ?, logs = ?
     WHERE id = ?`,
  ).run(status, stats.foundCount, stats.insertedCount, stats.skippedCount, stats.errorCount, JSON.stringify(stats.logs), id);
}

export async function saveReport(id: string, title: string, markdown: string, filters: SignalFilters) {
  db.prepare("INSERT INTO reports (id, title, markdown, filters) VALUES (?, ?, ?, ?)").run(
    id,
    title,
    markdown,
    JSON.stringify(filters),
  );
}

export async function upsertSource(source: { name: string; domain: string; queryTemplate: string }) {
  db.prepare(
    `INSERT INTO sources (name, domain, query_template, enabled)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(domain) DO UPDATE SET
       name = excluded.name,
       query_template = excluded.query_template,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(source.name, source.domain, source.queryTemplate);
}

export async function upsertSeedSignal(signal: Omit<Signal, "createdAt" | "updatedAt" | "collectionSource" | "aiClassification" | "confirmed">) {
  db.prepare(
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
  ).run(
    signal.id,
    signal.date,
    signal.entity,
    signal.entityType,
    JSON.stringify(signal.companies),
    signal.product,
    signal.title,
    signal.summary,
    JSON.stringify(signal.topics),
    signal.topicMode,
    signal.source,
    signal.domain,
    signal.url,
    signal.evidenceLevel,
    signal.confidence,
    JSON.stringify({ method: "seed", topics: signal.topics }),
  );
}

migrate();

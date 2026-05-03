import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { companiesForSignal, normalizeCompanyName } from "./companies";
import { sourceKeyForUrl } from "./sourceUrls";
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
    const signalCompanies = companiesForSignal(signal);
    const filterCompany = filters.company ? normalizeCompanyName(filters.company) : "";
    const filterCompanies = filters.companies?.map(normalizeCompanyName).filter(Boolean) || [];
    if (filterCompany && !signalCompanies.includes(filterCompany)) return false;
    if (filterCompanies.length && !filterCompanies.some((company) => signalCompanies.includes(company))) return false;
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

export async function findSimilarSignal(signal: Omit<Signal, "createdAt" | "updatedAt">) {
  const incomingSourceKey = sourceKeyForUrl(signal.url);
  const incomingCompanies = normalizedCompanies(signal.companies, signal.entity);
  const rows = db.prepare("SELECT id, date, entity, companies, product, title, summary, url FROM signals").all() as Array<Record<string, unknown>>;

  for (const row of rows) {
    if (incomingSourceKey && sourceKeyForUrl(String(row.url)) === incomingSourceKey) {
      return { id: String(row.id), reason: "same-source-url" };
    }
  }

  for (const row of rows) {
    const existingCompanies = normalizedCompanies(parseJson<string[]>(row.companies, []), String(row.entity || ""));
    if (incomingCompanies.length && existingCompanies.length && !incomingCompanies.some((company) => existingCompanies.includes(company))) continue;
    if (dateDistanceDays(signal.date, String(row.date)) > 3) continue;

    const titleScore = textSimilarity(signal.title, String(row.title));
    const summaryScore = textSimilarity(signal.summary, String(row.summary));
    const productScore = textSimilarity(signal.product, String(row.product || ""));
    const keyOverlap = keywordOverlapScore(
      `${signal.title} ${signal.summary} ${signal.product}`,
      `${String(row.title)} ${String(row.summary)} ${String(row.product || "")}`,
    );
    const entityOverlap = keywordOverlapScore(
      `${signal.title} ${signal.product} ${signal.companies.join(" ")}`,
      `${String(row.title)} ${String(row.product || "")} ${existingCompanies.join(" ")}`,
    );
    if (
      titleScore >= 0.58 ||
      (titleScore >= 0.46 && summaryScore >= 0.32) ||
      (productScore >= 0.72 && summaryScore >= 0.45) ||
      (keyOverlap >= 0.68 && (titleScore >= 0.28 || summaryScore >= 0.24)) ||
      (entityOverlap >= 0.62 && keyOverlap >= 0.5 && summaryScore >= 0.2)
    ) {
      return { id: String(row.id), reason: "similar-title-summary" };
    }
  }

  return null;
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

function normalizedCompanies(companies: string[], entity: string) {
  return [...new Set([...(companies || []), entity].map(normalizeCompanyName).filter(Boolean))];
}

function dateDistanceDays(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftTime - rightTime) / (24 * 60 * 60 * 1000);
}

function textSimilarity(left: string, right: string) {
  const leftTokens = bigrams(normalizeForSimilarity(left));
  const rightTokens = bigrams(normalizeForSimilarity(right));
  if (!leftTokens.length || !rightTokens.length) return 0;
  const rightCounts = new Map<string, number>();
  rightTokens.forEach((token) => rightCounts.set(token, (rightCounts.get(token) || 0) + 1));
  let overlap = 0;
  for (const token of leftTokens) {
    const count = rightCounts.get(token) || 0;
    if (!count) continue;
    overlap += 1;
    rightCounts.set(token, count - 1);
  }
  return (2 * overlap) / (leftTokens.length + rightTokens.length);
}

function normalizeForSimilarity(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/amazonwebservices|amazonaws|amazonbedrock|aws/g, "amazon")
    .replace(/googlecloud/g, "google");
}

function keywordOverlapScore(left: string, right: string) {
  const leftTokens = keywordTokens(left);
  const rightTokens = keywordTokens(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
}

function keywordTokens(value: string) {
  return [
    ...new Set(
      normalizeForSimilarity(value)
        .replace(/(claude|opus|sonnet|haiku|vertex|google|anthropic|openai|gpt|codex|bedrock|agent|api|token|pricing|price|model|cloud|amazon|aws|managed|models)/g, " $1 ")
        .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
        .filter((token) => token.length >= 2)
        .filter((token) => !["and", "the", "with", "for", "在", "和", "与", "的", "上", "中", "多个", "多款"].includes(token)),
    ),
  ];
}

function bigrams(value: string) {
  if (value.length <= 1) return value ? [value] : [];
  const tokens: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) tokens.push(value.slice(index, index + 2));
  return tokens;
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

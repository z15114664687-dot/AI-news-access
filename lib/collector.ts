import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { signalIdFromUrl, topicOrder } from "./classifier";
import { createCollectionRun, findSignalByUrl, finishCollectionRun, insertSignal, listSources } from "./db";
import type { Confidence, EvidenceLevel, Signal } from "./types";

type CollectorConfig = {
  entities: string[];
  topics: string[];
};

type CollectionTask = {
  entity: string;
  topic: string;
  sourceDomains: string[];
};

type GeminiSignal = {
  date?: string;
  entity?: string;
  entityType?: string;
  companies?: string[];
  product?: string;
  title?: string;
  summary?: string;
  topics?: string[];
  topicMode?: string;
  source?: string;
  domain?: string;
  url?: string;
  evidenceLevel?: string;
  confidence?: string;
};

type RunStats = {
  foundCount: number;
  insertedCount: number;
  skippedCount: number;
  errorCount: number;
  logs: Array<Record<string, unknown>>;
};

export async function runCollection() {
  const runId = crypto.randomUUID();
  await createCollectionRun(runId);

  const stats: RunStats = { foundCount: 0, insertedCount: 0, skippedCount: 0, errorCount: 0, logs: [] };
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      stats.logs.push({
        level: "warning",
        message: "No Gemini API key configured. Set GEMINI_API_KEY in .env.",
      });
      await finishCollectionRun(runId, "completed", stats);
      return { id: runId, status: "completed", ...stats };
    }

    const config = readCollectorConfig();
    const sources = (await listSources()).filter((source) => source.enabled);
    const tasks = buildTasks(config, sources.map((source) => source.domain));

    for (const task of tasks) {
      try {
        const results = await collectWithGemini(task, apiKey);
        stats.foundCount += results.length;
        for (const result of results) {
          const signal = normalizeGeminiSignal(result);
          if (!signal) {
            stats.skippedCount += 1;
            continue;
          }

          const existing = await findSignalByUrl(signal.url);
          if (existing) {
            stats.skippedCount += 1;
            continue;
          }

          await insertSignal(signal);
          stats.insertedCount += 1;
        }
        stats.logs.push({ level: "info", entity: task.entity, topic: task.topic, found: results.length });
      } catch (error) {
        stats.errorCount += 1;
        stats.logs.push({
          level: "error",
          entity: task.entity,
          topic: task.topic,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const status = stats.errorCount && !stats.insertedCount ? "failed" : "completed";
    await finishCollectionRun(runId, status, stats);
    return { id: runId, status, ...stats };
  } catch (error) {
    stats.errorCount += 1;
    stats.logs.push({ level: "error", message: error instanceof Error ? error.message : String(error) });
    await finishCollectionRun(runId, "failed", stats);
    return { id: runId, status: "failed", ...stats };
  }
}

function readCollectorConfig(): CollectorConfig {
  const filePath = path.join(process.cwd(), "data", "collector-config.json");
  const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return { entities: config.entities || [], topics: config.topics || [] };
}

function buildTasks(config: CollectorConfig, sourceDomains: string[]) {
  const limit = Number(process.env.COLLECT_QUERY_LIMIT || 12);
  const tasks: CollectionTask[] = [];

  for (const entity of config.entities) {
    for (const topic of config.topics) {
      tasks.push({ entity, topic, sourceDomains });
      if (tasks.length >= limit) return tasks;
    }
  }
  return tasks;
}

async function collectWithGemini(task: CollectionTask, apiKey: string): Promise<GeminiSignal[]> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildGeminiPrompt(task) }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gemini collection failed: ${response.status} ${text.slice(0, 240)}`);
  }

  const data = await response.json();
  const text = extractGeminiText(data);
  const parsed = parseJsonObject(text);
  return Array.isArray(parsed.signals) ? parsed.signals : [];
}

function buildGeminiPrompt(task: CollectionTask) {
  const domains = task.sourceDomains.slice(0, 12).join(", ");
  return [
    "你是一个 AI 行业情报采集器。请使用 Google Search grounding 查找最新、可核验的 AI 新闻和官方动态。",
    "",
    `采集对象：${task.entity}`,
    `采集主题：${task.topic}`,
    `优先来源域名：${domains}`,
    "",
    "只返回最近 180 天内、和对象及主题高度相关的 1 到 3 条情报信号。不要编造 URL、日期或来源；如果没有可靠来源，返回空数组。",
    "",
    "必须只输出合法 JSON，不要 Markdown，不要解释文字。JSON 结构如下：",
    `{
  "signals": [
    {
      "date": "YYYY-MM-DD",
      "entity": "公司或市场信号对象",
      "entityType": "company 或 market_signal 或 adoption_signal",
      "companies": ["公司名"],
      "product": "产品或项目名",
      "title": "中文标题，不超过 60 字",
      "summary": "中文摘要，不超过 120 字",
      "topics": ["模型 | Agent | 工具 | 内容生态 | 商业化"],
      "topicMode": "exclusive 或 cross_topic",
      "source": "来源名称",
      "domain": "来源域名",
      "url": "来源 URL",
      "evidenceLevel": "official 或 media 或 analysis",
      "confidence": "high 或 medium 或 low"
    }
  ]
}`,
    "",
    `话题只能使用这些中文标签：${topicOrder.join("、")}。`,
  ].join("\n");
}

function extractGeminiText(data: Record<string, unknown>) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const first = candidates[0] as Record<string, unknown> | undefined;
  const content = first?.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return parts
    .map((part) => (typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, string>).text : ""))
    .join("\n")
    .trim();
}

function parseJsonObject(text: string): { signals?: GeminiSignal[] } {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Gemini did not return a JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeGeminiSignal(result: GeminiSignal): Omit<Signal, "createdAt" | "updatedAt"> | null {
  const url = cleanString(result.url);
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const domain = cleanString(result.domain) || domainFromUrl(url);
  const companies = Array.isArray(result.companies) ? result.companies.map(cleanString).filter(Boolean) : [];
  const topics = Array.isArray(result.topics)
    ? result.topics.map(cleanString).filter((topic) => topicOrder.includes(topic))
    : [];
  const safeTopics = topics.length ? [...new Set(topics)] : ["工具"];
  const entity = cleanString(result.entity) || companies[0] || "Market Signal";

  return {
    id: signalIdFromUrl(url),
    date: normalizeDate(result.date),
    entity,
    entityType: normalizeEntityType(result.entityType),
    companies: companies.length ? [...new Set(companies)] : entity !== "Market Signal" ? [entity] : [],
    product: cleanString(result.product) || "AI",
    title: cleanString(result.title).slice(0, 180),
    summary: cleanString(result.summary).slice(0, 260),
    topics: safeTopics,
    topicMode: result.topicMode === "cross_topic" || safeTopics.length > 1 ? "cross_topic" : "exclusive",
    source: cleanString(result.source) || domain,
    domain,
    url,
    evidenceLevel: normalizeEvidence(result.evidenceLevel, domain),
    confidence: normalizeConfidence(result.confidence),
    collectionSource: "gemini-google-search",
    aiClassification: {
      method: "gemini-grounding-v1",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      needsReview: normalizeConfidence(result.confidence) !== "high",
    },
    confirmed: false,
  };
}

function normalizeDate(value?: string) {
  const text = cleanString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 10);
}

function normalizeEntityType(value?: string) {
  const text = cleanString(value);
  return ["company", "market_signal", "adoption_signal"].includes(text) ? text : "company";
}

function normalizeEvidence(value: unknown, domain: string): EvidenceLevel {
  if (value === "official" || value === "media" || value === "analysis") return value;
  if (domain.includes("openai.com") || domain.includes("anthropic.com") || domain.includes("googleblog.com")) return "official";
  if (domain.includes("36kr.com") || domain.includes("latepost.com")) return "analysis";
  return "media";
}

function normalizeConfidence(value: unknown): Confidence {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function domainFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

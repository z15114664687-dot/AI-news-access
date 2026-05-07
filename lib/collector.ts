import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { focusedCompanies, normalizeCompanyName } from "./companies";
import { inferPrimaryTopic, signalIdFromUrl, topicOrder } from "./classifier";
import { findSimilarSignal, finishCollectionRun, insertSignal, listSources, createCollectionRun } from "./db";
import { resolveSourceUrl } from "./linkResolver";
import { isUsableSourceUrl, normalizeSourceUrl } from "./sourceUrls";
import type { Confidence, EvidenceLevel, Signal } from "./types";

type CollectorConfig = {
  entities: string[];
  topics: string[];
};

type CollectionTask = {
  entity: string;
  topic: string;
  sourceDomains: string[];
  days: number;
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
  sourceQuery?: string;
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

export async function runCollection(options: { days?: number } = {}) {
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
    const days = clampDays(options.days ?? Number(process.env.COLLECT_DAYS || 30));
    const tasks = buildTasks(config, sources.map((source) => source.domain), days);

    for (const task of tasks) {
      try {
        const results = await collectWithGemini(task, apiKey);
        stats.foundCount += results.length;
        for (const result of results) {
          const signal = await normalizeGeminiSignal(result, task.topic, task.entity);
          if (!signal) {
            stats.skippedCount += 1;
            stats.logs.push({
              level: "warning",
              action: "skip-invalid-signal",
              title: cleanString(result.title),
              source: cleanString(result.source),
              domain: cleanString(result.domain),
              reason: "missing-title-or-link-candidate",
            });
            continue;
          }

          const sourceResolution = signal.aiClassification.sourceResolution as Record<string, unknown> | undefined;
          if (sourceResolution?.status && sourceResolution.status !== "resolved") {
            stats.logs.push({
              level: "warning",
              action: "source-link-fallback",
              title: signal.title,
              status: sourceResolution.status,
              url: signal.url,
            });
          }

          const existing = await findSimilarSignal(signal);
          if (existing) {
            stats.skippedCount += 1;
            stats.logs.push({ level: "info", action: "skip-duplicate", newTitle: signal.title, existingId: existing.id, reason: existing.reason });
            continue;
          }

          await insertSignal(signal);
          stats.insertedCount += 1;
        }
        stats.logs.push({ level: "info", entity: task.entity, topic: task.topic, days: task.days, found: results.length });
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

function buildTasks(config: CollectorConfig, sourceDomains: string[], days: number) {
  const limit = Number(process.env.COLLECT_QUERY_LIMIT || 12);
  const tasks: CollectionTask[] = [];

  for (const entity of config.entities) {
    for (const topic of config.topics) {
      tasks.push({ entity, topic, sourceDomains, days });
      if (tasks.length >= limit) return tasks;
    }
  }
  return tasks;
}

async function collectWithGemini(task: CollectionTask, apiKey: string): Promise<GeminiSignal[]> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const data = await requestGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    apiKey,
    {
      contents: [{ parts: [{ text: buildGeminiPrompt(task) }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
      },
    },
  );
  const text = extractGeminiText(data);
  const parsed = parseJsonObject(text);
  return Array.isArray(parsed.signals) ? parsed.signals : [];
}

async function requestGeminiWithRetry(url: string, apiKey: string, body: Record<string, unknown>) {
  const maxAttempts = 3;
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });

      if (response.ok) return (await response.json()) as Record<string, unknown>;

      const text = await response.text().catch(() => "");
      lastError = `Gemini collection failed: ${response.status} ${text.slice(0, 240)}`;
      if (!isRetriableStatus(response.status) || attempt === maxAttempts) throw new Error(lastError);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === maxAttempts || !isRetriableFetchError(error)) {
        throw new Error(`Gemini request failed after ${attempt} attempt${attempt > 1 ? "s" : ""}: ${lastError}`);
      }
    }

    await sleep(600 * attempt ** 2);
  }

  throw new Error(lastError || "Gemini request failed.");
}

function buildGeminiPrompt(task: CollectionTask) {
  const domains = task.sourceDomains.slice(0, 12).join(", ");
  const sinceDate = new Date(Date.now() - task.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return [
    "你是一个 AI 行业情报采集器。请使用 Google Search grounding 查找最新、可核验的 AI 新闻和官方动态。",
    "",
    `采集对象：${task.entity}`,
    `采集主题：${task.topic}`,
    `优先来源域名：${domains}`,
    "",
    `只返回 ${sinceDate} 之后、和对象及主题高度相关的 1 到 3 条情报信号。不要编造日期或来源；如果没有可靠来源，返回空数组。`,
    "url 优先返回可直接访问的原文页面 canonical URL；如果 Google grounding 只能提供临时跳转链接，也可以放在 url 字段，后端会用浏览器/CDP 解析最终原文链接。",
    "sourceQuery 必须给出一个能定位原文的短查询词，包含公司/产品名和标题核心词；当 url 是临时跳转或不可访问时，后端会用它打开搜索结果并取原文链接。",
    "JSON 字符串内不要包含未转义换行或控制字符；摘要和标题都必须是单行文本。",
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
      "topics": ["一个主话题：模型 | Agent | 工具 | 内容生态 | 商业化"],
      "topicMode": "exclusive",
      "source": "来源名称",
      "domain": "来源域名",
      "url": "原文 URL 或 grounding 临时跳转 URL",
      "sourceQuery": "用于定位原文页面的搜索查询",
      "evidenceLevel": "official 或 media 或 analysis",
      "confidence": "high 或 medium 或 low"
    }
  ]
}`,
    "",
    `话题只能使用这些中文标签：${topicOrder.join("、")}。`,
    "每条情报只能归入一个主话题，topics 数组必须只有 1 个元素；不要输出 cross_topic，topicMode 固定为 exclusive。",
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
  const jsonText = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    try {
      return JSON.parse(escapeControlCharactersInJsonStrings(jsonText));
    } catch {
      throw error;
    }
  }
}

async function normalizeGeminiSignal(result: GeminiSignal, fallbackTopic: string, focusEntity: string): Promise<Omit<Signal, "createdAt" | "updatedAt"> | null> {
  const candidateUrl = normalizeSourceUrl(cleanString(result.url));
  const sourceQuery = cleanString(result.sourceQuery);
  const checkedUrl = await resolveSourceUrl({
    url: candidateUrl,
    title: cleanString(result.title),
    domain: cleanString(result.domain),
    source: cleanString(result.source),
    query: sourceQuery,
  });
  const fallbackUrl = fallbackSourceUrl({
    url: candidateUrl,
    title: cleanString(result.title),
    domain: cleanString(result.domain),
    query: sourceQuery,
  });
  const finalUrl = checkedUrl || fallbackUrl;
  if (!cleanString(result.title) || !finalUrl) return null;

  const domain = cleanString(result.domain) || domainFromUrl(finalUrl);
  const rawCompanies = Array.isArray(result.companies) ? result.companies.map(cleanString).map(normalizeCompanyName).filter(Boolean) : [];
  const focusCompany = normalizeCompanyName(focusEntity);
  const focusedRawCompanies = focusedCompanies(rawCompanies);
  const companies = focusedRawCompanies.length ? focusedRawCompanies : focusCompany && mentionsFocusCompany(result, focusCompany) ? [focusCompany] : rawCompanies;
  const topics = Array.isArray(result.topics)
    ? result.topics.map(cleanString).filter((topic) => topicOrder.includes(topic))
    : [];
  const primaryTopic = inferPrimaryTopic(cleanString(result.title), cleanString(result.summary), topics[0] || fallbackTopic);
  const entity = companies[0] || cleanString(result.entity) || "Market Signal";
  const normalizedEntity = normalizeCompanyName(entity);

  return {
    id: signalIdFromUrl(finalUrl),
    date: normalizeDate(result.date),
    entity: normalizedEntity,
    entityType: normalizeEntityType(result.entityType),
    companies: companies.length ? [...new Set(companies)] : normalizedEntity !== "Market Signal" ? [normalizedEntity] : [],
    product: cleanString(result.product) || "AI",
    title: cleanString(result.title).slice(0, 180),
    summary: cleanString(result.summary).slice(0, 260),
    topics: [primaryTopic],
    topicMode: "exclusive",
    source: cleanString(result.source) || domain,
    domain,
    url: finalUrl,
    evidenceLevel: normalizeEvidence(result.evidenceLevel, domain),
    confidence: normalizeConfidence(result.confidence),
    collectionSource: "gemini-google-search",
    aiClassification: {
      method: "gemini-grounding-v1",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      matchedTopics: topics.length ? [...new Set(topics)] : [primaryTopic],
      primaryTopic,
      sourceQuery,
      sourceResolution: {
        status: checkedUrl ? "resolved" : isUsableSourceUrl(candidateUrl) ? "unverified-url" : "search-fallback",
        originalUrl: candidateUrl,
      },
      needsReview: normalizeConfidence(result.confidence) !== "high",
    },
    confirmed: false,
  };
}

function mentionsFocusCompany(result: GeminiSignal, focusCompany: string) {
  const text = [result.entity, result.title, result.summary, result.product, ...(Array.isArray(result.companies) ? result.companies : [])]
    .map(cleanString)
    .join(" ")
    .toLowerCase();
  return Boolean(focusCompany) && text.includes(focusCompany.toLowerCase());
}

function fallbackSourceUrl(input: { url: string; title: string; domain: string; query: string }) {
  if (isUsableSourceUrl(input.url)) return input.url;
  const domain = isFallbackSearchDomain(input.domain) ? input.domain : "";
  const query = [domain ? `site:${domain}` : "", input.query || input.title].filter(Boolean).join(" ");
  return query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : "";
}

function isFallbackSearchDomain(domain: string) {
  if (!domain) return false;
  return !domain.includes("vertexaisearch.cloud.google.com") && !domain.includes("grounding-api-redirect");
}

function clampDays(value: number) {
  if (!Number.isFinite(value)) return 30;
  return Math.min(180, Math.max(1, Math.round(value)));
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

function isRetriableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function isRetriableFetchError(error: unknown) {
  if (!(error instanceof Error)) return true;
  return ["AbortError", "TimeoutError", "TypeError"].includes(error.name) || /fetch failed|terminated|timeout|network/i.test(error.message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeControlCharactersInJsonStrings(value: string) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (!inString) {
      result += char;
      if (char === "\"") inString = true;
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      result += char;
      inString = false;
      continue;
    }

    if (char === "\n") {
      result += "\\n";
      continue;
    }

    if (char === "\r") {
      result += "\\r";
      continue;
    }

    if (char === "\t") {
      result += "\\t";
      continue;
    }

    if (char < " ") continue;
    result += char;
  }

  return result;
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

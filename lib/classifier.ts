import crypto from "node:crypto";
import { normalizeCompanyName } from "./companies";
import type { Confidence, EvidenceLevel, Signal } from "./types";

export const topicOrder = ["模型", "Agent", "工具", "内容生态", "商业化"];

const companyCandidates = [
  "OpenAI",
  "Anthropic",
  "Google",
  "Cursor",
  "Perplexity",
  "Meta",
  "xAI",
  "DeepSeek",
  "Qwen",
  "Microsoft",
  "Amazon",
  "Nvidia",
  "Oracle",
];

const topicRules: Array<{ topic: string; keywords: string[] }> = [
  { topic: "商业化", keywords: ["ads", "advertising", "revenue", "pricing", "subscription", "contract", "enterprise deal", "arr", "funding", "valuation", "pentagon", "token", "tokens", "usage cost", "cost estimate", "discount", "rate card", "价格", "定价", "订阅", "合同", "收入", "融资", "估值", "商业化", "国防", "采购", "使用成本", "成本预估", "成本压力", "折扣", "用量", "计费"] },
  { topic: "内容生态", keywords: ["creator", "video", "youtube", "tiktok", "instagram", "reddit", "content", "generated content", "livestream", "创作者", "视频", "内容", "直播", "社交平台"] },
  { topic: "Agent", keywords: ["agent", "agents", "autonomy", "computer use", "codex", "claude code", "operator", "devin", "代理", "智能体", "自主", "长程任务", "多步骤", "composer"] },
  { topic: "工具", keywords: ["tool", "tools", "workspace", "search", "shopping", "office", "copilot", "editor", "integration", "workflow", "connector", "connectors", "security", "vulnerability", "工具", "工作区", "搜索", "购物", "集成", "连接器", "插件", "安全工具", "网络安全", "漏洞", "扫描", "补丁", "工作流"] },
  { topic: "模型", keywords: ["model", "reasoning", "benchmark", "multimodal", "context", "llm", "gpt", "claude", "gemini", "llama", "sora", "veo", "模型", "推理", "多模态", "上下文", "基准", "评测"] },
];

export type RawSearchResult = {
  title: string;
  url: string;
  snippet: string;
  sourceName: string;
  sourceDomain: string;
  discoveredBy: string;
  date?: string;
};

export function signalIdFromUrl(url: string) {
  return `signal-${crypto.createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
}

export function classifySearchResult(result: RawSearchResult): Omit<Signal, "createdAt" | "updatedAt"> {
  const text = `${result.title} ${result.snippet}`.toLowerCase();
  const matchedTopics = matchingTopics(text);
  const primaryTopic = inferPrimaryTopic(result.title, result.snippet, matchedTopics[0]);
  const companies = [...new Set(companyCandidates.filter((name) => text.includes(name.toLowerCase())).map(normalizeCompanyName))];
  const primaryCompany = companies[0] || inferCompanyFromDomain(result.sourceDomain);
  const officialDomain = primaryCompany && result.sourceDomain.toLowerCase().includes(primaryCompany.toLowerCase().replace(/\s+/g, ""));
  const evidenceLevel: EvidenceLevel = officialDomain ? "official" : result.sourceDomain.includes("36kr") || result.sourceDomain.includes("latepost") ? "analysis" : "media";
  const confidence: Confidence = evidenceLevel === "official" ? "high" : result.snippet.length > 80 ? "medium" : "low";

  return {
    id: signalIdFromUrl(result.url),
    date: result.date || new Date().toISOString().slice(0, 10),
    entity: primaryCompany || "Market Signal",
    entityType: primaryCompany ? "company" : "market_signal",
    companies: companies.length ? companies : primaryCompany ? [primaryCompany] : [],
    product: inferProduct(result.title),
    title: cleanText(result.title).slice(0, 180),
    summary: summarize(result.snippet || result.title),
    topics: [primaryTopic],
    topicMode: "exclusive",
    source: result.sourceName,
    domain: result.sourceDomain,
    url: result.url,
    evidenceLevel,
    confidence,
    collectionSource: result.discoveredBy,
    aiClassification: {
      method: "rules-v1",
      matchedTopics: matchedTopics.length ? matchedTopics : [primaryTopic],
      primaryTopic,
      needsReview: confidence !== "high",
    },
    confirmed: false,
  };
}

export function inferPrimaryTopic(title: string, summary = "", fallback = "工具") {
  const text = `${title} ${summary}`.toLowerCase();
  if (matches(text, "商业化")) return "商业化";
  if (matches(text, "内容生态")) return "内容生态";
  if (matches(text, "Agent")) return "Agent";
  if (matches(text, "工具")) return "工具";
  if (matches(text, "模型")) return "模型";
  return topicOrder.includes(fallback) ? fallback : "工具";
}

function matchingTopics(text: string) {
  return [...new Set(topicRules.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase()))).map((rule) => rule.topic))];
}

function matches(text: string, topic: string) {
  return topicRules.find((rule) => rule.topic === topic)?.keywords.some((keyword) => text.includes(keyword.toLowerCase())) || false;
}

function inferCompanyFromDomain(domain: string) {
  const normalized = domain.toLowerCase();
  if (normalized.includes("openai")) return "OpenAI";
  if (normalized.includes("anthropic")) return "Anthropic";
  if (normalized.includes("google")) return "Google";
  if (normalized.includes("cursor")) return "Cursor";
  return "";
}

function inferProduct(title: string) {
  const known = ["ChatGPT", "Claude", "Gemini", "Codex", "Cursor", "Sora", "Veo", "Copilot", "Perplexity"];
  return known.find((product) => title.toLowerCase().includes(product.toLowerCase())) || "AI";
}

function summarize(value: string) {
  const text = cleanText(value);
  if (text.length <= 220) return text;
  return `${text.slice(0, 218)}…`;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

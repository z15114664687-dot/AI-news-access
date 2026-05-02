import crypto from "node:crypto";
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
  { topic: "Agent", keywords: ["agent", "agents", "autonomy", "computer use", "codex", "claude code", "operator", "devin"] },
  { topic: "商业化", keywords: ["ads", "advertising", "revenue", "pricing", "subscription", "contract", "enterprise deal", "arr", "funding", "valuation", "pentagon"] },
  { topic: "内容生态", keywords: ["creator", "video", "youtube", "tiktok", "instagram", "reddit", "content", "generated content", "livestream"] },
  { topic: "工具", keywords: ["tool", "tools", "workspace", "search", "shopping", "office", "copilot", "editor", "integration", "workflow"] },
  { topic: "模型", keywords: ["model", "reasoning", "benchmark", "multimodal", "context", "llm", "gpt", "claude", "gemini", "llama", "sora", "veo"] },
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
  const topics = topicRules.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword))).map((rule) => rule.topic);
  const uniqueTopics = topics.length ? [...new Set(topics)] : ["工具"];
  const companies = companyCandidates.filter((name) => text.includes(name.toLowerCase()));
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
    topics: uniqueTopics,
    topicMode: uniqueTopics.length > 1 ? "cross_topic" : "exclusive",
    source: result.sourceName,
    domain: result.sourceDomain,
    url: result.url,
    evidenceLevel,
    confidence,
    collectionSource: result.discoveredBy,
    aiClassification: {
      method: "rules-v1",
      matchedTopics: uniqueTopics,
      needsReview: confidence !== "high",
    },
    confirmed: false,
  };
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

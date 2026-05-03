import crypto from "node:crypto";
import { companiesForSignal, sortCompanies } from "./companies";
import { listSignals, saveReport } from "./db";
import { resolveSourceUrl } from "./linkResolver";
import { sourceUrlForSignal, verifiedSourceUrl } from "./sourceUrls";
import type { Signal, SignalFilters } from "./types";

export async function createReport(filters: SignalFilters) {
  const signals = await listSignals(filters);
  const title = reportTitle(filters);
  const markdown = await buildReportMarkdown(title, filters, signals);
  const id = crypto.randomUUID();
  await saveReport(id, title, markdown, filters);
  return { id, title, markdown, filename: `${slugify(title)}.md`, signalCount: signals.length };
}

async function buildReportMarkdown(title: string, filters: SignalFilters, signals: Signal[]) {
  const sourceUrls = await verifiedSourceUrls(signals);
  const aiReport = await generateGeminiReport(title, filters, signals, sourceUrls);
  if (aiReport) return aiReport;
  return buildLocalReportMarkdown(title, filters, signals, sourceUrls);
}

function buildLocalReportMarkdown(title: string, filters: SignalFilters, signals: Signal[], sourceUrls: Map<string, string>) {
  const companies = sortCompanies(signals.flatMap(companiesForSignal));
  const topics = [...new Set(signals.flatMap((signal) => signal.topics))].sort();
  const official = signals.filter((signal) => signal.evidenceLevel === "official").length;
  const high = signals.filter((signal) => signal.confidence === "high").length;
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const observations = signals.slice(0, 10);

  return [
    `# ${title}`,
    "",
    `生成时间：${generatedAt}`,
    `时间范围：${reportPeriod(filters)}`,
    `信号数量：${signals.length}`,
    `相关公司：${companies.length ? companies.join("、") : "无"}`,
    `覆盖话题：${topics.length ? topics.join("、") : "无"}`,
    `证据质量：一手来源 ${official} 条，高可信 ${high} 条`,
    "",
    "## 高密度摘要",
    signals.length
      ? `${companies.slice(0, 4).join("、") || "相关主体"} 的近期信号主要集中在 ${topics.slice(0, 4).join("、") || "当前维度"}，更像是模型能力向 Agent 执行、企业工具和商业化闭环迁移的连续动作，而不是单点产品发布。官方与高可信样本占比较高，但关键判断仍应打开原文核验。`
      : "当前筛选条件下没有可用于生成报告的信号。",
    "",
    "## 关键观察",
    ...observations.flatMap((signal) => [
      `### ${companiesForSignal(signal).join(" / ") || signal.entity} 正在推进 ${signal.product || "AI"} 相关动作`,
      sourceUrls.get(signal.id) ? `${signal.date} · [来源链接](${sourceUrls.get(signal.id)})` : `${signal.date} · 来源链接待核验`,
      "",
      `${signal.title}。${signal.summary}`,
      "",
    ]),
    "",
    "## 备注",
    "自动采集条目默认未确认，重要结论应打开对应来源复核；付费墙或媒体来源仅保留标题、摘要、日期和 URL。",
  ].join("\n");
}

async function generateGeminiReport(title: string, filters: SignalFilters, signals: Signal[], sourceUrls: Map<string, string>) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey || !signals.length) return "";

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildGeminiReportPrompt(title, filters, signals, sourceUrls) }] }],
      generationConfig: {
        temperature: 0.35,
        topP: 0.85,
      },
    }),
    signal: AbortSignal.timeout(60000),
  }).catch(() => null);

  if (!response?.ok) return "";
  const data = await response.json().catch(() => null);
  return cleanMarkdown(extractGeminiText(data));
}

function buildGeminiReportPrompt(title: string, filters: SignalFilters, signals: Signal[], sourceUrls: Map<string, string>) {
  const companies = sortCompanies(signals.flatMap(companiesForSignal));
  const topics = [...new Set(signals.flatMap((signal) => signal.topics))].sort();
  const official = signals.filter((signal) => signal.evidenceLevel === "official").length;
  const high = signals.filter((signal) => signal.confidence === "high").length;
  const compactSignals = signals.slice(0, 40).map((signal) => ({
    date: signal.date,
    companies: companiesForSignal(signal),
    product: signal.product,
    title: signal.title,
    summary: signal.summary,
    topics: signal.topics,
    url: sourceUrls.get(signal.id) || null,
    linkStatus: sourceUrls.get(signal.id) ? "verified_direct_source_url" : "source_url_needs_review",
    evidenceLevel: signal.evidenceLevel,
    confidence: signal.confidence,
  }));

  return [
    "你是一个面向投资、产品和战略团队的 AI 行业情报分析师。请基于给定的本地信号生成中文 Markdown 总结报告，不要引入外部事实，不要编造来源。",
    "",
    "写作要求：",
    "- 标题必须是有判断的陈述句，不要写成“关键观察一”这类机械标题。",
    "- 正文以整段描述为主，信息密度高，减少模板感和人机味。",
    "- 保留日期；不要展示来源名称、来源域名或 source 字段。",
    "- 只有当信号 JSON 的 url 是非空字符串时，才可以在日期行下方或同一行放 Markdown 链接，文案统一用“来源链接”。url 为 null 时，只写“来源链接待核验”，不要编造、补全或改写链接。",
    "- 结构清晰，但不要输出证据表格。",
    "- 用公司归一化口径：Google 包含 Google Cloud / Google Gemini；Amazon 包含 AWS / Amazon Web Services。",
    "- 输出合法 Markdown，不要代码块，不要解释生成过程。",
    "",
    `报告标题：${title}`,
    `时间范围：${reportPeriod(filters)}`,
    `信号数量：${signals.length}`,
    `相关公司：${companies.join("、") || "无"}`,
    `覆盖话题：${topics.join("、") || "无"}`,
    `证据质量：一手来源 ${official} 条，高可信 ${high} 条`,
    "",
    "建议结构：",
    "1. 一级标题使用报告标题。",
    "2. 用 1 段给出总判断。",
    "3. 用 4-6 个二级标题展开，每个标题都是陈述句，每节 1-2 段。",
    "4. 每节可以列出少量关键日期行，格式为：YYYY-MM-DD · [来源链接](URL)。",
    "5. 末尾给出“后续关注”一节，用 1 段描述应该继续跟踪什么。",
    "",
    "本地信号 JSON：",
    JSON.stringify(compactSignals, null, 2),
  ].join("\n");
}

async function verifiedSourceUrls(signals: Signal[]) {
  const candidates = signals.slice(0, 40);
  const entries: Array<readonly [string, string]> = [];
  for (const signal of candidates) {
    const usableUrl = sourceUrlForSignal(signal);
    const url = usableUrl
      ? await verifiedSourceUrl(usableUrl)
      : await resolveSourceUrl({ url: signal.url, title: signal.title, domain: signal.domain, source: signal.source });
    entries.push([signal.id, url] as const);
  }
  return new Map(entries);
}

function extractGeminiText(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const rawCandidates = (data as Record<string, unknown>).candidates;
  const candidates: unknown[] = Array.isArray(rawCandidates) ? rawCandidates : [];
  const first = candidates[0] as Record<string, unknown> | undefined;
  const content = first?.content as Record<string, unknown> | undefined;
  const parts: unknown[] = Array.isArray(content?.parts) ? content.parts : [];
  return parts
    .map((part) => (typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, string>).text : ""))
    .join("\n")
    .trim();
}

function cleanMarkdown(value: string) {
  return value
    .replace(/^```markdown\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function reportTitle(filters: SignalFilters) {
  if (filters.company) return `${filters.company} AI 情报总结报告`;
  if (filters.topic) return `${filters.topic} 话题情报总结报告`;
  return "AI 生态情报总览报告";
}

function reportPeriod(filters: SignalFilters) {
  if (!filters.startDate && !filters.endDate) return "全部样本时间";
  return `${filters.startDate || "最早"} 至 ${filters.endDate || "最新"}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

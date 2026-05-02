import crypto from "node:crypto";
import { listSignals, saveReport } from "./db";
import type { Signal, SignalFilters } from "./types";

export async function createReport(filters: SignalFilters) {
  const signals = await listSignals(filters);
  const title = reportTitle(filters);
  const markdown = buildReportMarkdown(title, filters, signals);
  const id = crypto.randomUUID();
  await saveReport(id, title, markdown, filters);
  return { id, title, markdown, filename: `${slugify(title)}.md`, signalCount: signals.length };
}

function buildReportMarkdown(title: string, filters: SignalFilters, signals: Signal[]) {
  const companies = [...new Set(signals.flatMap((signal) => signal.companies))].sort();
  const topics = [...new Set(signals.flatMap((signal) => signal.topics))].sort();
  const official = signals.filter((signal) => signal.evidenceLevel === "official").length;
  const high = signals.filter((signal) => signal.confidence === "high").length;
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });

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
    "## 摘要",
    signals.length
      ? `当前样本显示，${companies.slice(0, 4).join("、") || "相关主体"} 的主要信号集中在 ${topics.slice(0, 4).join("、") || "当前维度"}。本报告由私有数据源和自动分类结果生成，仍建议对高价值判断做原文核验。`
      : "当前筛选条件下没有可用于生成报告的信号。",
    "",
    "## 关键观察",
    ...signals.slice(0, 8).map((signal) => `- ${signal.date} · ${signal.companies.join(" / ") || signal.entity}：${signal.title}`),
    "",
    "## 证据清单",
    "| 日期 | 公司/对象 | 话题 | 来源 | 标题 |",
    "|---|---|---|---|---|",
    ...signals.map(
      (signal) =>
        `| ${signal.date} | ${signal.companies.join(" / ") || signal.entity} | ${signal.topics.join("、")} | ${signal.source} | [${escapeMarkdown(signal.title)}](${signal.url}) |`,
    ),
    "",
    "## 备注",
    "- 自动采集条目默认未确认，重要结论应打开来源复核。",
    "- 付费墙或媒体来源仅保留摘要、标题、URL 和来源层级。",
  ].join("\n");
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

function escapeMarkdown(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

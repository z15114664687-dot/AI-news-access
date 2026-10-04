import type { Signal } from "./types";

export type SourceStatus = "direct" | "search" | "redirect" | "missing";
export type ReviewStatus = "unreviewed" | "confirmed" | "dismissed" | "stale";

export function sourceStatus(value: string): SourceStatus {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "missing";
    const host = url.hostname.toLowerCase();
    if (host === "vertexaisearch.cloud.google.com" || url.pathname.includes("/grounding-api-redirect/")) return "redirect";
    if ((/(^|\.)google\.[a-z.]+$/.test(host) && /^\/(search|url)(\/|$)/.test(url.pathname)) ||
        (/(^|\.)bing\.com$/.test(host) && url.pathname === "/search") ||
        host === "duckduckgo.com" || (host === "www.baidu.com" && url.pathname === "/s")) return "search";
    return "direct";
  } catch {
    return "missing";
  }
}

export function normalizePublicationDate(value: unknown, now = new Date()): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  const date = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return "";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  if (date > today) return "";
  if (text.length > 10 && (!Number.isFinite(Date.parse(text)) || Date.parse(text) > now.getTime() + 3600000)) return "";
  return date;
}

export function evidenceForSignal(signal: Pick<Signal, "url" | "confirmed"> & Partial<Signal>) {
  const status = sourceStatus(signal.url);
  let reviewStatus: ReviewStatus = signal.reviewStatus || "unreviewed";
  if (reviewStatus === "confirmed" && (!signal.reviewedAt || signal.reviewedRevision !== signal.revision)) reviewStatus = "stale";
  if (reviewStatus === "confirmed" && status !== "direct") reviewStatus = "stale";
  return {
    sourceStatus: status,
    reviewStatus,
    sourceLabel: { direct: "原文链接 · 未自动核验", search: "搜索线索", redirect: "跳转待解析", missing: "缺少原文" }[status],
    reviewLabel: { unreviewed: "待核验", confirmed: "人工已核验", dismissed: "已忽略", stale: "内容已变 · 待复核" }[reviewStatus],
  };
}

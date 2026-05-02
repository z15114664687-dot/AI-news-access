import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { classifySearchResult, type RawSearchResult } from "./classifier";
import { createCollectionRun, findSignalByUrl, finishCollectionRun, insertSignal, listSources } from "./db";

type CollectorConfig = {
  entities: string[];
  topics: string[];
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
    const config = readCollectorConfig();
    const sources = (await listSources()).filter((source) => source.enabled);
    const queries = buildQueries(config, sources);

    if (!hasSearchProvider()) {
      stats.logs.push({
        level: "warning",
        message: "No search provider API key configured. Set BRAVE_SEARCH_API_KEY, TAVILY_API_KEY, or SERPAPI_API_KEY.",
      });
    } else {
      for (const item of queries) {
        try {
          const results = await search(item.query, item.sourceName, item.sourceDomain);
          stats.foundCount += results.length;
          for (const result of results) {
            const existing = await findSignalByUrl(result.url);
            if (existing) {
              stats.skippedCount += 1;
              continue;
            }
            const signal = classifySearchResult(result);
            await insertSignal(signal);
            stats.insertedCount += 1;
          }
          stats.logs.push({ level: "info", query: item.query, found: results.length });
        } catch (error) {
          stats.errorCount += 1;
          stats.logs.push({ level: "error", query: item.query, message: error instanceof Error ? error.message : String(error) });
        }
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

function buildQueries(config: CollectorConfig, sources: Awaited<ReturnType<typeof listSources>>) {
  const limit = Number(process.env.COLLECT_QUERY_LIMIT || 12);
  const queries: Array<{ query: string; sourceName: string; sourceDomain: string }> = [];

  for (const source of sources) {
    for (const entity of config.entities) {
      for (const topic of config.topics) {
        queries.push({
          query: source.queryTemplate.replaceAll("{entity}", entity).replaceAll("{topic}", topic),
          sourceName: source.name,
          sourceDomain: source.domain,
        });
        if (queries.length >= limit) return queries;
      }
    }
  }
  return queries;
}

function hasSearchProvider() {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY || process.env.TAVILY_API_KEY || process.env.SERPAPI_API_KEY);
}

async function search(queryText: string, sourceName: string, sourceDomain: string): Promise<RawSearchResult[]> {
  if (process.env.TAVILY_API_KEY) return searchTavily(queryText, sourceName, sourceDomain);
  if (process.env.BRAVE_SEARCH_API_KEY) return searchBrave(queryText, sourceName, sourceDomain);
  if (process.env.SERPAPI_API_KEY) return searchSerpApi(queryText, sourceName, sourceDomain);
  return [];
}

async function searchTavily(queryText: string, sourceName: string, sourceDomain: string) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: queryText, max_results: 5, search_depth: "basic" }),
  });
  if (!response.ok) throw new Error(`Tavily search failed: ${response.status}`);
  const data = await response.json();
  return (data.results || []).map((item: Record<string, string>) => ({
    title: item.title || "",
    url: item.url || "",
    snippet: item.content || "",
    sourceName,
    sourceDomain: domainFromUrl(item.url) || sourceDomain,
    discoveredBy: "tavily",
  })).filter((item: RawSearchResult) => item.title && item.url);
}

async function searchBrave(queryText: string, sourceName: string, sourceDomain: string) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", queryText);
  url.searchParams.set("count", "5");
  const response = await fetch(url, { headers: { "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY || "" } });
  if (!response.ok) throw new Error(`Brave search failed: ${response.status}`);
  const data = await response.json();
  return (data.web?.results || []).map((item: Record<string, string>) => ({
    title: item.title || "",
    url: item.url || "",
    snippet: item.description || "",
    sourceName,
    sourceDomain: domainFromUrl(item.url) || sourceDomain,
    discoveredBy: "brave",
  })).filter((item: RawSearchResult) => item.title && item.url);
}

async function searchSerpApi(queryText: string, sourceName: string, sourceDomain: string) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("q", queryText);
  url.searchParams.set("api_key", process.env.SERPAPI_API_KEY || "");
  url.searchParams.set("num", "5");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`SerpAPI search failed: ${response.status}`);
  const data = await response.json();
  return (data.organic_results || []).map((item: Record<string, string>) => ({
    title: item.title || "",
    url: item.link || "",
    snippet: item.snippet || "",
    sourceName,
    sourceDomain: domainFromUrl(item.link) || sourceDomain,
    discoveredBy: "serpapi",
    date: item.date,
  })).filter((item: RawSearchResult) => item.title && item.url);
}

function domainFromUrl(value?: string) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

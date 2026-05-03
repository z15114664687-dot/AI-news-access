#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "ai-intel.db");
const cdpBaseUrl = process.env.CDP_PROXY_URL || "http://127.0.0.1:3456";
const groundingRedirectHost = "vertexaisearch.cloud.google.com";
const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
const rows = db
  .prepare(
    `SELECT id, title, summary, source, domain, url, ai_classification
     FROM signals
     ORDER BY date DESC, updated_at DESC`,
  )
  .all();

const targets = rows.filter((row) => shouldRepair(row));
const selected = limit > 0 ? targets.slice(0, limit) : targets;

let repaired = 0;
let unchanged = 0;
let failed = 0;
const changes = [];

for (const row of selected) {
  const nextUrl = await resolveSourceUrl(row);
  if (!nextUrl || isGroundingRedirectUrl(nextUrl)) {
    failed += 1;
    changes.push({ id: row.id, status: "failed", title: row.title, oldUrl: row.url });
    continue;
  }

  const finalUrl = uniqueUrlForRow(row.id, nextUrl);
  if (normalizeSourceUrl(row.url) === finalUrl) {
    unchanged += 1;
    continue;
  }

  const nextDomain = domainFromUrl(finalUrl) || row.domain;
  const nextClassification = mergeClassification(row.ai_classification, row.url, finalUrl);
  if (!dryRun) {
    db.prepare(
      `UPDATE signals
       SET url = ?, domain = ?, ai_classification = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(finalUrl, nextDomain, nextClassification, row.id);
  }

  repaired += 1;
  changes.push({ id: row.id, status: dryRun ? "would-update" : "updated", title: row.title, oldUrl: row.url, newUrl: finalUrl });
}

const remainingBad = db
  .prepare("SELECT COUNT(*) AS count FROM signals WHERE url LIKE '%vertexaisearch%' OR url LIKE '%grounding-api-redirect%'")
  .get().count;

db.close();

console.log(
  JSON.stringify(
    {
      dryRun,
      scanned: selected.length,
      repaired,
      unchanged,
      failed,
      remainingBad,
      changes,
    },
    null,
    2,
  ),
);

function shouldRepair(row) {
  if (isGroundingRedirectUrl(row.url)) return true;
  if (!isUsableSourceUrl(row.url)) return true;
  return false;
}

async function resolveSourceUrl(row) {
  const direct = normalizeSourceUrl(row.url);
  if (isUsableSourceUrl(direct)) {
    const verified = await verifiedSourceUrl(direct);
    if (verified) return verified;
  }

  const cdpResolved = await resolveWithCdp(row, direct);
  if (cdpResolved) return cdpResolved;

  return "";
}

async function resolveWithCdp(row, candidateUrl) {
  if (!(await isCdpProxyAvailable())) return "";

  if (candidateUrl && /^https?:\/\//i.test(candidateUrl)) {
    const resolved = await inspectPageWithCdp(candidateUrl);
    if (resolved) return resolved;
  }

  const searchUrl = buildSearchUrl(row);
  if (!searchUrl) return "";

  const searchTarget = await openCdpTab(searchUrl);
  if (!searchTarget.targetId) return "";

  try {
    const links = await evalInCdp(searchTarget.targetId, extractLinksScript());
    const best = chooseBestLink(links.value || [], row);
    if (!best) return "";
    return await inspectPageWithCdp(best);
  } finally {
    await closeCdpTab(searchTarget.targetId);
  }
}

async function inspectPageWithCdp(url) {
  const target = await openCdpTab(url);
  if (!target.targetId) return "";

  try {
    const identity = await evalInCdp(target.targetId, pageIdentityScript());
    const candidates = [identity.value?.canonical, identity.value?.ogUrl, identity.value?.href].map((item) => normalizeSourceUrl(item || ""));
    for (const candidate of candidates) {
      if (!isUsableSourceUrl(candidate)) continue;
      const verified = await verifiedSourceUrl(candidate);
      if (verified) return verified;
    }
    return "";
  } finally {
    await closeCdpTab(target.targetId);
  }
}

async function verifiedSourceUrl(value) {
  const url = normalizeSourceUrl(value);
  if (!isUsableSourceUrl(url)) return "";
  const head = await requestHeaders(url, "HEAD");
  if (head.status === 404 || head.status === 410) return "";
  if (head.status >= 200 && head.status < 400) return usableFinalUrl(head.url || url);

  if (head.status === 405 || head.status >= 400) {
    const get = await requestHeaders(url, "GET");
    if (get.status === 404 || get.status === 410) return "";
    if (get.status >= 200 && get.status < 400) return usableFinalUrl(get.url || url);
  }

  return url;
}

async function requestHeaders(url, method) {
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AI-Ecosystem-Intelligence/1.0)",
      },
    });
    return { status: response.status, url: response.url };
  } catch {
    return { status: 0, url };
  }
}

async function isCdpProxyAvailable() {
  try {
    const response = await fetch(`${cdpBaseUrl}/health`, { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

async function openCdpTab(url) {
  try {
    const response = await fetch(`${cdpBaseUrl}/new?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

async function closeCdpTab(targetId) {
  try {
    await fetch(`${cdpBaseUrl}/close?target=${encodeURIComponent(targetId)}`, { signal: AbortSignal.timeout(3000) });
  } catch {
    // Best-effort cleanup only.
  }
}

async function evalInCdp(targetId, expression) {
  try {
    const response = await fetch(`${cdpBaseUrl}/eval?target=${encodeURIComponent(targetId)}`, {
      method: "POST",
      body: expression,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

function buildSearchUrl(row) {
  const domain = normalizeDomain(row.domain || "");
  const parts = [domain && !isBlockedSearchDomain(domain) ? `site:${domain}` : "", cleanText(row.title)].filter(Boolean);
  if (!parts.length) return "";
  return `https://www.google.com/search?q=${encodeURIComponent(parts.join(" "))}`;
}

function chooseBestLink(links, row) {
  const expectedDomain = normalizeDomain(row.domain || "");
  const titleTokens = tokenize(row.title || "");
  const ranked = links
    .map((link) => ({ url: normalizeSourceUrl(extractRealHref(link.href)), score: scoreLink(link, expectedDomain, titleTokens) }))
    .filter((item) => item.score > 0 && isUsableSourceUrl(item.url) && !isGroundingRedirectUrl(item.url))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.url || "";
}

function scoreLink(link, expectedDomain, titleTokens) {
  const url = normalizeSourceUrl(extractRealHref(link.href));
  if (!isUsableSourceUrl(url)) return 0;
  const domain = normalizeDomain(domainFromUrl(url));
  if (isBlockedSearchDomain(domain)) return 0;

  let score = 1;
  if (expectedDomain && (domain === expectedDomain || domain.endsWith(`.${expectedDomain}`) || expectedDomain.endsWith(`.${domain}`))) score += 8;
  const haystack = `${link.text} ${url}`.toLowerCase();
  score += titleTokens.filter((token) => haystack.includes(token)).length;
  if (url.includes("/search?") || url.includes("/preferences") || url.includes("/policies")) score -= 6;
  return score;
}

function uniqueUrlForRow(id, url) {
  const normalized = normalizeSourceUrl(url);
  const existing = db.prepare("SELECT id FROM signals WHERE url = ? AND id <> ?").get(normalized, id);
  if (!existing) return normalized;

  const parsed = new URL(normalized);
  parsed.hash = `ai-intel-${id.slice(0, 8)}`;
  return parsed.toString();
}

function mergeClassification(value, oldUrl, newUrl) {
  let parsed = {};
  try {
    parsed = JSON.parse(value || "{}");
  } catch {
    parsed = {};
  }
  return JSON.stringify({
    ...parsed,
    sourceLinkRepair: {
      repairedAt: new Date().toISOString(),
      oldUrl,
      newUrl,
      oldDomain: domainFromUrl(oldUrl),
      method: "web-access-cdp",
    },
  });
}

function normalizeSourceUrl(value) {
  const text = String(value || "").trim().replace(/[)\].,，。]+$/g, "");
  if (!text) return "";

  try {
    const url = new URL(text);
    if (url.hostname === "openai.com" && url.pathname.startsWith("/index/") && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/g, "");
    }
    return url.toString();
  } catch {
    return text;
  }
}

function isGroundingRedirectUrl(value) {
  const normalized = normalizeSourceUrl(value);
  try {
    const url = new URL(normalized);
    return url.hostname === groundingRedirectHost || url.pathname.includes("/grounding-api-redirect/");
  } catch {
    return normalized.includes(groundingRedirectHost) || normalized.includes("grounding-api-redirect");
  }
}

function isUsableSourceUrl(value) {
  const normalized = normalizeSourceUrl(value);
  if (!/^https?:\/\//i.test(normalized)) return false;
  if (isGroundingRedirectUrl(normalized)) return false;
  return true;
}

function usableFinalUrl(value) {
  const url = normalizeSourceUrl(value);
  return isUsableSourceUrl(url) ? url : "";
}

function extractRealHref(value) {
  try {
    const url = new URL(value);
    const nested = url.searchParams.get("q") || url.searchParams.get("url");
    if (nested && /^https?:\/\//i.test(nested)) return nested;
    return url.toString();
  } catch {
    return value;
  }
}

function pageIdentityScript() {
  return `(() => ({
    href: location.href,
    title: document.title,
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    ogUrl: document.querySelector('meta[property="og:url"], meta[name="og:url"]')?.content || ''
  }))()`;
}

function extractLinksScript() {
  return `(() => Array.from(document.querySelectorAll('a[href]')).map((a) => ({
    href: a.href,
    text: (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240)
  })).filter((item) => item.href && !item.href.includes('/search?') && !item.href.includes('accounts.google.com')).slice(0, 160))()`;
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter((token) => token.length >= 2)
    .slice(0, 18);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function domainFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isBlockedSearchDomain(domain) {
  if (!domain) return true;
  if (domain === "google.com" || domain.endsWith(".google.com")) return true;
  if (domain === "google.com.hk" || domain.endsWith(".google.com.hk")) return true;
  return ["about.google", "music.youtube.com", "vertexaisearch.cloud.google.com"].includes(domain);
}

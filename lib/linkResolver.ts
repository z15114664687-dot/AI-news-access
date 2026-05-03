import { isGroundingRedirectUrl, isUsableSourceUrl, normalizeSourceUrl, verifiedSourceUrl } from "./sourceUrls";

type LinkResolutionInput = {
  url?: string;
  title?: string;
  domain?: string;
  source?: string;
  query?: string;
};

type CdpTab = {
  targetId?: string;
};

type CdpEval<T> = {
  value?: T;
};

type PageLink = {
  href: string;
  text: string;
};

type PageIdentity = {
  canonical?: string;
  ogUrl?: string;
  href?: string;
  title?: string;
};

const cdpBaseUrl = process.env.CDP_PROXY_URL || "http://127.0.0.1:3456";

export async function resolveSourceUrl(input: LinkResolutionInput) {
  const candidateUrl = normalizeSourceUrl(input.url || "");
  const directUrl = isUsableSourceUrl(candidateUrl) ? await verifiedSourceUrl(candidateUrl) : "";
  if (directUrl) return directUrl;

  const cdpUrl = await resolveWithCdp({ ...input, url: candidateUrl });
  if (cdpUrl) return cdpUrl;

  return "";
}

async function resolveWithCdp(input: LinkResolutionInput) {
  if (process.env.SOURCE_LINK_RESOLVER === "http-only") return "";
  if (!(await isCdpProxyAvailable())) return "";

  const candidateUrl = normalizeSourceUrl(input.url || "");
  if (candidateUrl && /^https?:\/\//i.test(candidateUrl)) {
    const resolved = await inspectPageWithCdp(candidateUrl);
    if (resolved) return resolved;
  }

  const searchUrl = buildSearchUrl(input);
  if (!searchUrl) return "";

  const searchTarget = await openCdpTab(searchUrl);
  if (!searchTarget.targetId) return "";

  try {
    const links = await evalInCdp<PageLink[]>(searchTarget.targetId, extractLinksScript());
    const best = chooseBestLink(links.value || [], input);
    if (!best) return "";
    return await inspectPageWithCdp(best);
  } finally {
    await closeCdpTab(searchTarget.targetId);
  }
}

async function inspectPageWithCdp(url: string) {
  const target = await openCdpTab(url);
  if (!target.targetId) return "";

  try {
    const identity = await evalInCdp<PageIdentity>(target.targetId, pageIdentityScript());
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

async function isCdpProxyAvailable() {
  try {
    const response = await fetch(`${cdpBaseUrl}/health`, { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

async function openCdpTab(url: string): Promise<CdpTab> {
  try {
    const response = await fetch(`${cdpBaseUrl}/new?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return {};
    return (await response.json()) as CdpTab;
  } catch {
    return {};
  }
}

async function closeCdpTab(targetId: string) {
  try {
    await fetch(`${cdpBaseUrl}/close?target=${encodeURIComponent(targetId)}`, { signal: AbortSignal.timeout(3000) });
  } catch {
    // Best-effort cleanup only.
  }
}

async function evalInCdp<T>(targetId: string, expression: string): Promise<CdpEval<T>> {
  try {
    const response = await fetch(`${cdpBaseUrl}/eval?target=${encodeURIComponent(targetId)}`, {
      method: "POST",
      body: expression,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return {};
    return (await response.json()) as CdpEval<T>;
  } catch {
    return {};
  }
}

function buildSearchUrl(input: LinkResolutionInput) {
  const title = cleanText(input.title || "");
  const query = cleanText(input.query || "");
  const domain = normalizeDomain(input.domain || "");
  const parts = [domain && !isBlockedSearchDomain(domain) ? `site:${domain}` : "", query || title].filter(Boolean);
  if (!parts.length) return "";
  return `https://www.google.com/search?q=${encodeURIComponent(parts.join(" "))}`;
}

function chooseBestLink(links: PageLink[], input: LinkResolutionInput) {
  const expectedDomain = normalizeDomain(input.domain || "");
  const titleTokens = tokenize([input.title, input.query].filter(Boolean).join(" "));
  const ranked = links
    .map((link) => ({ url: normalizeSourceUrl(extractRealHref(link.href)), score: scoreLink(link, expectedDomain, titleTokens) }))
    .filter((item) => item.score > 0 && isUsableSourceUrl(item.url) && !isGroundingRedirectUrl(item.url))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.url || "";
}

function scoreLink(link: PageLink, expectedDomain: string, titleTokens: string[]) {
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

function extractRealHref(value: string) {
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

function tokenize(value: string) {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter((token) => token.length >= 2)
    .slice(0, 18);
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function domainFromUrl(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function isBlockedSearchDomain(domain: string) {
  if (!domain) return true;
  if (domain === "google.com" || domain.endsWith(".google.com")) return true;
  if (domain === "google.com.hk" || domain.endsWith(".google.com.hk")) return true;
  return ["about.google", "music.youtube.com", "vertexaisearch.cloud.google.com"].includes(domain);
}

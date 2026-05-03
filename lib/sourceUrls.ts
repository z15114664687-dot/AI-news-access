import type { Signal } from "./types";

const groundingRedirectHost = "vertexaisearch.cloud.google.com";
const verificationCache = new Map<string, Promise<string>>();

export function normalizeSourceUrl(value: string) {
  const text = value.trim().replace(/[)\].,，。]+$/g, "");
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

export function sourceKeyForUrl(value: string) {
  const normalized = normalizeSourceUrl(value);
  try {
    const url = new URL(normalized);
    url.hash = "";
    if ((url.hostname === "openai.com" || url.hostname.endsWith(".openai.com")) && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/g, "");
    }
    return url.toString();
  } catch {
    return normalized.replace(/#.*$/, "");
  }
}

export function isGroundingRedirectUrl(value: string) {
  const normalized = normalizeSourceUrl(value);
  try {
    const url = new URL(normalized);
    return url.hostname === groundingRedirectHost || url.pathname.includes("/grounding-api-redirect/");
  } catch {
    return normalized.includes(groundingRedirectHost) || normalized.includes("grounding-api-redirect");
  }
}

export function isUsableSourceUrl(value: string) {
  const normalized = normalizeSourceUrl(value);
  if (!/^https?:\/\//i.test(normalized)) return false;
  if (isGroundingRedirectUrl(normalized)) return false;
  return true;
}

export function sourceUrlForSignal(signal: Pick<Signal, "url">) {
  const url = normalizeSourceUrl(signal.url);
  return isUsableSourceUrl(url) ? url : "";
}

export async function verifiedSourceUrl(value: string) {
  const url = normalizeSourceUrl(value);
  if (!isUsableSourceUrl(url)) return "";

  const cached = verificationCache.get(url);
  if (cached) return cached;

  const task = verifyUrl(url);
  verificationCache.set(url, task);
  return task;
}

async function verifyUrl(url: string) {
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

async function requestHeaders(url: string, method: "HEAD" | "GET") {
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

function usableFinalUrl(value: string) {
  const url = normalizeSourceUrl(value);
  return isUsableSourceUrl(url) ? url : "";
}

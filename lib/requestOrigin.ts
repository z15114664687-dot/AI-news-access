export function sameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    // Next's internal URL can use localhost even when the browser requested 127.0.0.1.
    return source.host === (request.headers.get("host") || target.host) && source.protocol === target.protocol;
  } catch { return false; }
}

const base = process.env.LOCAL_APP_URL || "http://127.0.0.1:3000";
const pages = Math.min(100, Math.max(1, Number(process.argv[2]) || 5));
let more = false;
for (let page = 1; page <= pages; page += 1) {
  const response = await fetch(new URL("/api/aihot/sync", base), { method: "POST", signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  console.log(`Page ${page}: ${result.processed} records; ${result.state.mode}; ${result.state.total} saved`);
  more = result.hasMore;
  if (!more) break;
  await new Promise((resolve) => setTimeout(resolve, 400));
}
console.log(more ? "Progress saved. Run again to continue." : "Caught up with AIHOT.");

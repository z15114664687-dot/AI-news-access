// 定时采集入口：触发正在运行的本地服务开始采集，并轮询到结束。
// 用法：node scripts/collect.mjs [days]
// 环境变量：COLLECT_BASE_URL（默认 http://127.0.0.1:3000）
const baseUrl = (process.env.COLLECT_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const days = Number(process.argv[2] || process.env.COLLECT_DAYS || 30);
const pollIntervalMs = 5000;
const timeoutMs = 30 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const response = await fetch(`${baseUrl}/api/collect/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
  const data = await response.json().catch(() => ({}));
  const runId = data.run?.id;

  if (response.status === 409) {
    console.log(`Collection already running (run ${runId}), waiting for it to finish.`);
  } else if (!response.ok || !runId) {
    console.error(`Failed to start collection: HTTP ${response.status}`);
    process.exit(1);
  } else {
    console.log(`Collection started: run ${runId} (days=${days})`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const runsResponse = await fetch(`${baseUrl}/api/collect/runs`, { cache: "no-store" }).catch(() => null);
    if (!runsResponse || !runsResponse.ok) continue;
    const runsData = await runsResponse.json().catch(() => ({}));
    const run = (runsData.runs || []).find((item) => item.id === runId) || (runsData.runs || [])[0];
    if (!run || run.status === "running") continue;

    console.log(
      `Run ${run.id} ${run.status}: found=${run.foundCount} inserted=${run.insertedCount} skipped=${run.skippedCount} errors=${run.errorCount}`,
    );
    process.exit(run.status === "completed" ? 0 : 1);
  }

  console.error("Timed out waiting for collection to finish.");
  process.exit(1);
}

main().catch((error) => {
  console.error(`Collection script failed: ${error.message || error}`);
  process.exit(1);
});

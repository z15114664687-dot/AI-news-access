"use client";

import { useEffect, useState } from "react";

type SyncState = { mode: string; total: number; selected: number; lastSuccessAt: string | null; lastError: string | null; running: boolean };

export default function AIHOTSync({ onSynced }: { onSynced: () => Promise<void> }) {
  const [state, setState] = useState<SyncState | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [more, setMore] = useState(false);
  useEffect(() => {
    fetch("/api/aihot/sync", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("读取同步状态失败");
      setState((await response.json()).state);
    }).catch(() => setMessage("读取同步状态失败"));
  }, []);

  async function sync() {
    setRunning(true);
    setMessage("");
    let total = 0;
    try {
      for (let page = 0; page < 5; page += 1) {
        const response = await fetch("/api/aihot/sync", { method: "POST" });
        const data = await response.json();
        if (data.state) setState(data.state);
        if (!response.ok) throw new Error(data.error || "同步失败");
        total += data.processed;
        setMore(data.hasMore);
        setMessage(`本轮已处理 ${total} 条${data.hasMore ? "，尚有后续分页" : "，已追平上游"}`);
        if (!data.hasMore) break;
        if (page < 4) await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "同步失败"); }
    finally {
      await onSynced().catch(() => setMessage("同步已保存，但刷新信号失败，请刷新页面。"));
      setRunning(false);
    }
  }

  return <section className="aihot-sync">
    <div className="section-title"><h3>AIHOT 精选同步</h3>
      <button type="button" className="primary-action" disabled={running} onClick={sync}>
        {running ? "同步中…" : more || state?.mode === "snapshot" ? "继续同步" : "同步 AIHOT"}
      </button>
    </div>
    <dl className="sync-facts">
      <div><dt>已保存</dt><dd>{state?.total ?? 0}</dd></div>
      <div><dt>上游精选</dt><dd>{state?.selected ?? 0}</dd></div>
      <div><dt>阶段</dt><dd>{state?.mode === "changes" ? "增量更新" : "首次快照"}</dd></div>
      <div><dt>最近成功</dt><dd>{state?.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未同步"}</dd></div>
    </dl>
    {(message || state?.lastError) && <p role="status" className="review-message">{message || state?.lastError}</p>}
  </section>;
}

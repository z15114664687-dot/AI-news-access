"use client";

import { useState } from "react";
import type { Signal, TopicSuggestion } from "@/lib/types";

export default function TopicClassifier({ signal, onSaved }: { signal: Signal; onSaved: (signal: Signal) => void }) {
  const [suggestion, setSuggestion] = useState<TopicSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(action: "suggest" | "apply" | "reset") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/signals/${encodeURIComponent(signal.id)}/topic`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, hash: suggestion?.hash, revision: signal.revision, updatedAt: signal.updatedAt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "分类失败");
      if (data.suggestion) setSuggestion(data.suggestion);
      if (data.signal) onSaved(data.signal);
    } catch (error) { setError(error instanceof Error ? error.message : "分类失败"); }
    finally { setBusy(false); }
  }

  return <details className="signal-review topic-classification">
    <summary>Jev 话题分类{signal.topicOverride ? " · 已人工采用" : ""}</summary>
    <p>当前分类：{signal.topics.join(" / ")}</p>
    <div className="review-actions">
      <button type="button" className="secondary-action" disabled={busy} onClick={() => act("suggest")}>{busy ? "处理中…" : "获取分类建议"}</button>
      {signal.topicOverride && <button type="button" className="secondary-action" disabled={busy} onClick={() => act("reset")}>恢复采集分类</button>}
    </div>
    {suggestion && <div className="topic-result">
      <strong>建议：{suggestion.topic || "信息不足 / 不适用"}</strong>
      <p>分类置信度：{(suggestion.confidence * 100).toFixed(1)}% · 非事实可信度</p>
      <dl className="topic-probabilities">{suggestion.probabilities.map(({ topic, probability }) =>
        <div key={topic}><dt>{topic}</dt><dd>{(probability * 100).toFixed(1)}%</dd></div>)}</dl>
      <p>{suggestion.model} · {suggestion.cached ? "已保存结果" : "本次请求"}</p>
      {suggestion.topic && <button type="button" className="secondary-action" disabled={busy || signal.topicOverride === suggestion.topic} onClick={() => act("apply")}>采用此分类</button>}
    </div>}
    {error && <p role="alert" className="review-message">{error}</p>}
  </details>;
}

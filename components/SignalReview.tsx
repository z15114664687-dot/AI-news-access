"use client";

import { useState } from "react";
import type { Signal } from "@/lib/types";
import { sourceUrlForSignal } from "@/lib/sourceUrls";
import { evidenceForSignal } from "@/lib/evidence";

type Material = { provider: string; externalId: string; revision: number; receivedAt: string; payload: Record<string, unknown> };

export default function SignalReview({ signal, onSaved }: { signal: Signal; onSaved: (signal: Signal) => void }) {
  const review = evidenceForSignal(signal).reviewStatus;
  const [status, setStatus] = useState(review === "stale" ? "unreviewed" : review);
  const [note, setNote] = useState(signal.reviewNote || "");
  const [url, setUrl] = useState(sourceUrlForSignal(signal));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/signals/${encodeURIComponent(signal.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note, sourceUrl: url.trim(), revision: signal.revision, updatedAt: signal.updatedAt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? "内容已更新，请刷新后重新核验。" : data.error || "保存失败");
      onSaved(data.signal);
      setMessage("已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally { setSaving(false); }
  }

  async function loadMaterials() {
    setLoading(true);
    try {
      const response = await fetch(`/api/signals/${encodeURIComponent(signal.id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("读取材料失败");
      const data = await response.json();
      setMaterials(data.materials);
    } catch { setMessage("读取材料失败，请重试。"); }
    finally { setLoading(false); }
  }

  return <details className="signal-review">
    <summary>核验与备注</summary>
    <form onSubmit={save}>
      <label>原文链接<input type="url" value={url} maxLength={4000} onChange={(event) => setUrl(event.target.value)} /></label>
      <label>核验状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
        <option value="unreviewed">待核验</option><option value="confirmed">已核对原文与当前摘要</option><option value="dismissed">忽略，不纳入报告</option>
      </select></label>
      <label>研究备注<textarea rows={3} maxLength={5000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="review-actions">
        <button type="submit" className="secondary-action" disabled={saving}>{saving ? "保存中…" : "保存核验"}</button>
        <button type="button" className="secondary-action" onClick={loadMaterials} disabled={loading}>{loading ? "读取中…" : "来源版本"}</button>
      </div>
      {message && <p role="status" className="review-message">{message}</p>}
    </form>
    {materials && <div className="material-history">
      {materials.length ? materials.map((material) => <details key={`${material.provider}:${material.externalId}:${material.revision}`}>
        <summary>{material.provider} · v{material.revision} · {material.receivedAt}</summary>
        <pre>{JSON.stringify(material.payload, null, 2)}</pre>
      </details>) : <p>历史条目尚未保存原始材料版本。</p>}
    </div>}
  </details>;
}

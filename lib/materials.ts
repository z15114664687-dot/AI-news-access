import crypto from "node:crypto";
import { db, getSignal, insertSignal } from "./db";
import { sourceKeyForUrl } from "./sourceUrls";
import type { Signal } from "./types";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function ingestMaterial(provider: string, externalId: string, incoming: Omit<Signal, "createdAt" | "updatedAt">, payload: unknown, selected = true, generation: string | null = null) {
  return db.transaction(() => {
    const serialized = JSON.stringify(canonical(payload));
    const hash = crypto.createHash("sha256").update(serialized).digest("hex");
    const record = db.prepare("SELECT * FROM material_records WHERE provider = ? AND external_id = ?").get(provider, externalId) as
      { signal_id: string; revision: number; content_hash: string } | undefined;
    const match = record || db.prepare("SELECT id AS signal_id FROM signals WHERE source_key = ? OR url = ? LIMIT 1").get(sourceKeyForUrl(incoming.url), incoming.url) as { signal_id: string } | undefined;
    const id = match?.signal_id || incoming.id;
    if (!match) insertSignal(incoming);
    const revised = Boolean(record && record.content_hash !== hash);
    const revision = record ? record.revision + (revised ? 1 : 0) : 1;
    db.prepare(`INSERT INTO material_records (provider, external_id, signal_id, revision, content_hash, selected, snapshot_generation)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider, external_id) DO UPDATE SET
      revision = excluded.revision, content_hash = excluded.content_hash, selected = excluded.selected,
      snapshot_generation = coalesce(excluded.snapshot_generation, material_records.snapshot_generation), updated_at = CURRENT_TIMESTAMP`)
      .run(provider, externalId, id, revision, hash, selected ? 1 : 0, generation);
    if (!record || revised) {
      db.prepare("INSERT INTO material_versions (provider, external_id, revision, payload) VALUES (?, ?, ?, ?)").run(provider, externalId, revision, serialized);
    }
    const current = getSignal(id)!;
    // A second discovery channel must not rewrite the original channel's representation.
    const ownsSignal = current.collectionSource === incoming.collectionSource &&
      (!current.aiClassification.externalId || current.aiClassification.externalId === externalId);
    if (revised && ownsSignal) {
      db.prepare(`UPDATE signals SET date = ?, entity = ?, companies = ?, product = ?, title = ?, summary = ?, topics = ?,
        source = ?, domain = ?, url = ?, source_key = ?, ai_classification = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
        .run(incoming.date, incoming.entity, JSON.stringify(incoming.companies), incoming.product, incoming.title, incoming.summary,
          JSON.stringify(incoming.topics), incoming.source, incoming.domain, incoming.url, sourceKeyForUrl(incoming.url), JSON.stringify(incoming.aiClassification), new Date().toISOString(), id);
    }
    return { id, created: !match, revised, revision };
  })();
}

export function materialHistory(signalId: string) {
  const rows = db.prepare(`SELECT v.provider, v.external_id, v.revision, v.payload, v.received_at FROM material_versions v
    JOIN material_records r USING (provider, external_id) WHERE r.signal_id = ? ORDER BY v.received_at DESC, v.revision DESC`).all(signalId) as
    Array<{ provider: string; external_id: string; revision: number; payload: string; received_at: string }>;
  return rows.map((row) => ({ provider: row.provider, externalId: row.external_id, revision: row.revision, receivedAt: row.received_at, payload: JSON.parse(row.payload) as Record<string, unknown> }));
}

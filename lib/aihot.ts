import crypto from "node:crypto";
import { db } from "./db";
import { classifySearchResult } from "./classifier";
import { normalizePublicationDate, sourceStatus } from "./evidence";
import { ingestMaterial } from "./materials";

const provider = "aihot";
const base = "https://aihot.news";

type StateRow = {
  mode: "snapshot" | "changes";
  cursor: string | null;
  next_page: string | null;
  generation: string;
  last_success_at: string | null;
  last_error: string | null;
  lease_token: string | null;
  lease_until: string | null;
};

type Item = {
  id: string; title: string; originalTitle?: string | null; summary: string | null;
  source: { name: string }; links: { original: string; aihot: string };
  publishedAt: string | null; discoveredAt: string; category: string | null; score: number | null; selected: boolean;
};
type Change = { op: "upsert"; item: Item } | { op: "remove"; id: string };
type Page = { cursor: string; hasMore: boolean; nextPage: string | null; items: Item[]; changes: Change[] };

function stateRow() {
  return db.prepare("SELECT * FROM sync_state WHERE provider = ?").get(provider) as StateRow | undefined;
}

export function getSyncState() {
  const state = stateRow();
  const counts = db.prepare("SELECT count(*) AS total, coalesce(sum(selected), 0) AS selected FROM material_records WHERE provider = ?").get(provider) as { total: number; selected: number };
  return {
    mode: state?.mode || "snapshot", nextPage: state?.next_page || null,
    lastSuccessAt: state?.last_success_at || null, lastError: state?.last_error || null,
    running: Boolean(state?.lease_token && state.lease_until && state.lease_until > new Date().toISOString()),
    initialized: Boolean(state?.cursor), total: counts.total, selected: counts.selected,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AIHOT object");
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 10000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid AIHOT text field");
  return value;
}

function itemFrom(value: unknown): Item {
  const item = object(value);
  const source = object(item.source);
  const links = object(item.links);
  for (const link of [links.original, links.aihot]) {
    if (sourceStatus(text(link)) === "missing") throw new Error("Invalid AIHOT source link");
  }
  text(item.id, 300);
  text(item.title);
  text(source.name, 1000);
  if (item.summary !== null && typeof item.summary !== "string") throw new Error("Invalid AIHOT summary");
  if (item.publishedAt !== null && (typeof item.publishedAt !== "string" || !Number.isFinite(Date.parse(item.publishedAt)))) throw new Error("Invalid AIHOT publication date");
  if (typeof item.discoveredAt !== "string" || !Number.isFinite(Date.parse(item.discoveredAt))) throw new Error("Invalid AIHOT discovery date");
  if (typeof item.selected !== "boolean" || (item.category !== null && typeof item.category !== "string")) throw new Error("Invalid AIHOT classification");
  if (item.score !== null && (typeof item.score !== "number" || item.score < 0 || item.score > 100)) throw new Error("Invalid AIHOT score");
  return item as unknown as Item;
}

function parsePage(value: unknown, mode: StateRow["mode"]): Page {
  const raw = object(value);
  if (raw.schemaVersion !== 1 || raw.fields !== "default" || typeof raw.hasMore !== "boolean") throw new Error("Unsupported AIHOT page schema");
  const cursor = text(raw.cursor);
  const values = mode === "snapshot" ? raw.items : raw.changes;
  if (!Array.isArray(values) || values.length > 100 || raw.count !== values.length) throw new Error("Invalid AIHOT page count");
  const nextPage = mode === "snapshot" && raw.hasMore ? text(raw.nextPage) : null;
  const items = mode === "snapshot" ? values.map(itemFrom) : [];
  const changes: Change[] = mode === "changes" ? values.map((value) => {
    const change = object(value);
    if (change.op === "upsert") return { op: "upsert" as const, item: itemFrom(change.item) };
    if (change.op === "remove") return { op: "remove" as const, id: text(change.id, 300) };
    throw new Error("Unknown AIHOT change operation");
  }) : [];
  return { cursor, hasMore: raw.hasMore, nextPage, items, changes };
}

function importItem(item: Item, generation: string | null) {
  const domain = new URL(item.links.original).hostname;
  const signal = classifySearchResult({ title: item.title, snippet: item.summary || "", url: item.links.original,
    sourceName: item.source.name, sourceDomain: domain, discoveredBy: provider, date: item.publishedAt || undefined });
  signal.id = `aihot-${crypto.createHash("sha256").update(item.id).digest("hex").slice(0, 24)}`;
  signal.date = normalizePublicationDate(item.publishedAt);
  signal.discoveredAt = item.discoveredAt;
  signal.confidence = "unknown";
  signal.evidenceLevel = "unknown";
  signal.aiClassification = { ...signal.aiClassification, externalId: item.id, upstreamCategory: item.category, upstreamScore: item.score, upstreamUrl: item.links.aihot, needsReview: true };
  return ingestMaterial(provider, item.id, signal, item, item.selected, generation);
}

// One bounded page per call. Page data and progress are committed in the same transaction.
export async function syncAIHOT() {
  const token = crypto.randomUUID();
  const state = db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO sync_state (provider, generation) VALUES (?, ?)").run(provider, crypto.randomUUID());
    const now = new Date();
    const claimed = db.prepare(`UPDATE sync_state SET lease_token = ?, lease_until = ? WHERE provider = ? AND (lease_token IS NULL OR lease_until <= ?)`)
      .run(token, new Date(now.getTime() + 90000).toISOString(), provider, now.toISOString());
    if (!claimed.changes) throw new Error("AIHOT sync already running");
    return stateRow()!;
  })();

  try {
    const url = new URL(`/api/v1/selected/${state.mode === "snapshot" ? "snapshot" : "changes"}`, base);
    url.searchParams.set("limit", "100");
    if (state.mode === "snapshot") {
      url.searchParams.set("fields", "default");
      if (state.next_page) url.searchParams.set("page", state.next_page);
    } else {
      url.searchParams.set("cursor", state.cursor!);
    }
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "AI-Ecosystem-Intelligence/0.1" }, signal: AbortSignal.timeout(25000), cache: "no-store" });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.status === 409 && (problem.code === "snapshot_required" || String(problem.type).endsWith("snapshot_required"))) {
        db.prepare("UPDATE sync_state SET mode = 'snapshot', cursor = NULL, next_page = NULL, generation = ?, last_error = NULL WHERE provider = ? AND lease_token = ?")
          .run(crypto.randomUUID(), provider, token);
        return { processed: 0, hasMore: true, reset: true, state: getSyncState() };
      }
      throw new Error(`AIHOT HTTP ${response.status}${response.headers.get("retry-after") ? `; retry after ${response.headers.get("retry-after")}s` : ""}`);
    }
    const page = parsePage(await response.json(), state.mode);
    if (state.mode === "snapshot" && state.cursor && state.cursor !== page.cursor) throw new Error("AIHOT snapshot watermark changed");
    if (page.hasMore && ((state.mode === "snapshot" && page.nextPage === state.next_page) || (state.mode === "changes" && page.cursor === state.cursor))) throw new Error("AIHOT pagination did not advance");
    db.transaction(() => {
      if (stateRow()?.lease_token !== token) throw new Error("AIHOT sync lease expired");
      if (state.mode === "snapshot") {
        for (const item of page.items) importItem(item, state.generation);
        if (!page.hasMore) db.prepare("UPDATE material_records SET selected = 0 WHERE provider = ? AND (snapshot_generation IS NULL OR snapshot_generation <> ?)").run(provider, state.generation);
      } else {
        for (const change of page.changes) {
          if (change.op === "upsert") importItem(change.item, null);
          else db.prepare("UPDATE material_records SET selected = 0, updated_at = CURRENT_TIMESTAMP WHERE provider = ? AND external_id = ?").run(provider, change.id);
        }
      }
      db.prepare("UPDATE sync_state SET mode = ?, cursor = ?, next_page = ?, last_success_at = ?, last_error = NULL WHERE provider = ? AND lease_token = ?")
        .run(state.mode === "snapshot" && page.hasMore ? "snapshot" : "changes", page.cursor, page.nextPage, new Date().toISOString(), provider, token);
    })();
    return { processed: page.items.length + page.changes.length, hasMore: state.mode === "snapshot" || page.hasMore, reset: false, state: getSyncState() };
  } catch (error) {
    db.prepare("UPDATE sync_state SET last_error = ? WHERE provider = ? AND lease_token = ?").run(error instanceof Error ? error.message : "AIHOT sync failed", provider, token);
    throw error;
  } finally {
    db.prepare("UPDATE sync_state SET lease_token = NULL, lease_until = NULL WHERE provider = ? AND lease_token = ?").run(provider, token);
  }
}

import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-intel-test-"));
process.env.SQLITE_PATH = path.join(directory, "test.db");
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
const store = await import("../.test-build/lib/db.js");
const { classifySearchResult } = await import("../.test-build/lib/classifier.js");
const { createReport } = await import("../.test-build/lib/reports.js");

after(() => {
  store.db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("review and sync accept the browser's local host but reject cross-site mutations", async () => {
  const { sameOriginMutation } = await import("../.test-build/lib/requestOrigin.js");
  const request = (headers) => new Request("http://localhost:3041/api/aihot/sync", { method: "POST", headers });
  assert.equal(sameOriginMutation(request({ host: "127.0.0.1:3041", origin: "http://127.0.0.1:3041" })), true);
  assert.equal(sameOriginMutation(request({ host: "127.0.0.1:3041", origin: "https://example.org" })), false);
  assert.equal(sameOriginMutation(request({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(sameOriginMutation(request({ origin: "null" })), false);
  assert.equal(sameOriginMutation(request({})), true);
});

test("signal listing keeps unknown publication dates and search links separate from verified evidence", async () => {
  await store.insertSignal(classifySearchResult({
    title: "Unknown date fixture",
    url: "https://www.google.com/search?q=fixture",
    snippet: "A search result without a publication date",
    sourceName: "Search",
    sourceDomain: "google.com",
    discoveredBy: "test",
  }));
  const [signal] = await store.listSignals({ query: "Unknown date fixture" });
  assert.equal(signal.date, "");
  assert.equal(signal.evidence.sourceStatus, "search");
  assert.equal(signal.evidence.reviewStatus, "unreviewed");
  assert.ok(signal.discoveredAt);
});

test("human review is persisted, version checked, and requires a direct source", async () => {
  const [search] = await store.listSignals({ query: "Unknown date fixture" });
  assert.throws(() => store.updateSignalReview(search.id, { status: "confirmed", note: "checked", revision: search.revision, updatedAt: search.updatedAt }), /direct source/);
  const input = classifySearchResult({ title: "Review fixture", url: "https://example.org/review", snippet: "A source", sourceName: "Example", sourceDomain: "example.org", discoveredBy: "test" });
  await store.insertSignal(input);
  const before = store.getSignal(input.id);
  store.updateSignalReview(input.id, { status: "confirmed", note: "Compared with original", revision: before.revision, updatedAt: before.updatedAt });
  const [reviewed] = await store.listSignals({ query: "Review fixture" });
  assert.equal(reviewed.evidence.reviewStatus, "confirmed");
  assert.equal(reviewed.reviewNote, "Compared with original");
  assert.throws(() => store.updateSignalReview(input.id, { status: "dismissed", note: "old tab", revision: before.revision, updatedAt: before.updatedAt }), /changed/);
});

const item = (id, extra = {}) => ({
  id, title: `OpenAI fixture ${id}`, originalTitle: `Original ${id}`, summary: "A recorded announcement",
  source: { name: "OpenAI" }, links: { original: `https://openai.com/index/${id}`, aihot: `https://aihot.news/a/${id}` },
  publishedAt: "2026-09-28T08:00:00Z", discoveredAt: "2026-09-28T09:00:00Z", category: "ai-models", score: 80, selected: true,
  ...extra,
});

test("AIHOT snapshot resumes after failure, replays idempotently and preserves review on withdrawal", async (t) => {
  const { syncAIHOT, getSyncState } = await import("../.test-build/lib/aihot.js");
  const responses = [
    { schemaVersion: 1, fields: "default", cursor: "watermark-1", hasMore: true, nextPage: "page-2", items: [item("one")], count: 1 },
    new Error("offline"),
    { schemaVersion: 1, fields: "default", cursor: "watermark-1", hasMore: false, nextPage: null, items: [item("two", { publishedAt: null })], count: 1 },
  ];
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return Response.json(response);
  });
  await syncAIHOT();
  assert.equal(getSyncState().mode, "snapshot");
  await assert.rejects(syncAIHOT(), /offline/);
  assert.equal(getSyncState().nextPage, "page-2");
  await syncAIHOT();
  assert.equal(urls[1], urls[2]);
  assert.equal(getSyncState().mode, "changes");
  const [one] = await store.listSignals({ query: "OpenAI fixture one" });
  const [two] = await store.listSignals({ query: "OpenAI fixture two" });
  assert.equal(two.date, "");
  store.updateSignalReview(one.id, { status: "confirmed", note: "Private research note", revision: one.revision, updatedAt: one.updatedAt });
  responses.push({ schemaVersion: 1, fields: "default", cursor: "watermark-2", hasMore: false, count: 2, changes: [{ op: "upsert", item: item("one") }, { op: "remove", id: "two" }] });
  await syncAIHOT();
  assert.equal(store.getSignal(one.id).revision, one.revision);
  assert.equal(store.getSignal(one.id).evidence.reviewStatus, "confirmed");
  assert.equal(store.getSignal(two.id).upstreamSelected, false);
  responses.push({ schemaVersion: 1, fields: "default", cursor: "watermark-3", hasMore: false, count: 1, changes: [{ op: "upsert", item: item("one", { summary: "Changed announcement" }) }] });
  await syncAIHOT();
  const updated = store.getSignal(one.id);
  assert.equal(updated.reviewNote, "Private research note");
  assert.equal(updated.evidence.reviewStatus, "stale");
  assert.equal(updated.revision, one.revision + 1);
  assert.equal((await store.listSignals({ query: "OpenAI fixture one" })).length, 1);
});

test("AIHOT invalid pages roll back all rows and expired watermarks rebuild without deleting notes", async (t) => {
  const { syncAIHOT, getSyncState } = await import("../.test-build/lib/aihot.js");
  const [one] = await store.listSignals({ query: "OpenAI fixture one" });
  const responses = [
    Response.json({ schemaVersion: 1, fields: "default", cursor: "bad-watermark", hasMore: false, count: 2, changes: [{ op: "upsert", item: item("rolled-back") }, { op: "upsert", item: { id: "malformed" } }] }),
    Response.json({ code: "snapshot_required" }, { status: 409 }),
    Response.json({ schemaVersion: 1, fields: "default", cursor: "new-epoch", hasMore: false, nextPage: null, items: [item("two")], count: 1 }),
  ];
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => { urls.push(String(url)); return responses.shift(); });
  await assert.rejects(syncAIHOT(), /Invalid AIHOT/);
  assert.equal((await store.listSignals({ query: "rolled-back" })).length, 0);
  await syncAIHOT();
  assert.ok(urls[1].includes("watermark-3"));
  assert.equal(getSyncState().mode, "snapshot");
  assert.equal(store.getSignal(one.id).upstreamSelected, true);
  await syncAIHOT();
  assert.equal(store.getSignal(one.id).upstreamSelected, false);
  assert.equal(store.getSignal(one.id).reviewNote, "Private research note");
});

test("reports disclose actual coverage and never cite search pages or invent fallback trends", async () => {
  for (let i = 0; i < 43; i += 1) {
    await store.insertSignal(classifySearchResult({ title: `Report fixture ${i}`, url: `https://example.org/report-${i}`, snippet: `Recorded change ${i}`, sourceName: "Example", sourceDomain: "example.org", discoveredBy: "test", date: i === 0 ? "2026-02-30" : "2026-09-28" }));
  }
  await store.insertSignal(classifySearchResult({ title: "Report fixture search", url: "https://www.google.com/search?q=report-fixture", snippet: "Unresolved", sourceName: "Search", sourceDomain: "google.com", discoveredBy: "test" }));
  const report = await createReport({ query: "Report fixture" });
  assert.equal(report.signalCount, 44);
  assert.equal(report.selectedCount, 40);
  assert.equal(report.evidence.length, 40);
  assert.ok(report.markdown.includes("44"));
  assert.ok(report.markdown.includes("40"));
  assert.ok(!report.markdown.includes("google.com/search"));
  assert.ok(!report.markdown.includes("模型能力向 Agent"));
  assert.ok(report.markdown.includes("[E1]"));
  const empty = await createReport({ query: "Unknown date fixture" });
  assert.equal(empty.selectedCount, 0);
  assert.ok(empty.markdown.includes("缺少可引用"));
});

test("corrected original links can be reviewed without changing the stored source material", async () => {
  const [search] = await store.listSignals({ query: "Unknown date fixture" });
  const updated = store.updateSignalReview(search.id, { status: "confirmed", note: "Found original", sourceUrl: "https://example.org/original", revision: search.revision, updatedAt: search.updatedAt });
  assert.equal(updated.url, "https://example.org/original");
  assert.equal(updated.evidence.reviewStatus, "confirmed");
  assert.equal(updated.revision, search.revision + 1);
  assert.equal(updated.date, "");
  const report = await createReport({ query: "Unknown date fixture" });
  assert.equal(report.selectedCount, 1);
  assert.equal(report.evidence[0].url, "https://example.org/original");
  assert.ok(report.markdown.includes("发布时间未知"));
  assert.ok(!report.markdown.includes("Found original"));
  assert.deepEqual(store.getReport(report.id).evidence, report.evidence);
});

test("model reports accept only supplied references and retain reproducible input snapshots", async (t) => {
  process.env.GEMINI_API_KEY = "test-only-key";
  t.after(() => { delete process.env.GEMINI_API_KEY; });
  const replies = [
    { sections: [{ heading: "A sourced observation", text: "The saved material records an announcement.", references: ["E1"] }] },
    { sections: [{ heading: "Unsourced", text: "Unsupported claim", references: ["E999"] }] },
    { sections: [{ heading: "Unexpected link", text: "Read https://invented.example/claim", references: ["E1"] }] },
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(replies.shift()) }] } }] }));
  const valid = await createReport({ query: "Review fixture" });
  assert.equal(valid.mode, "model");
  assert.ok(valid.markdown.includes("example.org/review"));
  const invalid = await createReport({ query: "Review fixture" });
  assert.equal(invalid.mode, "digest");
  assert.equal(invalid.changes.unchanged, 1);
  assert.ok(!invalid.markdown.includes("Unsupported claim"));
  const badUrl = await createReport({ query: "Review fixture" });
  assert.equal(badUrl.mode, "digest");
  assert.ok(!badUrl.markdown.includes("invented.example"));
  assert.deepEqual(store.getReport(valid.id).evidence, valid.evidence);
});

test("sync prevents concurrent writers and rolls back a page when a later write fails", async (t) => {
  const { syncAIHOT, getSyncState } = await import("../.test-build/lib/aihot.js");
  let release;
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { release = resolve; }));
  const active = syncAIHOT();
  await assert.rejects(syncAIHOT(), /already running/);
  release(Response.json({ schemaVersion: 1, fields: "default", cursor: "concurrent-1", hasMore: false, count: 0, changes: [] }));
  await active;
  assert.equal(getSyncState().running, false);
  const pending = syncAIHOT();
  release(Response.json({ schemaVersion: 1, fields: "default", cursor: "must-not-commit", hasMore: false, count: 2, changes: [
    { op: "upsert", item: item("rollback-write") },
    { op: "upsert", item: item("two", { links: { original: "https://example.org/review", aihot: "https://aihot.news/a/two" } }) },
  ] }));
  await assert.rejects(pending, /UNIQUE/);
  assert.equal((await store.listSignals({ query: "rollback-write" })).length, 0);
  let lastUrl;
  t.mock.method(globalThis, "fetch", async (url) => {
    lastUrl = String(url);
    return Response.json({ schemaVersion: 1, fields: "default", cursor: "concurrent-1", hasMore: false, count: 0, changes: [] });
  });
  await syncAIHOT();
  assert.ok(lastUrl.includes("concurrent-1"));
  assert.equal(getSyncState().lastError, null);
});

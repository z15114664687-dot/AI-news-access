import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-intel-jev-test-"));
process.env.SQLITE_PATH = path.join(directory, "test.db");
process.env.TYPESAFE_API_KEY = "test-only-key";
delete process.env.TYPESAFE_MODEL;
const store = await import("../.test-build/lib/db.js");
const { classifySearchResult } = await import("../.test-build/lib/classifier.js");
after(() => { store.db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

const response = () => ({ model: "jev-1.13.0", answers: { topic: {
  type: "choice", choice: "model", confidence: 0.84,
  probabilities: { model: 0.9, agent: 0.02, tool: 0.02, content: 0.02, business: 0.02, unknown: 0.02 },
} }, usage: { input_tokens: 300, output_tokens: 30 } });

test("Jev suggests a topic without changing evidence or topics and reuses the completed judgment", async (t) => {
  const { suggestTopic } = await import("../.test-build/lib/jev.js");
  const input = classifySearchResult({ title: "模型发布 fixture", snippet: "新视频模型发布，重点是生成能力而非创作者分发。", url: "https://example.org/jev", sourceName: "Example", sourceDomain: "example.org", discoveredBy: "test" });
  store.insertSignal(input);
  const signal = store.getSignal(input.id);
  store.updateSignalReview(signal.id, { status: "unreviewed", note: "PRIVATE-NOTE", revision: signal.revision, updatedAt: signal.updatedAt });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls += 1;
    assert.equal(String(url), "https://api.typesafe.ai/v1/systemone");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.state, { title: input.title, summary: input.summary });
    assert.ok(!options.body.includes("PRIVATE-NOTE"));
    assert.equal(body.questions.topic.type, "choice");
    assert.ok(body.questions.topic.criteria.unknown);
    return Response.json(response());
  });
  const before = store.getSignal(input.id);
  const result = await suggestTopic(input.id, before);
  assert.equal(result.topic, "模型");
  assert.equal(result.confidence, 0.84);
  assert.equal(result.cached, false);
  assert.equal((await suggestTopic(input.id, before)).cached, true);
  assert.equal(calls, 1);
  assert.deepEqual(store.getSignal(input.id), before);
});

test("adopting a current Jev suggestion updates topic filters and reports without verifying facts", async () => {
  const { suggestTopic, applyTopicSuggestion } = await import("../.test-build/lib/jev.js");
  const [before] = await store.listSignals({ query: "模型发布 fixture" });
  const suggestion = await suggestTopic(before.id, before);
  const updated = applyTopicSuggestion(before.id, suggestion.hash, before);
  assert.deepEqual(updated.topics, ["模型"]);
  assert.equal(updated.topicOverride, "模型");
  assert.equal(updated.reviewNote, "PRIVATE-NOTE");
  assert.equal(updated.confidence, before.confidence);
  assert.equal(updated.evidence.reviewStatus, "unreviewed");
  assert.equal(updated.revision, before.revision + 1);
  assert.equal((await store.listSignals({ topic: "模型", query: "模型发布 fixture" })).length, 1);
  assert.equal((await store.listSignals({ topics: [before.topics[0]], query: "模型发布 fixture" })).length, 0);
  assert.throws(() => applyTopicSuggestion(before.id, suggestion.hash, before), /内容已更新/);
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  const { createReport } = await import("../.test-build/lib/reports.js");
  const report = await createReport({ topic: "模型", query: "模型发布 fixture" });
  assert.deepEqual(report.evidence[0].topics, ["模型"]);
});

function fixture(name) {
  const input = classifySearchResult({ title: `Jev ${name}`, snippet: `新视频模型能力 ${name}`, url: `https://example.org/${name}`, sourceName: "Example", sourceDomain: "example.org", discoveredBy: "test" });
  store.insertSignal(input);
  return store.getSignal(input.id);
}

test("missing credentials, HTTP errors, timeouts and malformed probabilities leave the signal unchanged", async (t) => {
  const { suggestTopic } = await import("../.test-build/lib/jev.js");
  const before = fixture("failure");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; return Response.json({}, { status: 429 }); });
  delete process.env.TYPESAFE_API_KEY;
  await assert.rejects(suggestTopic(before.id, before), /TYPESAFE_API_KEY/);
  assert.equal(calls, 0);
  process.env.TYPESAFE_API_KEY = "test-only-key";
  await assert.rejects(suggestTopic(before.id, before), /HTTP 429/);
  assert.equal(calls, 1);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network-secret-must-not-leak"); });
  await assert.rejects(suggestTopic(before.id, before), /网络失败/);
  for (const mutate of [
    (data) => { data.answers.topic.choice = "invented"; },
    (data) => { data.answers.topic.probabilities.model = 0.2; },
    (data) => { data.answers.topic.confidence = 2; },
    (data) => { delete data.answers.topic.probabilities.unknown; },
    (data) => { data.answers.topic.choice = "agent"; },
  ]) {
    const data = response(); mutate(data);
    t.mock.method(globalThis, "fetch", async () => Response.json(data));
    await assert.rejects(suggestTopic(before.id, before), /无效/);
  }
  assert.deepEqual(store.getSignal(before.id), before);
});

test("unknown outcomes cannot be adopted and uncertain distributions are retained without an automatic threshold", async (t) => {
  const { suggestTopic, applyTopicSuggestion } = await import("../.test-build/lib/jev.js");
  const before = fixture("uncertain");
  const data = response();
  data.answers.topic.choice = "unknown";
  data.answers.topic.confidence = 0.01;
  data.answers.topic.probabilities = { model: 0.16, agent: 0.16, tool: 0.16, content: 0.16, business: 0.16, unknown: 0.2 };
  t.mock.method(globalThis, "fetch", async () => Response.json(data));
  const suggestion = await suggestTopic(before.id, before);
  assert.equal(suggestion.topic, null);
  assert.equal(suggestion.probabilities.length, 6);
  assert.equal(suggestion.confidence, 0.01);
  assert.throws(() => applyTopicSuggestion(before.id, suggestion.hash, before), /信息不足/);
  assert.deepEqual(store.getSignal(before.id), before);
});

test("concurrent requests share inference and an edited signal rejects a stale response", async (t) => {
  const { suggestTopic } = await import("../.test-build/lib/jev.js");
  const before = fixture("concurrent");
  let release;
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls += 1; return new Promise((resolve) => { release = resolve; }); });
  const first = suggestTopic(before.id, before);
  const second = suggestTopic(before.id, before);
  const rejected = [assert.rejects(first, /内容已更新/), assert.rejects(second, /内容已更新/)];
  store.updateSignalReview(before.id, { status: "unreviewed", note: "Concurrent edit", revision: before.revision, updatedAt: before.updatedAt });
  release(Response.json(response()));
  await Promise.all(rejected);
  assert.equal(calls, 1);
  const current = store.getSignal(before.id);
  assert.equal((await suggestTopic(current.id, current)).cached, true);
  assert.equal(calls, 1);
});

test("upstream edits preserve an adopted topic and notes while old suggestions cannot be applied", async (t) => {
  const { suggestTopic, applyTopicSuggestion, resetTopicOverride } = await import("../.test-build/lib/jev.js");
  const { ingestMaterial } = await import("../.test-build/lib/materials.js");
  const initial = fixture("upstream");
  ingestMaterial("test", initial.id, initial, { title: initial.title });
  t.mock.method(globalThis, "fetch", async () => Response.json(response()));
  const before = store.updateSignalReview(initial.id, { status: "confirmed", note: "Keep this note", revision: initial.revision, updatedAt: initial.updatedAt });
  const suggestion = await suggestTopic(before.id, before);
  const adopted = applyTopicSuggestion(before.id, suggestion.hash, before);
  assert.equal(adopted.evidence.reviewStatus, "stale");
  const newTitle = "Agent 发布新的自主执行工具";
  ingestMaterial("test", before.id, { ...initial, title: newTitle, topics: ["Agent"] }, { title: newTitle });
  const changed = store.getSignal(before.id);
  assert.deepEqual(changed.topics, ["模型"]);
  assert.equal(changed.reviewNote, "Keep this note");
  assert.throws(() => applyTopicSuggestion(changed.id, suggestion.hash, changed), /已过期/);
  const reset = resetTopicOverride(changed.id, changed);
  assert.deepEqual(reset.topics, ["Agent"]);
  assert.equal(reset.topicOverride, null);
});

test("static export uses the adopted topic and excludes private notes and model responses", () => {
  execFileSync(process.execPath, [path.resolve("scripts/export-static-dashboard.mjs")], { cwd: directory, env: process.env, stdio: "pipe" });
  const html = fs.readFileSync(path.join(directory, "AI-news-dashboard.html"), "utf8");
  const signals = JSON.parse(html.match(/<script id="signals-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(signals.find((signal) => signal.title === "模型发布 fixture").topics, ["模型"]);
  assert.ok(!html.includes("PRIVATE-NOTE"));
  assert.ok(!html.includes("response_json"));
  assert.ok(!html.includes("test-only-key"));
});

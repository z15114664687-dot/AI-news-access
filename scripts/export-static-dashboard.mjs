#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const root = process.cwd();
const dbPath = process.env.SQLITE_PATH || path.join(root, "data", "ai-intel.db");
const cssPath = path.join(root, "styles.css");
const rootOutput = path.join(root, "AI-news-dashboard.html");
const docsDir = path.join(root, "docs");
const docsOutput = path.join(docsDir, "index.html");
const topicOrder = ["模型", "Agent", "工具", "内容生态", "商业化"];
const companyOrder = ["OpenAI", "Anthropic", "Google", "Amazon", "Microsoft", "Cursor"];

const signals = loadSignals();
const styles = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
const generatedAt = new Date().toISOString();
const html = renderHtml({ signals, styles, generatedAt });

fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(rootOutput, html);
fs.writeFileSync(docsOutput, html);

console.log(`Exported ${signals.length} signals to:`);
console.log(`- ${path.relative(root, rootOutput)}`);
console.log(`- ${path.relative(root, docsOutput)}`);

function loadSignals() {
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT * FROM signals ORDER BY date DESC, updated_at DESC").all();
    db.close();
    return rows.map(mapDbSignal);
  }

  const seedPath = path.join(root, "data", "signals.json");
  if (!fs.existsSync(seedPath)) return [];
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  return (seed.signals || []).map((signal) => ({
    id: signal.id,
    date: signal.date,
    entity: signal.entity,
    entityType: signal.entityType || "company",
    companies: signal.companies || [signal.entity].filter(Boolean),
    product: signal.product || "",
    title: signal.title,
    summary: signal.summary,
    topics: signal.topics || ["工具"],
    topicMode: signal.topicMode || "exclusive",
    source: signal.source,
    domain: signal.domain,
    url: signal.url,
    evidenceLevel: signal.evidenceLevel || "media",
    confidence: signal.confidence || "medium",
    collectionSource: "seed",
    confirmed: true,
    updatedAt: "",
  }));
}

function mapDbSignal(row) {
  return {
    id: String(row.id),
    date: String(row.date),
    entity: String(row.entity || ""),
    entityType: String(row.entity_type || ""),
    companies: parseJson(row.companies, []),
    product: String(row.product || ""),
    title: String(row.title || ""),
    summary: String(row.summary || ""),
    topics: parseJson(row.topics, ["工具"]),
    topicMode: String(row.topic_mode || "exclusive"),
    source: String(row.source || ""),
    domain: String(row.domain || ""),
    url: String(row.url || ""),
    evidenceLevel: String(row.evidence_level || "media"),
    confidence: String(row.confidence || "medium"),
    collectionSource: String(row.collection_source || ""),
    confirmed: Boolean(row.confirmed),
    updatedAt: String(row.updated_at || ""),
  };
}

function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function renderHtml({ signals, styles, generatedAt }) {
  const counts = countSignals(signals);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Ecosystem Intelligence Static Snapshot</title>
  <style>
${styles}

body.static-page { margin: 0; }
.static-banner {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 16px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #ffffff;
}
.static-banner strong { display: block; color: var(--ink); }
.static-banner span { color: var(--muted); font-size: 12px; }
.static-controls {
  display: grid;
  gap: 10px;
  margin: 0 0 14px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #ffffff;
}
.static-control-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.static-search {
  width: min(520px, 100%);
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font: inherit;
}
.static-chip {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f8fafc;
  color: var(--muted);
  font-weight: 800;
  cursor: pointer;
}
.static-chip.active { background: var(--navy); color: #fff; border-color: var(--navy); }
.static-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 14px;
}
.static-kpi {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #ffffff;
}
.static-kpi span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; }
.static-kpi strong { display: block; margin-top: 4px; color: var(--ink); font-size: 24px; line-height: 1; }
.static-empty {
  display: none;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #ffffff;
  color: var(--muted);
  text-align: center;
}
@media (max-width: 900px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar { position: static; min-height: auto; }
  .signal-grid, .static-summary-grid { grid-template-columns: 1fr; }
}
  </style>
</head>
<body class="static-page">
  <div id="appShell" class="app-shell">
    <aside class="sidebar">
      <div class="brand-block">
        <div class="brand-mark">AI</div>
        <div>
          <h1>AI Ecosystem Intelligence</h1>
          <p>静态快照 · 模型、Agent、工具、内容生态、商业化</p>
        </div>
      </div>
      <section class="sidebar-card">
        <span class="sidebar-kicker">STATIC</span>
        <strong>GitHub 静态版</strong>
        <p>无需本地服务，直接打开 HTML 即可浏览当前导出的情报卡片。</p>
      </section>
      <section class="nav-group">
        <h2>话题</h2>
        <div class="mode-switch" id="topicNav"></div>
      </section>
      <section class="nav-group">
        <h2>公司</h2>
        <div class="mode-switch" id="companyNav"></div>
      </section>
    </aside>
    <main id="mainContent" class="main-content">
      <div class="snapshot-line">Snapshot · ${escapeHtml(formatDate(generatedAt))}</div>
      <div class="topbar">
        <div>
          <h2 id="pageTitle">AI 情报总览</h2>
        </div>
        <input class="search-box static-search" id="searchInput" type="search" placeholder="搜索公司、产品、主题或来源" />
      </div>
      <section class="brief-grid">
        <article><span>FOCUS</span><strong>模型能力、Agent 执行层与企业工具化持续交汇</strong></article>
        <article><span>METHOD</span><strong>静态 HTML 内嵌当前 SQLite 快照，来源链接可直接打开</strong></article>
        <article><span>REVIEW</span><strong>保留确认状态与来源级别，便于后续人工校正</strong></article>
      </section>
      <section class="static-banner">
        <div>
          <strong>当前静态快照</strong>
          <span>生成时间：${escapeHtml(generatedAt)} · 共 ${signals.length} 条信号</span>
        </div>
        <span>如需刷新，运行 npm run static:export 后重新提交</span>
      </section>
      <section class="static-summary-grid" aria-label="概要指标">
        <div class="static-kpi"><span>信号</span><strong>${signals.length}</strong></div>
        <div class="static-kpi"><span>公司 / 主体</span><strong>${counts.companyCount}</strong></div>
        <div class="static-kpi"><span>一手来源</span><strong>${counts.officialCount}</strong></div>
        <div class="static-kpi"><span>高可信</span><strong>${counts.highCount}</strong></div>
      </section>
      <section class="static-controls">
        <div class="static-control-row" id="topicChips"></div>
        <div class="static-control-row" id="companyChips"></div>
      </section>
      <section id="signalsView" class="view active">
        <div class="section-head">
          <h3>信号卡片</h3>
          <span id="resultCount">${signals.length} 条</span>
        </div>
        <div class="signal-grid" id="signalGrid"></div>
        <p class="static-empty" id="emptyState">没有匹配信号</p>
      </section>
    </main>
  </div>
  <script id="signals-data" type="application/json">${escapeJsonForScript(JSON.stringify(signals))}</script>
  <script>
${clientScript()}
  </script>
</body>
</html>`;
}

function countSignals(signals) {
  const companies = new Set();
  let officialCount = 0;
  let highCount = 0;
  for (const signal of signals) {
    for (const company of signal.companies || []) companies.add(company);
    if (signal.evidenceLevel === "official") officialCount += 1;
    if (signal.confidence === "high") highCount += 1;
  }
  return { companyCount: companies.size, officialCount, highCount };
}

function clientScript() {
  return `(() => {
  const topicOrder = ${JSON.stringify(topicOrder)};
  const topicClass = { "模型": "model", "Agent": "agent", "工具": "tool", "内容生态": "content", "商业化": "commerce" };
  const preferredCompanies = ${JSON.stringify(companyOrder)};
  const signals = JSON.parse(document.getElementById("signals-data").textContent || "[]");
  const state = { topic: "all", company: "all", query: "" };

  const grid = document.getElementById("signalGrid");
  const resultCount = document.getElementById("resultCount");
  const emptyState = document.getElementById("emptyState");
  const searchInput = document.getElementById("searchInput");

  function companies() {
    const names = [...new Set(signals.flatMap((signal) => signal.companies || []).filter(Boolean))];
    return [...preferredCompanies.filter((name) => names.includes(name)), ...names.filter((name) => !preferredCompanies.includes(name)).sort()];
  }

  function renderFilters() {
    renderChipGroup("topicChips", ["all", ...topicOrder], "topic");
    renderChipGroup("topicNav", ["all", ...topicOrder], "topic", true);
    renderChipGroup("companyChips", ["all", ...companies()], "company");
    renderChipGroup("companyNav", ["all", ...companies()], "company", true);
  }

  function renderChipGroup(id, values, key, nav = false) {
    const root = document.getElementById(id);
    root.innerHTML = "";
    for (const value of values) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = nav ? "mode-button" : "static-chip";
      if (state[key] === value) button.classList.add("active");
      button.textContent = value === "all" ? (key === "topic" ? "全部话题" : "全部公司") : value;
      button.addEventListener("click", () => {
        state[key] = value;
        render();
      });
      root.appendChild(button);
    }
  }

  function filteredSignals() {
    const query = state.query.trim().toLowerCase();
    return signals.filter((signal) => {
      const topicMatch = state.topic === "all" || (signal.topics || []).includes(state.topic);
      const companyMatch = state.company === "all" || (signal.companies || []).includes(state.company);
      const text = [signal.title, signal.summary, signal.entity, signal.product, signal.source, signal.domain, ...(signal.companies || []), ...(signal.topics || [])].join(" ").toLowerCase();
      return topicMatch && companyMatch && (!query || text.includes(query));
    });
  }

  function renderCards(items) {
    grid.innerHTML = "";
    for (const signal of items) {
      const topic = (signal.topics && signal.topics[0]) || "工具";
      const article = document.createElement("article");
      article.className = "signal-card";
      article.innerHTML = \`
        <div class="signal-top">
          <span class="tag \${topicClass[topic] || "tool"}">\${escapeHtml(topic)}</span>
          <span>\${escapeHtml(signal.date || "")}</span>
        </div>
        <h4>\${escapeHtml(signal.title || "")}</h4>
        <p>\${escapeHtml(signal.summary || "")}</p>
        <div class="evidence-line">
          <span class="evidence-pill">\${formatEvidence(signal.evidenceLevel)}</span>
          <span class="evidence-pill">\${formatConfidence(signal.confidence)}</span>
          <span class="evidence-pill">\${signal.confirmed ? "已确认" : "待确认"}</span>
        </div>
        <div class="signal-meta">
          <span><b>\${escapeHtml((signal.companies || []).join(" / ") || signal.entity || "")}</b> · \${escapeHtml(signal.product || "")}</span>
          <span>\${escapeHtml(signal.source || "")} · \${escapeHtml(signal.domain || "")}</span>
          <span>采集：\${escapeHtml(signal.collectionSource || "")} · 更新：\${escapeHtml(formatDateTime(signal.updatedAt || ""))}</span>
          \${signal.url ? \`<a href="\${escapeAttr(signal.url)}" target="_blank" rel="noreferrer">打开来源</a>\` : "<span>来源链接待核验</span>"}
        </div>\`;
      grid.appendChild(article);
    }
  }

  function renderTitle(count) {
    const title = state.company !== "all" ? \`\${state.company} 公司页\` : state.topic !== "all" ? \`\${state.topic} 时间线\` : "AI 情报总览";
    document.getElementById("pageTitle").textContent = title;
    resultCount.textContent = \`\${count} 条\`;
  }

  function render() {
    renderFilters();
    const items = filteredSignals();
    renderTitle(items.length);
    renderCards(items);
    emptyState.style.display = items.length ? "none" : "block";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;" }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/\\n/g, "");
  }

  function formatEvidence(value) {
    return value === "official" ? "一手" : value === "analysis" ? "分析" : "媒体";
  }

  function formatConfidence(value) {
    return value === "high" ? "高可信" : value === "low" ? "低可信" : "中可信";
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value || "";
    render();
  });

  render();
})();`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

function escapeJsonForScript(value) {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function formatDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

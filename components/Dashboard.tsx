"use client";

import { useEffect, useMemo, useState } from "react";
import type { CollectionRun, Signal, Source } from "@/lib/types";

const topicOrder = ["模型", "Agent", "工具", "内容生态", "商业化"];
const topicClass: Record<string, string> = {
  模型: "model",
  Agent: "agent",
  工具: "tool",
  内容生态: "content",
  商业化: "commerce",
};
const topicColor: Record<string, string> = {
  模型: "#6d28d9",
  Agent: "#2563eb",
  工具: "#0f766e",
  内容生态: "#b45309",
  商业化: "#be123c",
};
const preferredCompanyOrder = ["OpenAI", "Anthropic", "Google", "Cursor"];

type Mode = "overview" | "topic" | "company";
type View = "signals" | "matrix" | "map" | "collect";
type ReportTab = "companies" | "topics" | "date";

type ReportState = {
  tab: ReportTab;
  topics: string[];
  companies: string[];
  startDate: string;
  endDate: string;
  markdown: string;
  filename: string;
};

type CollectorConfigStatus = {
  hasGeminiKey: boolean;
  geminiModel: string;
  defaultDays: number;
  queryLimit: number;
};

export default function Dashboard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<CollectionRun[]>([]);
  const [collectorConfig, setCollectorConfig] = useState<CollectorConfigStatus>({
    hasGeminiKey: false,
    geminiModel: "gemini-2.5-flash",
    defaultDays: 30,
    queryLimit: 12,
  });
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [mode, setMode] = useState<Mode>("overview");
  const [topic, setTopic] = useState("all");
  const [companyName, setCompanyName] = useState("all");
  const [view, setView] = useState<View>("signals");
  const [query, setQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collectDays, setCollectDays] = useState(30);
  const [report, setReport] = useState<ReportState>({
    tab: "companies",
    topics: [],
    companies: [],
    startDate: "",
    endDate: "",
    markdown: "",
    filename: "ai-intelligence-report.md",
  });

  useEffect(() => {
    Promise.all([loadSignals(), loadCollectionState(true)]).finally(() => setLoading(false));
  }, []);

  const companies = useMemo(() => companyList(signals), [signals]);

  const filteredSignals = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return signals.filter((signal) => {
      const topicMatch = mode !== "topic" || topic === "all" || signal.topics.includes(topic);
      const companyMatch =
        mode !== "company" || (isCompanySignal(signal) && (companyName === "all" || company(signal).includes(companyName)));
      const queryText = [
        signal.entity,
        company(signal).join(" "),
        signal.product,
        signal.title,
        signal.summary,
        signal.source,
        signal.domain,
        signal.topics.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return topicMatch && companyMatch && (!normalizedQuery || queryText.includes(normalizedQuery));
    });
  }, [signals, mode, topic, companyName, query]);

  const pageTitle =
    mode === "overview"
      ? "AI 情报总览"
      : mode === "topic"
        ? topic === "all"
          ? "按话题查看"
          : `${topic} 时间线`
        : companyName === "all"
          ? "按公司查看"
          : `${companyName} 公司页`;

  const briefingFocus =
    mode === "overview"
      ? "模型能力正在向 Agent 执行层和企业工具层迁移"
      : mode === "topic"
        ? "当前视图聚焦同一主题下的跨公司与行业信号"
        : "当前视图聚焦单公司相关的主题覆盖与近期动作";

  async function loadSignals() {
    const response = await fetch("/api/signals", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      setSignals(data.signals || []);
    }
  }

  async function loadCollectionState(applyDefaultDays = false) {
    const response = await fetch("/api/collect/runs", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      setSources(data.sources || []);
      setRuns(data.runs || []);
      if (data.config) {
        setCollectorConfig(data.config);
        if (applyDefaultDays) setCollectDays(Number(data.config.defaultDays) || 30);
      }
    }
  }

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    setTopic(nextMode === "topic" ? topicOrder[0] : "all");
    setCompanyName(nextMode === "company" ? companies[0] || "all" : "all");
    resetReport(nextMode);
  }

  function resetReport(nextMode = mode) {
    setReport({
      tab: nextMode === "company" ? "topics" : "companies",
      topics: [],
      companies: [],
      startDate: "",
      endDate: "",
      markdown: "",
      filename: "ai-intelligence-report.md",
    });
  }

  async function generateReport() {
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: mode === "company" && companyName !== "all" ? companyName : undefined,
        topic: mode === "topic" && topic !== "all" ? topic : undefined,
        companies: mode !== "company" ? report.companies : undefined,
        topics: mode !== "topic" ? report.topics : undefined,
        startDate: report.startDate || undefined,
        endDate: report.endDate || undefined,
        query: query || undefined,
      }),
    });
    if (!response.ok) return;
    const data = await response.json();
    setReport((current) => ({
      ...current,
      markdown: data.report.markdown,
      filename: data.report.filename,
    }));
  }

  async function runCollector() {
    setCollecting(true);
    try {
      await fetch("/api/collect/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: collectDays }),
      });
      await Promise.all([loadSignals(), loadCollectionState()]);
    } finally {
      setCollecting(false);
    }
  }

  function downloadReport(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!report.markdown) {
      event.preventDefault();
      return;
    }
    const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    event.currentTarget.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <a className="skip-link" href="#mainContent">
        跳到主内容
      </a>
      <div id="appShell" className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        <aside className="sidebar">
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <div className="brand-block">
            <div className="brand-mark">AI</div>
            <div>
              <h1>AI Ecosystem Intelligence</h1>
              <p>模型、Agent、工具、内容生态、商业化</p>
            </div>
          </div>

          <section className="sidebar-card">
            <span className="sidebar-kicker">Collector</span>
            <strong>本地采集层</strong>
            <p>手动触发 Gemini Google Search grounding，自动分类摘要，保留来源 URL 和运行记录。</p>
          </section>

          <section className="nav-group" aria-label="视角切换">
            <h2>视角</h2>
            <div className="mode-switch" role="group" aria-label="展示方式">
              {(["overview", "topic", "company"] as Mode[]).map((item) => (
                <button
                  key={item}
                  className={`mode-button${mode === item ? " active" : ""}`}
                  type="button"
                  aria-pressed={mode === item}
                  onClick={() => selectMode(item)}
                >
                  {item === "overview" ? "总览" : item === "topic" ? "By 话题" : "By 公司"}
                </button>
              ))}
            </div>
          </section>

          <nav className="topic-nav" aria-label={mode === "topic" ? "话题筛选" : mode === "company" ? "公司筛选" : "总览模式无额外筛选"}>
            {mode === "topic" &&
              topicOrder.map((item) => (
                <button
                  key={item}
                  className={`topic-button${topic === item ? " active" : ""}`}
                  type="button"
                  aria-pressed={topic === item}
                  onClick={() => {
                    setTopic(item);
                    resetReport("topic");
                  }}
                >
                  {item}
                </button>
              ))}
            {mode === "company" &&
              companies.map((item) => (
                <button
                  key={item}
                  className={`topic-button${companyName === item ? " active" : ""}`}
                  type="button"
                  aria-pressed={companyName === item}
                  onClick={() => {
                    setCompanyName(item);
                    resetReport("company");
                  }}
                >
                  {item}
                </button>
              ))}
          </nav>

          <section className="source-panel">
            <h2>来源层级</h2>
            <SourceMix signals={filteredSignals} />
          </section>
        </aside>

        <main id="mainContent" className="workspace">
          <header className="topbar">
            <div>
              <p className="eyebrow">Snapshot · {new Date().toISOString().slice(0, 10)}</p>
              <h2>{pageTitle}</h2>
            </div>
            <div className="toolbar">
              <label className="search-box" aria-label="搜索信号">
                <span aria-hidden="true" />
                <input value={query} type="search" placeholder="搜索公司、产品、主题或来源" onChange={(event) => setQuery(event.target.value)} />
              </label>
              <div className="segmented" role="group" aria-label="视图">
                {(["signals", "matrix", "map", "collect"] as View[]).map((item) => (
                  <button
                    key={item}
                    className={`view-button${view === item ? " active" : ""}`}
                    type="button"
                    aria-pressed={view === item}
                    onClick={() => setView(item)}
                  >
                    {item === "signals" ? "信号" : item === "matrix" ? "矩阵" : item === "map" ? "生态" : "采集"}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <section className="briefing-strip" aria-label="当前情报摘要">
            <div>
              <span>Focus</span>
              <strong>{briefingFocus}</strong>
            </div>
            <div>
              <span>Method</span>
              <strong>Gemini 搜索 grounding + 自动分类摘要 + 来源 URL 留痕</strong>
            </div>
            <div>
              <span>Review</span>
              <strong>自动采集条目默认未确认，高价值信号再原文核验</strong>
            </div>
          </section>

          <ReportBuilder
            mode={mode}
            topic={topic}
            companyName={companyName}
            companies={companies}
            report={report}
            setReport={setReport}
            generateReport={generateReport}
            downloadReport={downloadReport}
          />

          <Metrics signals={filteredSignals} />

          <section id="visualStrip" className={`visual-strip${mode === "topic" ? " timeline-only" : ""}`}>
            <div id="distributionPanel" className="viz-panel">
              <div className="section-title">
                <h3>{mode === "company" ? "公司主题分布" : "主题分布"}</h3>
                <span>{topicOrder.length} 个主题</span>
              </div>
              <TopicBars signals={filteredSignals} />
            </div>
            <div className="viz-panel">
              <div className="section-title">
                <h3>{mode === "topic" ? "话题时间线" : mode === "company" ? "公司时间线" : "近期时间线"}</h3>
                <span>{filteredSignals.length} 条 · 按日期倒序</span>
              </div>
              <Timeline signals={filteredSignals} />
            </div>
          </section>

          {loading ? <p className="empty-state">正在加载数据…</p> : null}

          <section id="signalsView" className={`view${view === "signals" ? " active" : ""}`}>
            <div className="section-title">
              <h3>信号卡片</h3>
              <span>{filteredSignals.length} 条</span>
            </div>
            <SignalGrid signals={filteredSignals} />
          </section>

          <section id="matrixView" className={`view${view === "matrix" ? " active" : ""}`}>
            <div className="section-title">
              <h3>对标矩阵</h3>
              <span>实体 × 主题</span>
            </div>
            <Matrix signals={filteredSignals} />
          </section>

          <section id="mapView" className={`view${view === "map" ? " active" : ""}`}>
            <div className="section-title">
              <h3>生态地图</h3>
              <span>实体、主题与来源关系</span>
            </div>
            <EcosystemMap signals={filteredSignals} />
          </section>

          <section id="collectView" className={`view${view === "collect" ? " active" : ""}`}>
            <div className="section-title">
              <h3>采集任务</h3>
              <span>{sources.length} 个来源配置</span>
            </div>
            <CollectionPanel
              sources={sources}
              runs={runs}
              collecting={collecting}
              collectDays={collectDays}
              setCollectDays={setCollectDays}
              config={collectorConfig}
              runCollector={runCollector}
            />
          </section>
        </main>
      </div>
    </>
  );
}

function ReportBuilder({
  mode,
  topic,
  companyName,
  companies,
  report,
  setReport,
  generateReport,
  downloadReport,
}: {
  mode: Mode;
  topic: string;
  companyName: string;
  companies: string[];
  report: ReportState;
  setReport: React.Dispatch<React.SetStateAction<ReportState>>;
  generateReport: () => void;
  downloadReport: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const isCompanyPage = mode === "company";
  const isTopicPage = mode === "topic";
  const scopeLabel = mode === "overview" ? "Overview report" : isCompanyPage ? "Company report" : "Topic report";
  const scopeTitle = mode === "overview" ? "总览总结报告" : isCompanyPage ? `${companyName} 总结报告` : `${topic} 总结报告`;
  const activeTab = isCompanyPage && report.tab === "companies" ? "topics" : isTopicPage && report.tab === "topics" ? "companies" : report.tab;

  function setTab(tab: ReportTab) {
    setReport((current) => ({ ...current, tab }));
  }

  function toggleFilter(key: "companies" | "topics", value: string) {
    setReport((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
    }));
  }

  return (
    <>
      <section className="report-builder active" aria-label="报告生成器">
        <div className="report-builder-head">
          <div>
            <span>{scopeLabel}</span>
            <strong>{scopeTitle}</strong>
          </div>
          <button className="primary-action" type="button" onClick={generateReport}>
            生成总结报告
          </button>
        </div>

        <div className="report-tabs" role="tablist" aria-label="报告筛选">
          {!isCompanyPage && (
            <button className={`report-tab${activeTab === "companies" ? " active" : ""}`} type="button" role="tab" aria-selected={activeTab === "companies"} onClick={() => setTab("companies")}>
              公司
            </button>
          )}
          {!isTopicPage && (
            <button className={`report-tab${activeTab === "topics" ? " active" : ""}`} type="button" role="tab" aria-selected={activeTab === "topics"} onClick={() => setTab("topics")}>
              话题
            </button>
          )}
          <button className={`report-tab${activeTab === "date" ? " active" : ""}`} type="button" role="tab" aria-selected={activeTab === "date"} onClick={() => setTab("date")}>
            时间范围
          </button>
        </div>

        {activeTab === "companies" && (
          <div className="report-panel active" role="tabpanel">
            <div className="filter-chip-grid">
              <span className="filter-helper">未选择时包含全部公司</span>
              {companies.map((item) => (
                <button key={item} className={`filter-chip${report.companies.includes(item) ? " active" : ""}`} type="button" aria-pressed={report.companies.includes(item)} onClick={() => toggleFilter("companies", item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === "topics" && (
          <div className="report-panel active" role="tabpanel">
            <div className="filter-chip-grid">
              <span className="filter-helper">未选择时包含全部话题</span>
              {topicOrder.map((item) => (
                <button key={item} className={`filter-chip${report.topics.includes(item) ? " active" : ""}`} type="button" aria-pressed={report.topics.includes(item)} onClick={() => toggleFilter("topics", item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === "date" && (
          <div className="report-panel active" role="tabpanel">
            <div className="date-range-grid">
              <label>
                <span>开始日期</span>
                <input type="date" value={report.startDate} onChange={(event) => setReport((current) => ({ ...current, startDate: event.target.value }))} />
              </label>
              <label>
                <span>结束日期</span>
                <input type="date" value={report.endDate} onChange={(event) => setReport((current) => ({ ...current, endDate: event.target.value }))} />
              </label>
              <button className="secondary-action" type="button" onClick={() => setReport((current) => ({ ...current, startDate: "", endDate: "" }))}>
                清除时间
              </button>
            </div>
          </div>
        )}
      </section>

      <details className={`report-preview${report.markdown ? " has-report" : ""}`}>
        <summary>
          <span>报告预览</span>
          <a className="download-link" href="#" download={report.filename} onClick={downloadReport}>
            下载 MD
          </a>
        </summary>
        <pre>{report.markdown}</pre>
      </details>
    </>
  );
}

function Metrics({ signals }: { signals: Signal[] }) {
  const entities = new Set(signals.flatMap(company));
  const primary = signals.filter((signal) => signal.evidenceLevel === "official").length;
  const high = signals.filter((signal) => signal.confidence === "high").length;
  return (
    <section className="metrics-grid" aria-label="指标概览">
      <Metric label="信号" value={signals.length} caption="当前筛选命中" />
      <Metric label="实体" value={entities.size} caption="公司 / 产品簇" />
      <Metric label="一手来源" value={primary} caption="官方证据" />
      <Metric label="高可信" value={high} caption="可直接引用" />
    </section>
  );
}

function Metric({ label, value, caption }: { label: string; value: number; caption: string }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{caption}</em>
    </article>
  );
}

function SourceMix({ signals }: { signals: Signal[] }) {
  const groups = countBy(signals, (signal) => signal.evidenceLevel);
  const labels: Record<string, string> = { official: "一手来源", media: "权威媒体", analysis: "分析转载" };
  const max = Math.max(1, ...Object.values(groups));
  return (
    <div className="source-mix">
      {Object.entries(labels).map(([key, label]) => {
        const value = groups[key] || 0;
        const width = Math.max(4, Math.round((value / max) * 100));
        return (
          <div className="source-row" key={key}>
            <span>
              <b>{label}</b>
              <b>{value}</b>
            </span>
            <div className="source-track">
              <div className="source-fill" style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopicBars({ signals }: { signals: Signal[] }) {
  const counts: Record<string, number> = {};
  signals.forEach((signal) => signal.topics.forEach((item) => (counts[item] = (counts[item] || 0) + 1)));
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="topic-bars">
      {topicOrder.map((item) => {
        const value = counts[item] || 0;
        const width = Math.max(3, Math.round((value / max) * 100));
        return (
          <div className="bar-row" key={item}>
            <span>{item}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${width}%`, background: topicColor[item] }} />
            </div>
            <strong>{value}</strong>
          </div>
        );
      })}
    </div>
  );
}

function Timeline({ signals }: { signals: Signal[] }) {
  const items = [...signals].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  if (!items.length) return <p className="empty-state">没有匹配信号</p>;
  return (
    <div className="timeline">
      {items.map((signal) => (
        <div className="timeline-item" key={signal.id}>
          <div className="timeline-date">{signal.date}</div>
          <p className="timeline-text">
            <b>{company(signal).join(" / ") || signal.entity}</b> · {signal.title}
          </p>
        </div>
      ))}
    </div>
  );
}

function SignalGrid({ signals }: { signals: Signal[] }) {
  if (!signals.length) return <p className="empty-state">没有匹配信号</p>;
  return (
    <div className="signal-grid">
      {signals.map((signal) => {
        const mainTopic = signal.topics[0] || "工具";
        return (
          <article className="signal-card" key={signal.id}>
            <div className="signal-top">
              <span className={`tag ${topicClass[mainTopic] || "tool"}`}>{mainTopic}</span>
              <span>{signal.date}</span>
            </div>
            <h4>{signal.title}</h4>
            <p>{signal.summary}</p>
            <div className="evidence-line">
              <span className="evidence-pill">{formatEvidence(signal.evidenceLevel)}</span>
              <span className="evidence-pill">{formatConfidence(signal.confidence)}</span>
              <span className="evidence-pill">{signal.confirmed ? "已确认" : "待确认"}</span>
              {signal.topics.slice(1).map((item) => (
                <span className="evidence-pill" key={item}>
                  {item}
                </span>
              ))}
              {signal.topicMode === "cross_topic" ? <span className="evidence-pill">跨话题</span> : null}
            </div>
            <div className="signal-meta">
              <span>
                <b>{company(signal).join(" / ") || signal.entity}</b> · {signal.product}
              </span>
              {signal.entityType === "company" ? null : <span>信号对象：{signal.entity}</span>}
              <span>
                {signal.source} · {signal.domain}
              </span>
              <span>
                采集：{signal.collectionSource} · 更新：{formatDateTime(signal.updatedAt)}
              </span>
              <a href={signal.url} target="_blank" rel="noreferrer">
                打开来源
              </a>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Matrix({ signals }: { signals: Signal[] }) {
  const matrixSignals = signals.filter(isCompanySignal);
  const entities = [...new Set(matrixSignals.flatMap(company))].sort();
  return (
    <div className="matrix-wrap">
      <table>
        <caption>仅展示明确归属于单一公司的信号；行业通用、市场协议和采用案例保留在时间线与信号卡片中。</caption>
        <thead>
          <tr>
            <th>实体</th>
            {topicOrder.map((item) => (
              <th key={item}>{item}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entities.map((entity) => (
            <tr key={entity}>
              <td>{entity}</td>
              {topicOrder.map((item) => {
                const hits = matrixSignals.filter((signal) => company(signal).includes(entity) && signal.topics.includes(item));
                return (
                  <td key={item}>
                    {hits.length ? <span className="matrix-count">{hits.length}</span> : " "}
                    {hits.map((hit) => (
                      <span className="cell-chip" key={hit.id}>
                        {hit.product}
                      </span>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EcosystemMap({ signals }: { signals: Signal[] }) {
  const mapSignals = signals.filter(isCompanySignal);
  const entities = [...new Set(mapSignals.flatMap(company))].sort();
  const domains = [...new Set(mapSignals.map((signal) => signal.domain))].slice(0, 10);
  const width = 1100;
  const height = 540;
  const center = { x: width / 2, y: height / 2 };
  const entityNodes = radialNodes(entities, center.x, center.y, 176, -90);
  const topicNodes = radialNodes(topicOrder, center.x, center.y, 72, -90);
  const sourceNodes = radialNodes(domains, center.x, center.y, 246, -60);
  const nodeMap = new Map([...entityNodes, ...topicNodes, ...sourceNodes].map((node) => [node.id, node]));
  const edges: Array<[string, string]> = [];
  mapSignals.forEach((signal) => {
    company(signal).forEach((entity) => {
      signal.topics.forEach((item) => edges.push([entity, item]));
      edges.push([entity, signal.domain]);
    });
  });

  return (
    <div className="ecosystem-map">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="AI 生态地图">
        {edges.map(([from, to], index) => {
          const a = nodeMap.get(from);
          const b = nodeMap.get(to);
          if (!a || !b) return null;
          return <line className="edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} key={`${from}-${to}-${index}`} />;
        })}
        <circle cx={center.x} cy={center.y} r="42" fill="#ffffff" stroke="#cbd5e1" />
        <text className="node-label" x={center.x} y={center.y - 4} textAnchor="middle">
          AI
        </text>
        <text className="node-label" x={center.x} y={center.y + 13} textAnchor="middle">
          Ecosystem
        </text>
        {topicNodes.map((node) => (
          <NodeSvg node={node} color={topicColor[node.id]} radius={19} key={node.id} />
        ))}
        {entityNodes.map((node) => (
          <NodeSvg node={node} color="#172033" radius={16} key={node.id} />
        ))}
        {sourceNodes.map((node) => (
          <NodeSvg node={node} color="#64748b" radius={9} key={node.id} />
        ))}
      </svg>
    </div>
  );
}

function CollectionPanel({
  sources,
  runs,
  collecting,
  collectDays,
  setCollectDays,
  config,
  runCollector,
}: {
  sources: Source[];
  runs: CollectionRun[];
  collecting: boolean;
  collectDays: number;
  setCollectDays: (days: number) => void;
  config: CollectorConfigStatus;
  runCollector: () => void;
}) {
  const latestRun = runs[0];
  const latestWarning = latestRun?.logs.find((log) => log.level === "warning" || log.level === "error");

  return (
    <div className="collect-grid">
      <section className="collect-card">
        <div className="report-builder-head">
          <div>
            <span>Manual run</span>
            <strong>Gemini 采集</strong>
          </div>
          <button className="primary-action" type="button" disabled={collecting} onClick={runCollector}>
            {collecting ? "采集中…" : "运行采集"}
          </button>
        </div>
        <div className="collect-status-grid">
          <div>
            <span>Gemini Key</span>
            <strong className={config.hasGeminiKey ? "status-ok" : "status-warn"}>
              {config.hasGeminiKey ? "已读取" : "未读取"}
            </strong>
          </div>
          <div>
            <span>模型</span>
            <strong>{config.geminiModel}</strong>
          </div>
          <div>
            <span>任务上限</span>
            <strong>{config.queryLimit}</strong>
          </div>
        </div>
        <div className="collect-controls">
          <label>
            <span>采集时间范围</span>
            <select value={collectDays} onChange={(event) => setCollectDays(Number(event.target.value))}>
              <option value={7}>最近 7 天</option>
              <option value={14}>最近 14 天</option>
              <option value={30}>最近 30 天</option>
              <option value={90}>最近 90 天</option>
              <option value={180}>最近 180 天</option>
            </select>
          </label>
        </div>
        <p className="collect-note">需要在 .env 配置 GEMINI_API_KEY。时间范围越短，越能减少无效搜索和 API 消耗。</p>
        {latestWarning ? <p className="collect-alert">{String(latestWarning.message || "最近一次采集没有写入新信号。")}</p> : null}
      </section>

      <section className="collect-card">
        <div className="section-title">
          <h3>来源配置</h3>
          <span>{sources.filter((source) => source.enabled).length} 个启用</span>
        </div>
        <div className="source-list">
          {sources.map((source) => (
            <div className="source-config-row" key={source.id}>
              <strong>{source.name}</strong>
              <span>{source.domain}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="collect-card collect-card-wide">
        <div className="section-title">
          <h3>最近运行</h3>
          <span>{runs.length} 条记录</span>
        </div>
        <div className="run-list">
          {runs.length ? (
            runs.map((run) => (
              <details className="run-row" key={run.id}>
                <summary>
                  <span className={`run-status ${run.status}`}>{run.status}</span>
                  <b>{formatDateTime(run.startedAt)}</b>
                  <span>发现 {run.foundCount} · 新增 {run.insertedCount} · 跳过 {run.skippedCount} · 错误 {run.errorCount}</span>
                </summary>
                <pre>{JSON.stringify(run.logs, null, 2)}</pre>
              </details>
            ))
          ) : (
            <p className="empty-state">还没有采集记录</p>
          )}
        </div>
      </section>
    </div>
  );
}

function NodeSvg({ node, color, radius }: { node: { id: string; x: number; y: number }; color: string; radius: number }) {
  return (
    <g>
      <circle cx={node.x} cy={node.y} r={radius} fill={color} />
      <text className="node-label" x={node.x} y={node.y + radius + 16} textAnchor="middle">
        {node.id}
      </text>
    </g>
  );
}

function radialNodes(items: string[], cx: number, cy: number, radius: number, startDeg: number) {
  return items.map((item, index) => {
    const deg = startDeg + (360 / Math.max(1, items.length)) * index;
    const rad = (deg * Math.PI) / 180;
    return { id: item, x: Math.round(cx + Math.cos(rad) * radius), y: Math.round(cy + Math.sin(rad) * radius) };
  });
}

function company(signal: Signal) {
  return Array.isArray(signal.companies) && signal.companies.length ? signal.companies : [signal.entity];
}

function isCompanySignal(signal: Signal) {
  return signal.entityType === "company" || !signal.entityType;
}

function companyList(signals: Signal[]) {
  const names = [...new Set(signals.filter(isCompanySignal).flatMap(company))];
  return [
    ...preferredCompanyOrder.filter((name) => names.includes(name)),
    ...names.filter((name) => !preferredCompanyOrder.includes(name)).sort(),
  ];
}

function countBy<T>(items: T[], fn: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = fn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatEvidence(value: string) {
  return { official: "一手", media: "媒体", analysis: "分析" }[value] || value;
}

function formatConfidence(value: string) {
  return { high: "高可信", medium: "中可信", low: "低可信" }[value] || value;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

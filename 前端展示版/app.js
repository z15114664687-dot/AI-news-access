const state = {
  signals: [],
  mode: "overview",
  topic: "all",
  company: "all",
  view: "signals",
  query: "",
  report: {
    tab: "companies",
    topics: [],
    companies: [],
    startDate: "",
    endDate: "",
    markdown: "",
    filename: "ai-intelligence-report.md",
  },
};

const topicOrder = ["模型", "Agent", "工具", "内容生态", "商业化"];
const topicClass = {
  模型: "model",
  Agent: "agent",
  工具: "tool",
  内容生态: "content",
  商业化: "commerce",
};
const topicColor = {
  模型: "#6d28d9",
  Agent: "#2563eb",
  工具: "#0f766e",
  内容生态: "#b45309",
  商业化: "#be123c",
};
const preferredCompanyOrder = ["OpenAI", "Anthropic", "Google", "Cursor"];

const company = (signal) =>
  Array.isArray(signal.companies) && signal.companies.length ? signal.companies : [signal.entity];
const isCompanySignal = (signal) => signal.entityType === "company" || !signal.entityType;
const companyList = () => {
  const names = [...new Set(state.signals.filter(isCompanySignal).flatMap(company))];
  return [
    ...preferredCompanyOrder.filter((name) => names.includes(name)),
    ...names.filter((name) => !preferredCompanyOrder.includes(name)).sort(),
  ];
};

async function init() {
  state.signals = window.SIGNALS_DATA.signals;
  bindEvents();
  render();
}

function bindEvents() {
  document.getElementById("sidebarToggle").addEventListener("click", () => {
    const shell = document.getElementById("appShell");
    const collapsed = shell.classList.toggle("sidebar-collapsed");
    const button = document.getElementById("sidebarToggle");
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", collapsed ? "展开侧边栏" : "收起侧边栏");
  });

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      state.topic = state.mode === "topic" ? topicOrder[0] : "all";
      state.company = state.mode === "company" ? companyList()[0] : "all";
      resetReport();
      document.querySelectorAll(".mode-button").forEach((item) => {
        item.classList.remove("active");
        item.setAttribute("aria-pressed", "false");
      });
      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");
      render();
    });
  });

  document.getElementById("dimensionNav").addEventListener("click", (event) => {
    const button = event.target.closest(".topic-button");
    if (!button) return;
    if (state.mode === "topic") state.topic = button.dataset.value;
    if (state.mode === "company") state.company = button.dataset.value;
    resetReport();
    render();
  });

  document.querySelectorAll(".view-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      document.querySelectorAll(".view-button").forEach((item) => {
        item.classList.remove("active");
        item.setAttribute("aria-pressed", "false");
      });
      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");
      document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
      document.getElementById(`${state.view}View`).classList.add("active");
      render();
    });
  });

  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });

  document.getElementById("generateReportButton").addEventListener("click", () => {
    generateReport();
  });

  document.querySelectorAll(".report-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.report.tab = button.dataset.reportTab;
      renderReportControls();
    });
  });

  document.getElementById("reportCompanyOptions").addEventListener("click", (event) => handleFilterChip(event, "companies"));
  document.getElementById("reportTopicOptions").addEventListener("click", (event) => handleFilterChip(event, "topics"));

  document.getElementById("reportStartDate").addEventListener("change", (event) => {
    state.report.startDate = event.target.value;
  });

  document.getElementById("reportEndDate").addEventListener("change", (event) => {
    state.report.endDate = event.target.value;
  });

  document.getElementById("clearDateRangeButton").addEventListener("click", () => {
    state.report.startDate = "";
    state.report.endDate = "";
    renderReportControls();
  });

  document.getElementById("downloadReportLink").addEventListener("click", (event) => {
    if (!state.report.markdown) event.preventDefault();
    event.stopPropagation();
  });
}

function filteredSignals() {
  return state.signals.filter((signal) => {
    const topicMatch = state.mode !== "topic" || state.topic === "all" || signal.topics.includes(state.topic);
    const companyMatch =
      state.mode !== "company" ||
      (isCompanySignal(signal) && (state.company === "all" || company(signal).includes(state.company)));
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
    return topicMatch && companyMatch && (!state.query || queryText.includes(state.query));
  });
}

function render() {
  renderDimensionNav();
  const signals = filteredSignals();
  renderPageContext(signals);
  renderReportControls();
  renderMetrics(signals);
  renderSourceMix(signals);
  renderTopicBars(signals);
  renderTimeline(signals);
  renderSignals(signals);
  renderMatrix(signals);
  renderMap(signals);
}

function resetReport() {
  state.report.tab = state.mode === "company" ? "topics" : "companies";
  state.report.topics = [];
  state.report.companies = [];
  state.report.startDate = "";
  state.report.endDate = "";
  clearReport();
}

function clearReport() {
  state.report.markdown = "";
  const preview = document.getElementById("reportPreview");
  preview.classList.remove("has-report");
  preview.open = false;
  document.getElementById("reportMarkdown").textContent = "";
  const link = document.getElementById("downloadReportLink");
  link.removeAttribute("href");
}

function renderDimensionNav() {
  const nav = document.getElementById("dimensionNav");
  if (state.mode === "overview") {
    nav.innerHTML = "";
    nav.setAttribute("aria-label", "总览模式无额外筛选");
    return;
  }

  const items =
    state.mode === "topic"
      ? topicOrder.map((topic) => ({ label: topic, value: topic }))
      : companyList().map((name) => ({ label: name, value: name }));
  const activeValue = state.mode === "topic" ? state.topic : state.company;

  nav.setAttribute("aria-label", state.mode === "topic" ? "话题筛选" : "公司筛选");
  nav.innerHTML = items
    .map((item) => {
      const active = item.value === activeValue;
      return `<button class="topic-button${active ? " active" : ""}" data-value="${item.value}" aria-pressed="${active}">${item.label}</button>`;
    })
    .join("");
}

function renderPageContext(signals) {
  const title =
    state.mode === "overview"
      ? "AI 情报总览"
      : state.mode === "topic"
        ? state.topic === "all"
          ? "按话题查看"
          : `${state.topic} 时间线`
        : state.company === "all"
          ? "按公司查看"
          : `${state.company} 公司页`;
  const focus =
    state.mode === "overview"
      ? "模型能力正在向 Agent 执行层和企业工具层迁移"
      : state.mode === "topic"
        ? "当前视图聚焦同一主题下的跨公司与行业信号"
        : "当前视图聚焦单公司相关的主题覆盖与近期动作";
  const timelineTitle =
    state.mode === "topic"
      ? "话题时间线"
      : state.mode === "company"
        ? "公司时间线"
        : "近期时间线";

  setText("pageTitle", title);
  setText("briefingFocus", focus);
  setText("timelineTitle", timelineTitle);
  setText("timelineHint", `${signals.length} 条 · 按日期倒序`);
  setText("distributionTitle", state.mode === "company" ? "公司主题分布" : "主题分布");
  document.getElementById("visualStrip").classList.toggle("timeline-only", state.mode === "topic");
}

function renderReportControls() {
  const builder = document.getElementById("reportBuilder");
  builder.classList.add("active");

  const isCompanyPage = state.mode === "company";
  const isTopicPage = state.mode === "topic";
  setText(
    "reportScopeLabel",
    state.mode === "overview" ? "Overview report" : isCompanyPage ? "Company report" : "Topic report",
  );
  setText(
    "reportScopeTitle",
    state.mode === "overview" ? "总览总结报告" : isCompanyPage ? `${state.company} 总结报告` : `${state.topic} 总结报告`,
  );

  document.querySelector('[data-report-tab="companies"]').style.display = isCompanyPage ? "none" : "";
  document.querySelector('[data-report-tab="topics"]').style.display = isTopicPage ? "none" : "";
  if (isCompanyPage && state.report.tab === "companies") state.report.tab = "topics";
  if (isTopicPage && state.report.tab === "topics") state.report.tab = "companies";

  document.querySelectorAll(".report-tab").forEach((button) => {
    const active = button.dataset.reportTab === state.report.tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.getElementById("companyFilterPanel").classList.toggle("active", state.report.tab === "companies");
  document.getElementById("topicFilterPanel").classList.toggle("active", state.report.tab === "topics");
  document.getElementById("dateFilterPanel").classList.toggle("active", state.report.tab === "date");

  document.getElementById("reportCompanyOptions").innerHTML = renderFilterChips(
    companyList(),
    state.report.companies,
    "公司",
  );
  document.getElementById("reportTopicOptions").innerHTML = renderFilterChips(topicOrder, state.report.topics, "话题");

  document.getElementById("reportStartDate").value = state.report.startDate;
  document.getElementById("reportEndDate").value = state.report.endDate;
}

function renderFilterChips(options, selected, label) {
  return [
    `<span class="filter-helper">未选择时包含全部${label}</span>`,
    ...options.map((value) => {
      const active = selected.includes(value);
      return `<button class="filter-chip${active ? " active" : ""}" type="button" data-value="${value}" aria-pressed="${active}">${value}</button>`;
    }),
  ].join("");
}

function handleFilterChip(event, key) {
  const button = event.target.closest(".filter-chip");
  if (!button) return;
  toggleInArray(state.report[key], button.dataset.value);
  renderReportControls();
}

function renderMetrics(signals) {
  const entities = new Set(signals.flatMap(company));
  const primary = signals.filter((signal) => signal.evidenceLevel === "official").length;
  const high = signals.filter((signal) => signal.confidence === "high").length;
  setText("metricSignals", signals.length);
  setText("metricEntities", entities.size);
  setText("metricPrimary", primary);
  setText("metricHigh", high);
  setText("resultCount", `${signals.length} 条`);
}

function renderSourceMix(signals) {
  const box = document.getElementById("sourceMix");
  const groups = countBy(signals, (signal) => signal.evidenceLevel);
  const labels = {
    official: "一手来源",
    media: "权威媒体",
    analysis: "分析转载",
  };
  const max = Math.max(1, ...Object.values(groups));
  box.innerHTML = Object.entries(labels)
    .map(([key, label]) => {
      const value = groups[key] || 0;
      const width = Math.max(4, Math.round((value / max) * 100));
      return `
        <div class="source-row">
          <span><b>${label}</b><b>${value}</b></span>
          <div class="source-track"><div class="source-fill" style="width:${width}%"></div></div>
        </div>
      `;
    })
    .join("");
}

function renderTopicBars(signals) {
  const counts = {};
  signals.forEach((signal) => {
    signal.topics.forEach((topic) => {
      counts[topic] = (counts[topic] || 0) + 1;
    });
  });
  const max = Math.max(1, ...Object.values(counts));
  document.getElementById("topicBars").innerHTML = topicOrder
    .map((topic) => {
      const value = counts[topic] || 0;
      const width = Math.max(3, Math.round((value / max) * 100));
      return `
        <div class="bar-row">
          <span>${topic}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width:${width}%;background:${topicColor[topic]}"></div>
          </div>
          <strong>${value}</strong>
        </div>
      `;
    })
    .join("");
  setText("topicCountLabel", `${topicOrder.length} 个主题`);
}

function renderTimeline(signals) {
  const items = [...signals]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((signal) => {
      return `
        <div class="timeline-item">
          <div class="timeline-date">${signal.date}</div>
          <p class="timeline-text"><b>${company(signal).join(" / ")}</b> · ${signal.title}</p>
        </div>
      `;
    })
    .join("");
  document.getElementById("timeline").innerHTML = items || emptyState("没有匹配信号");
}

function renderSignals(signals) {
  document.getElementById("signalGrid").innerHTML =
    signals
      .map((signal) => {
        const mainTopic = signal.topics[0];
        const secondaryTopics = signal.topics.slice(1).map((topic) => `<span class="evidence-pill">${topic}</span>`).join("");
        const crossTopic = signal.topicMode === "cross_topic" ? `<span class="evidence-pill">跨话题</span>` : "";
        return `
          <article class="signal-card">
            <div class="signal-top">
              <span class="tag ${topicClass[mainTopic]}">${mainTopic}</span>
              <span>${signal.date}</span>
            </div>
            <h4>${signal.title}</h4>
            <p>${signal.summary}</p>
            <div class="evidence-line">
              <span class="evidence-pill">${formatEvidence(signal.evidenceLevel)}</span>
              <span class="evidence-pill">${formatConfidence(signal.confidence)}</span>
              ${secondaryTopics}
              ${crossTopic}
            </div>
            <div class="signal-meta">
              <span><b>${company(signal).join(" / ")}</b> · ${signal.product}</span>
              ${signal.entityType === "company" ? "" : `<span>信号对象：${signal.entity}</span>`}
              <span>${signal.source} · ${signal.domain}</span>
              <a href="${signal.url}" target="_blank" rel="noreferrer">打开来源</a>
            </div>
          </article>
        `;
      })
      .join("") || emptyState("没有匹配信号");
}

function renderMatrix(signals) {
  const matrixSignals = signals.filter(isCompanySignal);
  const entities = [...new Set(matrixSignals.flatMap(company))].sort();
  const rows = entities
    .map((entity) => {
      const cells = topicOrder
        .map((topic) => {
          const hits = matrixSignals.filter((signal) => company(signal).includes(entity) && signal.topics.includes(topic));
          const chips = hits.map((hit) => `<span class="cell-chip">${hit.product}</span>`).join("");
          return `<td>${hits.length ? `<span class="matrix-count">${hits.length}</span>${chips}` : " "}</td>`;
        })
        .join("");
      return `<tr><td>${entity}</td>${cells}</tr>`;
    })
    .join("");
  document.getElementById("matrixTable").innerHTML = `
    <caption>仅展示明确归属于单一公司的信号；行业通用、市场协议和采用案例保留在时间线与信号卡片中。</caption>
    <thead>
      <tr><th>实体</th>${topicOrder.map((topic) => `<th>${topic}</th>`).join("")}</tr>
    </thead>
    <tbody>${rows}</tbody>
  `;
}

function renderMap(signals) {
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

  const edges = [];
  mapSignals.forEach((signal) => {
    company(signal).forEach((entity) => {
      signal.topics.forEach((topic) => edges.push([entity, topic]));
      edges.push([entity, signal.domain]);
    });
  });

  const svgEdges = edges
    .map(([from, to]) => {
      const a = nodeMap.get(from);
      const b = nodeMap.get(to);
      if (!a || !b) return "";
      return `<line class="edge" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
    })
    .join("");

  const svgNodes = [
    ...topicNodes.map((node) => nodeSvg(node, topicColor[node.id], 19)),
    ...entityNodes.map((node) => nodeSvg(node, "#172033", 16)),
    ...sourceNodes.map((node) => nodeSvg(node, "#64748b", 9)),
  ].join("");

  document.getElementById("ecosystemMap").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="AI 生态地图">
      ${svgEdges}
      <circle cx="${center.x}" cy="${center.y}" r="42" fill="#ffffff" stroke="#cbd5e1" />
      <text class="node-label" x="${center.x}" y="${center.y - 4}" text-anchor="middle">AI</text>
      <text class="node-label" x="${center.x}" y="${center.y + 13}" text-anchor="middle">Ecosystem</text>
      ${svgNodes}
    </svg>
  `;
}

function radialNodes(items, cx, cy, radius, startDeg) {
  return items.map((item, index) => {
    const deg = startDeg + (360 / Math.max(1, items.length)) * index;
    const rad = (deg * Math.PI) / 180;
    return {
      id: item,
      x: Math.round(cx + Math.cos(rad) * radius),
      y: Math.round(cy + Math.sin(rad) * radius),
    };
  });
}

function nodeSvg(node, color, radius) {
  const textX = node.x;
  const textY = node.y + radius + 16;
  return `
    <g>
      <circle cx="${node.x}" cy="${node.y}" r="${radius}" fill="${color}" />
      <text class="node-label" x="${textX}" y="${textY}" text-anchor="middle">${escapeXml(node.id)}</text>
    </g>
  `;
}

function generateReport() {
  const signals = reportSignals();
  const markdown = buildReportMarkdown(signals);
  const title = reportTitle();
  state.report.markdown = markdown;
  state.report.filename = `${slugify(title)}.md`;

  const preview = document.getElementById("reportPreview");
  preview.classList.add("has-report");
  preview.open = false;
  document.getElementById("reportMarkdown").textContent = markdown;

  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.getElementById("downloadReportLink");
  if (link.dataset.url) URL.revokeObjectURL(link.dataset.url);
  link.href = url;
  link.dataset.url = url;
  link.download = state.report.filename;
}

function reportSignals() {
  let signals = filteredSignals();
  if (state.report.topics.length) {
    signals = signals.filter((signal) => state.report.topics.some((topic) => signal.topics.includes(topic)));
  }
  if (state.report.companies.length) {
    signals = signals.filter((signal) => state.report.companies.some((name) => company(signal).includes(name)));
  }
  if (state.report.startDate) {
    signals = signals.filter((signal) => signal.date >= state.report.startDate);
  }
  if (state.report.endDate) {
    signals = signals.filter((signal) => signal.date <= state.report.endDate);
  }
  return [...signals].sort((a, b) => b.date.localeCompare(a.date));
}

function buildReportMarkdown(signals) {
  const title = reportTitle();
  const period = reportPeriod();
  const companies = [...new Set(signals.flatMap(company))].sort();
  const topics = [...new Set(signals.flatMap((signal) => signal.topics))].sort();
  const official = signals.filter((signal) => signal.evidenceLevel === "official").length;
  const high = signals.filter((signal) => signal.confidence === "high").length;
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });

  const lines = [
    `# ${title}`,
    "",
    `生成时间：${generatedAt}`,
    `时间范围：${period}`,
    `信号数量：${signals.length}`,
    `相关公司：${companies.length ? companies.join("、") : "无"}`,
    `覆盖话题：${topics.length ? topics.join("、") : "无"}`,
    `证据质量：一手来源 ${official} 条，高可信 ${high} 条`,
    "",
    "## 摘要",
    signals.length
      ? `当前样本显示，${companies.slice(0, 4).join("、") || "相关主体"} 的主要信号集中在 ${topics.slice(0, 4).join("、") || "当前维度"}。这些结论仅基于当前本地样本数据。`
      : "当前筛选条件下没有可用于生成报告的信号。",
    "",
    "## 关键观察",
    ...signals.slice(0, 5).map((signal) => `- ${signal.date} · ${company(signal).join(" / ")}：${signal.title}`),
    "",
    "## 证据清单",
    "| 日期 | 公司/对象 | 话题 | 来源 | 标题 |",
    "|---|---|---|---|---|",
    ...signals.map(
      (signal) =>
        `| ${signal.date} | ${company(signal).join(" / ")}${signal.entityType === "company" ? "" : `（${signal.entity}）`} | ${signal.topics.join("、")} | ${signal.source} | [${escapeMarkdown(signal.title)}](${signal.url}) |`,
    ),
    "",
    "## 备注",
    "- 本报告由本地样本数据生成，不包含新的网页抓取。",
    "- 付费墙或媒体来源仅保留摘要、标题、URL 和来源层级。",
  ];
  return lines.join("\n");
}

function reportTitle() {
  if (state.mode === "company" && state.company !== "all") return `${state.company} AI 情报总结报告`;
  if (state.mode === "topic" && state.topic !== "all") return `${state.topic} 话题情报总结报告`;
  return "AI 生态情报总览报告";
}

function reportPeriod() {
  if (!state.report.startDate && !state.report.endDate) return "全部样本时间";
  return `${state.report.startDate || "最早"} 至 ${state.report.endDate || "最新"}`;
}

function toggleInArray(items, value) {
  const index = items.indexOf(value);
  if (index >= 0) items.splice(index, 1);
  else items.push(value);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function countBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatEvidence(value) {
  return { official: "一手", media: "媒体", analysis: "分析" }[value] || value;
}

function formatConfidence(value) {
  return { high: "高可信", medium: "中可信", low: "低可信" }[value] || value;
}

function emptyState(text) {
  return `<p class="empty-state">${text}</p>`;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

init().catch((error) => {
  document.body.innerHTML = `<pre>${error.message}</pre>`;
});

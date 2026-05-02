# AI Ecosystem Intelligence

本地运行的 AI 情报系统，用于跟踪“模型、Agent、工具、内容生态、商业化”的公司和行业信号。当前版本包含 Next.js 前端、本地 SQLite 数据库、Gemini Google Search grounding 采集、自动分类摘要、报告生成和本地 Markdown 下载。

## 本地启动

要求：Node.js 22 或更新版本。

### 一键打开

macOS 下可以双击项目根目录里的 `Open Local App.command`。它会自动准备本地 SQLite 数据库、启动本地服务，并打开：

```text
http://127.0.0.1:3000
```

如果 macOS 提示没有执行权限，先运行一次：

```bash
chmod +x "Open Local App.command"
```

### 命令启动

```bash
npm install
npm run local:setup
npm run dev
```

也可以用一条命令启动并打开浏览器：

```bash
npm run local:open
```

打开 `http://localhost:3000`。本地版没有登录页，默认只绑定本机开发服务；不要直接暴露到公网。

## 数据文件

默认数据库文件：

```text
data/ai-intel.db
```

这个文件已经加入 `.gitignore`，不会提交到 GitHub。样本数据仍保留在 `data/signals.json`，来源配置保留在 `data/collector-config.json`。

常用命令：

```bash
npm run db:migrate
npm run db:seed
npm run local:setup
```

`local:setup` 会创建 SQLite 数据库并导入样本信号。

## 采集配置

页面右上角的“采集”视图可以手动触发采集。当前版本只需要 Gemini API：

```bash
cp .env.example .env
```

然后在 `.env` 里填入：

```bash
GEMINI_API_KEY=你的_Gemini_API_Key
GEMINI_MODEL=gemini-2.5-flash
COLLECT_DAYS=30
COLLECT_QUERY_LIMIT=12
```

Gemini API Key 可以在 Google AI Studio 创建：`https://ai.google.dev/gemini-api/docs/api-key`。采集层会调用 Gemini API 的 Google Search grounding：`https://ai.google.dev/gemini-api/docs/grounding/`，让 Gemini 搜索实时网页并输出结构化 JSON，再写入本地 SQLite。

`COLLECT_DAYS` 是默认采集时间范围，页面「采集」视图里也可以临时选择最近 7、14、30、90 或 180 天。时间范围越短，越能减少无效搜索和 API 消耗。

没有 `GEMINI_API_KEY` 时，采集按钮仍会创建一条运行记录，但不会写入新信号。第一版不会常驻后台任务，不会自动定时采集。

## GitHub 提交建议

推荐提交源码、配置和样本数据，不提交本地数据库、依赖和构建产物：

```bash
git status
git add .
git commit -m "Build local AI intelligence dashboard"
```

`.gitignore` 已排除 `node_modules/`、`.next/`、`.env`、本地 SQLite 数据库和 macOS 临时文件。

## 数据模型

核心表：

- `signals`：情报信号、公司、话题、来源、可信度、确认状态。
- `sources`：来源配置，对应 `data/collector-config.json`。
- `collection_runs`：每次采集任务的状态、数量和日志。
- `reports`：生成过的 Markdown 报告。

## 话题口径

目标是 MECE：默认一条新闻只归入一个主话题；只有多个话题被平等覆盖时，才标记为跨话题。

### 模型

关注 AI 模型本身的发布、能力、架构、性能和行业趋势。

纳入：
- 新模型发布或升级：GPT、Claude、Gemini、DeepSeek、Qwen、Llama、Grok、Sora、Veo、Imagen、Gamma 等。
- 模型能力变化：推理、长上下文、多模态、代码、数学、视频、语音、实时交互。
- 模型评测和对比：benchmark、排行榜、成本/性能比、开源/闭源对比。
- 模型基础设施趋势：训练规模、推理成本、算力瓶颈、模型压缩、端侧模型。
- 宏观判断：模型能力边界、Scaling Law、推理模型发展、开源模型追赶。

排除：
- 某个产品增加 AI 功能，优先归入工具。
- Agent 产品发布或能力增强，优先归入 Agent。
- 价格、广告、采购、收入，优先归入商业化。

### Agent

关注能自主规划、调用工具、跨步骤执行任务的 AI Agent。

纳入：
- 新 Agent 发布：Codex、Claude Code、Claude Design、Devin、Manus、Operator、computer use 类产品。
- Agent 能力更新：浏览器操作、代码执行、文件处理、工具调用、长任务、自主规划、多 Agent 协作。
- Agent 的新应用方向：编程、设计、研究、办公、客服、销售、运维、数据分析。
- Agent 基础能力研究：自主性、可靠性、权限边界、记忆、任务分解、human-in-the-loop。
- Agent 平台化：Agent SDK、Agent marketplace、企业 Agent 管理平台。

排除：
- 单纯模型升级，优先归入模型。
- 普通 App 内的局部 AI 功能，优先归入工具。
- Agent 的收费、采购、商业合同，优先归入商业化。

### 工具

关注面向用户或企业的 AI 应用功能、工作流工具和实际采用。

纳入：
- ToC AI 应用新功能：AI 搜索、AI 购物、AI 办公、AI 浏览器、AI 邮件、AI 日历、AI 设计、AI 编辑器。
- ToB AI 工具新功能：CRM、客服、BI、办公套件、开发工具、数据工具、营销工具中的 AI 功能。
- 企业侧 AI 工具采用：微软、亚马逊、迪士尼等大厂内部使用哪些 AI 工具，迁移或减少使用哪些工具。
- 工作流集成：从其他 AI 应用导入历史、连接企业系统、插件、MCP、API 集成。
- 产品层面的效率工具：Cursor、Notion AI、Perplexity、Glean、Canva、Figma、Adobe、Microsoft 365 Copilot 等。

排除：
- 如果核心是“自主完成任务的 Agent”，优先归入 Agent。
- 如果核心是底层模型能力，优先归入模型。
- 如果核心是广告、收入、定价、采购金额，优先归入商业化。

### 内容生态

关注内容平台、社区、图文、视频、直播、创作者生态中的 AI 应用和内容分发变化。

纳入：
- 社区/视频/图文产品的 AI 应用：TikTok、YouTube、Instagram、Reddit、小红书、微博、Bilibili、快手、抖音、公众号等。
- AI 内容生产：AI 短视频、AI 直播、AI 图文、AI 配音、AI 剪辑、AI 虚拟创作者。
- AI 内容分发：AI 推荐、AI 搜索、AI 摘要、AI 评论区、AI 话题聚合。
- 创作者工具和生态规则：AI 生成内容标识、版权、审核、分成、平台激励。
- AI 产品内容化：当重点是内容消费、社区互动、创作者供给，而不是广告收入本身。

排除：
- 纯广告/收入/商业模式，优先归入商业化。
- 普通工具型 AI 功能，优先归入工具。
- 模型生成能力发布，优先归入模型。

### 商业化

关注 AI 产品如何赚钱、如何定价、如何被采购和规模化部署。

纳入：
- 广告和收入：AI 搜索广告、Gemini/ChatGPT 广告、赞助答案、商业推荐、广告库存迁移。
- 定价和套餐：订阅价格、API 价格、企业版、用量计费、token 成本。
- 销售和采购：大企业合同、政府合同、防务部署、云厂商合作、渠道合作。
- 商业模式变化：从免费到收费、从订阅到广告、从 API 到平台抽成。
- 资本和经营信号：ARR、收入、融资、估值、毛利、算力成本、客户数。
- 市场格局：OpenAI、Anthropic、Google、Microsoft、Amazon、Meta、xAI 等在商业化路径上的差异。

排除：
- 仅仅是产品功能发布，优先归入工具或 Agent。
- 仅仅是模型能力发布，优先归入模型。
- 仅仅是内容产品里的 AI 体验，优先归入内容生态。

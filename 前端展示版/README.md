# AI Ecosystem Intelligence

第一版本地前端，用少量权威来源样本展示“模型、Agent、工具、内容生态、商业化”的信息集成和对标方式。

## 使用

直接打开 `index.html` 即可。页面不依赖 npm、后端或外部 CDN。

## 数据

样本数据在 `data/signals.json`，每条记录保留：

- 实体和产品
- 主题标签
- 摘要
- 来源 URL
- 来源层级
- 可信度

## 采集策略

第一版采用轻量策略：优先搜索权威媒体和官方来源的标题、摘要、日期和 URL；只保留必要的短摘要，不批量读取全文。

后续可以把 `web-access` 接入为采集层，按实体和主题生成 Google `site:` 查询，再把结果写入同一份 JSON 或 SQLite。

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

搜索方向：
- `{company} new model`
- `{company} reasoning model benchmark`
- `{model name} release capability`
- `AI model performance cost trend`

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

搜索方向：
- `{company} agent launch`
- `{product} agent new feature`
- `AI agent autonomy`
- `AI coding agent`
- `computer use agent`

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

搜索方向：
- `{company} AI tool feature`
- `{product} AI search shopping workflow`
- `{company} employees using AI tools`
- `{enterprise} adopts Claude Cursor OpenAI`
- `{product} AI integration`

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

搜索方向：
- `{platform} AI video creator`
- `{platform} AI recommendation search`
- `{platform} AI generated content policy`
- `{platform} AI live streaming`
- `AI content ecosystem creator monetization`

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

搜索方向：
- `{company} AI ads revenue`
- `{product} pricing enterprise`
- `{company} AI contract deployment`
- `{company} ARR AI`
- `{company} API pricing token cost`

## 归类优先级

当一条新闻同时涉及多个方向时，按新闻主语和核心变化判断：

1. 新模型或模型能力本身是主角 → 模型。
2. 自主执行任务、调用工具、跨步骤完成目标是主角 → Agent。
3. 具体 AI 应用功能或企业工具采用是主角 → 工具。
4. 内容平台、创作者、视频/图文/直播生态是主角 → 内容生态。
5. 广告、收入、定价、采购、合同、部署、融资是主角 → 商业化。

如果新闻篇幅平等覆盖两个或多个主角，并且拆成单一话题会损失事实，标记为 `topicMode: "cross_topic"`，同时保留多个 `topics`。

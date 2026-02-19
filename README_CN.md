# Lumen — 论证骨架分析器

[English](./README.md) | **中文**

Lumen 从任意文章中提取论证骨架：核心主张、推理链条、逻辑缺口、阅读建议。它不是摘要工具——它让你看清作者**怎么论证**，而不只是**说了什么**。

**[在线体验](https://lumen-reader.uk)** · **[安装 Chrome 扩展](#安装-chrome-扩展)**

## 它做什么

粘贴一篇文章（或在任意网页上点击扩展图标），Lumen 返回：

- **核心主张** — 文章的中心论点（不是主题概述，是可辩论的断言）
- **论证阶段** — 推理被拆分为逻辑阶段，每个阶段包含若干节点，展示逐步推理路径
- **连接器** — 节点间的显式逻辑关系：因果、并列、反驳、分叉、合并、自我追问
- **逻辑缺口** — 作者在哪里跳过了步骤、忽略了替代方案、用类比替代了论证
- **判决** — 最扎实的环节、最薄弱的环节、哪些值得精读、哪些可以略读

## 为什么做这个

大多数 AI "摘要工具"把文章压缩成更短的文字。Lumen 做的事情不同：它映射**推理结构**。输出不是摘要，而是一副骨架——展示作者如何从前提走到结论，哪里的逻辑站得住，哪里站不住。

这个项目有意思的部分不是产品外壳（任何开发者都能做一个 Chrome 扩展），而是 **prompt 工程**——那套让 AI 产出真正有用的论证分析（而非泛泛摘要）的原则体系。

## Prompt 设计原则

Prompt 位于 `functions/api/analyze.js`，编码了 14 条分析原则。以下是关键思路：

### 删除测试（上位原则）

每个候选节点必须通过这个测试：*"如果我从骨架中删除这个节点，读者的理解会断裂吗？"*

- 推理链断裂 → 必须保留（level 1）
- 推理链存活但明显削弱 → 应该保留（level 2）
- 读者几乎察觉不到 → 不是节点

反向测试同样重要：如果原文花了 800+ 字论证一个观点，但你的骨架只有一个含糊的节点，读者会问"凭什么让我相信这个？"——你过度压缩了。

### 结构识别，而非强制线性化

文章很少沿着 A→B→C 的直线论证。Prompt 识别六种论证结构：

| 结构 | 模式 | 例子 |
|------|------|------|
| 链式 | A→B→C→结论 | 经典演绎推理 |
| 分叉 | A 分出 B₁、B₂，再汇合 | "如果 AI 成功→X；失败→Y；无论哪种→Z" |
| 历史映射 | 过去模式 → 现在投射 | 用殖民历史解释现代地缘政治 |
| 稻草人拆解 | 摆出流行观点 → 逐一拆解 | "人们以为X，但实际上……" |
| 归纳收敛 | 多个现象 → 共同规律 | 若干案例归纳出一条原则 |
| 让步-限制 | 推进主张 → 承认边界 | "这在……情况下成立，但在……时不适用" |

骨架的节点排列和连接器类型必须反映文章的**实际结构**，而不是把所有东西拍平成列表。

### 论证密度 ≠ 篇幅

1000 字的紧密推理和 1000 字的举例说明需要截然不同数量的节点。Prompt 根据**论证密度**而非字数来校准节点数量。

### 禁用判决词汇

Prompt 明确禁止 19 个恭维性形容词（精彩、深刻、犀利、鞭辟入里、"must-read"等）出现在判决中。AI 只能评价**推理质量**（逻辑是否严密？证据是否充分？），不能评价**观点本身的价值**。

## 技术架构

```
用户 → Chrome 扩展侧边栏 / 网页应用 (public/index.html)
         ↓
    Cloudflare Pages Functions (functions/api/analyze.js)
         ↓
    代理网关 → Gemini 3 Pro Preview
         ↓
    JSON 响应 → 前端渲染
```

| 组件 | 技术栈 |
|------|--------|
| API | Cloudflare Pages Functions，KV 限流 |
| 网页应用 | React + Babel（浏览器内编译，单文件，无构建步骤） |
| 扩展 | 原生 JS，Chrome Manifest V3，Side Panel API |
| AI | Gemini 3 Pro Preview（通过代理网关） |

## 安装与部署

### 前置条件

- Node.js 18+
- Cloudflare 账号
- Gemini API Key（或兼容的代理）
- Wrangler CLI：`npm install -g wrangler`

### 1. 克隆并配置

```bash
git clone https://github.com/KaguraNanaga/lumen-reader.git
cd lumen-reader
```

创建 `.dev.vars` 文件用于本地开发：

```
GEMINI_API_KEY=your_api_key_here
```

### 2. 配置限流（Cloudflare KV）

```bash
# 创建 KV 命名空间
npx wrangler kv namespace create RATE_LIMIT

# 将返回的 ID 添加到 wrangler.toml
```

`wrangler.toml` 应该长这样：

```toml
name = "lumen"
pages_build_output_dir = "public"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "your-kv-namespace-id"
```

### 3. 部署网页应用

```bash
npx wrangler pages deploy public
```

在 Cloudflare 控制台 → Pages → Settings → Environment variables 中设置 `GEMINI_API_KEY`。

### 安装 Chrome 扩展

扩展尚未上架 Chrome Web Store，目前以开发者模式加载：

1. 打开 `chrome://extensions/`
2. 开启右上角"开发者模式"
3. 点击"加载已解压的扩展程序" → 选择 `lumen-extension/` 文件夹
4. 打开任意文章页面，点击 Lumen 图标

> **注意：** 扩展调用的 API 地址在 `sidepanel.js` 的 `API_BASE` 中。如果你自己部署，需要改成你的部署 URL。

## 项目结构

```
├── functions/
│   └── api/
│       └── analyze.js          # API：prompt、限流、输入校验
├── lumen-extension/
│   ├── _locales/               # 国际化（en + zh_CN）
│   ├── icons/
│   ├── background.js           # 扩展生命周期管理
│   ├── content.js              # 文章正文提取（Readability.js）
│   ├── sidepanel.js            # 扩展 UI 渲染
│   ├── sidepanel.css
│   ├── sidepanel.html
│   ├── Readability.js          # Mozilla Readability
│   └── manifest.json
├── public/
│   ├── index.html              # 网页应用（React，单文件）
│   ├── privacy.html            # 隐私政策
│   ├── terms.html              # 使用条款
│   └── icons/
├── wrangler.toml
└── README_CN.md                # 本文件
```

## JSON Schema（V3）

AI 输出结构化 JSON，包含阶段（phases）、节点（nodes）、连接器（connectors）和缺口（gaps）。完整 schema 见 `analyze.js`。

关键设计决策：

- `spine[]` → `phases[].nodes[]` — 长文章需要可折叠的阶段分组
- `verdict` 从字符串改为 `{ strongest, weakest, reading_advice }` 对象 — 信息密度更高
- 每个 phase 有独立的 `connectors[]` — 显式逻辑关系，而非简单的顺序排列
- 节点 ID 使用 `"阶段-序号"` 格式（如 `"2-3"`），方便交叉引用

## 自定义 Prompt

这个项目最有价值的部分是 `analyze.js` 中的 prompt。如果你想改造它：

- **调整节点密度**：修改基于 `charCount` 的 `nodeMin`/`nodeMax` 阈值
- **增加分析原则**：在编号列表中添加；删除测试应始终保持为上位原则
- **固定输出语言**：默认会自动检测输入语言；修改语言规则部分可以固定输出语言
- **更换 AI 模型**：更新 fetch 调用中的 `model` 字段；prompt 是模型无关的，但在 Gemini 3 Pro 上测试

## 限流规则

- 每 IP 每天 5 次分析
- 每 IP 每分钟 3 次分析
- 存储在 Cloudflare KV 中，通过 TTL 自动过期

## 双语支持

网页应用和扩展均支持中英文切换。网页端提供手动语言切换按钮（CN/EN），AI 自动以输入文章的语言输出分析结果。

## 开源协议

MIT

## 致谢

- [Mozilla Readability](https://github.com/mozilla/readability) — 文章正文提取
- [Google Gemini](https://deepmind.google/technologies/gemini/) — AI 分析引擎
- [Cloudflare Pages](https://pages.cloudflare.com/) — 部署与边缘计算

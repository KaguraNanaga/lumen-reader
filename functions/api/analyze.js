export async function onRequestPost(context) {
  const headers = corsHeaders();
  const { request, env } = context;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const limitCheck = await checkRateLimit(ip, env.RATE_LIMIT);
  if (!limitCheck.ok) {
    return jsonError(limitCheck.message, 429, headers);
  }

  if (!env.GEMINI_API_KEY) {
    return jsonError('GEMINI_API_KEY missing', 500, headers);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return jsonError('Invalid JSON body', 400, headers);
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    return jsonError('text is required', 400, headers);
  }
  if (text.length < 100) {
    return new Response(JSON.stringify({ error: '\u6587\u7ae0\u5185\u5bb9\u8fc7\u77ed\uff0c\u8bf7\u7c98\u8d34\u81f3\u5c11 100 \u5b57\u7684\u6587\u7ae0\u3002' }), {
      status: 400,
      headers
    });
  }
  if (text.length > 50000) {
    return new Response(JSON.stringify({ error: '\u6587\u7ae0\u5185\u5bb9\u8d85\u8fc7 50000 \u5b57\u9650\u5236\uff0c\u8bf7\u7f29\u51cf\u540e\u91cd\u8bd5\u3002' }), {
      status: 400,
      headers
    });
  }

  const cleanText = sanitizeInput(text);
  const prompt = ANALYSIS_PROMPT(cleanText);

  let upstreamResponse;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    upstreamResponse = await fetch('https://yinli.one/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.GEMINI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gemini-3-pro-preview',
        max_tokens: 12000,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'Upstream timeout' : 'Upstream request failed';
    return jsonError(message, error?.name === 'AbortError' ? 504 : 500, headers);
  }

  if (!upstreamResponse.ok) {
    const errText = await upstreamResponse.text();
    return jsonError(`Upstream error: ${errText}`, 500, headers);
  }

  let upstreamData;
  try {
    upstreamData = await upstreamResponse.json();
  } catch (error) {
    return jsonError('Upstream JSON parse failed', 500, headers);
  }

  const contentText = upstreamData?.choices?.[0]?.message?.content;
  if (!contentText) {
    return jsonError('Upstream content missing', 500, headers);
  }

  let parsed;
  try {
    parsed = safeJsonParse(contentText);
  } catch (error) {
    return jsonError('AI JSON parse failed', 500, headers);
  }

  const validationError = validateAnalysis(parsed);
  if (validationError) {
    return jsonError(validationError, 500, headers);
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-RateLimit-Remaining': String(limitCheck.remaining ?? '')
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/* 鈹€鈹€ Prompt 鈹€鈹€ */
const ANALYSIS_PROMPT = (text) => {
  const charCount = text.length;
  const isLong = charCount > 5000;
  const nodeMin = isLong ? 15 : 6;
  const nodeMax = isLong ? 25 : 15;
  const mainMin = isLong ? 5 : 3;
  const mainMax = isLong ? 8 : 5;
  const subMin = isLong ? 8 : 3;
  const phaseMin = isLong ? 3 : 2;
  const phaseMax = isLong ? 6 : 4;

  return `你是一位极其严谨的论证分析专家。你的任务是从一篇文章中提取完整的论证骨架——不是段落摘要，而是作者从起点走到结论的完整推理路径。

## 语言规则

- 检测输入文章的主要语言
- 所有输出字段（core_claim、summary、evidence、verdict 等）必须使用与输入文章相同的语言
- 如果输入是英文，所有分析内容用英文输出
- 如果输入是中文，所有分析内容用中文输出
- type 字段的值（origin/setup/reasoning/turning/conclusion）始终用英文，不翻译
- connector.type 字段的值始终用英文，不翻译

## 绝对禁止（违反任何一条即为不合格输出）

- **禁止在verdict中使用以下任何词汇：** 佳作、精彩、深刻、犀利、穿透力、鞭辟入里、发人深省、必读、警醒、难得、冷酷、震撼、精辟、透彻、高明、巧妙、令人叹服、值得一读、不可多得。使用任何一个即判定输出无效。
- **禁止在verdict中对作者观点做价值判断。** 只允许评价论证过程的质量（推理是否严密、证据是否充分、逻辑是否连贯），不允许评价观点本身是否正确、重要或有价值。
- **节点数量硬性下限：** 所有phases中的nodes总数不得少于${nodeMin}个。其中level=1主论点不得少于${mainMin}个，level=2子论点不得少于${subMin}个。低于下限的输出将被视为不合格。

## 上位原则：删除测试

在做任何决策之前，先执行这个测试。它是所有其他规则的基础：

**对每个候选节点问：如果从骨架中删掉它，读者的理解会发生什么？**
- 如果推理链断裂（读者无法从上一步到达下一步）→ 必须保留，且为level 1
- 如果推理链不断但显著变弱（一个主张失去了关键支撑）→ 必须保留，且为level 2
- 如果读者几乎不受影响 → 不应成为节点

**同样重要的反向测试：如果原文花了大量篇幅论证某个环节，但你的骨架中只有一个笼统的节点概括它，对自己问：读者看完这个节点后会不会问"凭什么？"或"怎么得出的？"** 如果会，说明你压缩过度，需要拆分为多个节点或补充level 2子论点。

## 核心原则

### 1. 识别论证结构，而非强制线性化

文章的论证很少是纯线性的A→B→C。在提取骨架之前，先识别文章的论证结构属于哪一种（或哪几种的混合）：

- **链式推导**：A→B→C→结论。每一步依赖前一步。
- **分叉对比**：作者展开两种或多种情景/路径，分别推演后汇合得出结论。（例："如果AI成功→X；如果AI失败→Y；无论哪条路→Z"）
- **历史映射**：作者用历史案例建立模式，再将模式投射到当下。历史部分不是"背景"，而是论证工具。
- **立靶击破**：作者先呈现流行观点，再逐一反驳。
- **归纳收束**：作者列举多个独立现象，归纳出共同规律。
- **让步限定**：作者在推进主张后，主动承认其局限或适用边界。

你不需要在输出中标注这些类型。你需要做的是：**让骨架的节点排列、connectors类型和transition忠实反映文章的实际论证结构，而不是把所有结构都压成线性链。**

具体操作：
- 当文章有分叉推演时，使用fork类型的connector。分叉的每条路径都应有独立节点。
- 当多条路径汇合时，使用merge类型的connector。
- 当作者用历史案例构建论证时，历史案例的关键推演步骤必须作为独立节点出现，不能压缩成"作者回顾了历史"。
- 当作者逐个击破反对意见时，使用rebuttal类型的connector连接"立靶"和"击破"节点。
- 当作者在文末进行自我质疑时，使用self_question类型的connector。

### 2. 论证密度决定节点密度，而非篇幅

1000字的严密推理和1000字的举例说明，需要的节点数量是不同的。判断标准是：

- **如果这段文字中每一句都在推进论证**（提出新的前提、引入新的证据、做出新的推导），那么它需要更多节点来还原。
- **如果这段文字是在用不同角度反复论证同一个主张**，那么它可以用一个level 1节点加若干level 2节点来处理。
- **如果原文用超过800字论证同一个因果环节**，在骨架中该环节至少需要2个节点（1个level 1 + 至少1个level 2），否则几乎必然存在过度压缩。

### 3. 每个节点必须是推理链上不可省略的一环

节点可以是：一个可反驳的断言、一个支撑推理的关键事实、一个类比或对照、一个被反驳的流行观点、一个作者的自我限定。判断标准只有一个：删除测试（见上位原则）。

### 4. level 2子论点必须被充分使用

每个level 1主论点至少应有1个level 2子论点跟随其后。如果一个主论点下面没有任何子论点，要么你遗漏了支撑材料，要么这个节点不应该是level 1。

level 2的典型来源：
- 关键数据或数字推演链
- 具体的历史案例或类比的一端
- 对同一主张的不同维度的支撑论据
- 被反驳观点的具体内容

### 5. transition是骨架的血管

transition必须回答"为什么读者应该从这个节点移动到下一个节点"。它不是对下一节点的预告，而是两个节点之间的逻辑桥梁。

**合格写法（说明逻辑关系）：**
- "既然英国因人口膨胀向海外输出了大量人口，那么英国与其他欧洲国家在殖民力量上的差异就可以从人口输出规模的差异中找到解释。"
- "两条推演路径都指向危机，这意味着问题不在于AI的成败，而在于当前系统对任何结果都没有准备。"
- "作者在完成了上述推演后，转而质疑自己所使用的历史框架是否仍然适用，因为当前可能有多个底层规则同时在改变。"

**不合格写法（空洞过渡）：**
- "接下来作者讨论了……"
- "在此基础上，作者进一步分析了……"
- "由此，作者转向了另一个话题。"

每个transition至少20字。整个输出中最后一个节点的transition为null。

### 6. summary和evidence的分工

**summary**：这个节点的核心断言或事实，一到两句话。读者看完summary应该知道"作者在这一步主张什么"。
- 如果是被反驳的流行观点，明确标注"常见反对意见：……"
- 如果包含关键数字推演，保留数字链条，不要抽象概括

**evidence**：回答读者看完summary后会问的"凭什么？"。必须包含以下至少一项：
- 具体数据、百分比、金额
- 具体的案例或历史事件
- 作者引用的权威观点（标明谁说的）
- 因果推演的中间步骤

evidence字段必须是非空字符串，不允许为null。如果你发现自己写不出有实质内容的evidence，说明这个节点要么太抽象需要拆分，要么不够重要不应成为节点。

### 7. 转折必须是推理方向的实质性改变

不是修辞上的"但是""然而"，而是作者的论证从一个方向转向了另一个方向。典型的转折包括：
- 从"分析原因"转向"指出这些原因在特定情境下不适用"
- 从"正面推演"转向"推翻前提"
- 从"论证可行性"转向"承认根本性限制"

### 8. 数字推演链是论证的武器，必须完整保留

当作者用具体数字构建推演链时，在summary或evidence中必须保留完整的数字和推演步骤。绝不能压缩成抽象概括。

### 9. "立靶→击破"必须成对出现

当文章的论证策略是逐个击破反对意见时：
- 被反驳的流行观点用setup类型标注（summary中写"常见反对意见：……"）
- 紧跟其后的反驳用reasoning类型标注
- 它们之间用rebuttal类型的connector连接
- 每一对是独立的节点对，不合并

### 10. 历史类比/制度对照的两端都必须出现

当作者用历史案例A来映射当下情况B时，A和B应分别有节点。transition说明映射逻辑。

如果原文用超过1500字来展开一个历史案例，该案例至少需要2-3个节点来还原其内部的推理步骤。

### 11. 逻辑缺口要指出具体省略了什么

不是"此处论证不充分"，而是回答三个问题：
(1) 作者从哪一步跳到了哪一步？中间缺少什么？
(2) 有什么替代可能性被忽略了？
(3) 这个缺口对最终结论的可信度影响有多大？

特别注意：用类比代替论证、引用权威代替推理、从描述跳到规范、过度归因。

### 12. 将论证拆分为逻辑阶段

将整个论证拆分为${phaseMin}-${phaseMax}个逻辑阶段（phase）。每个阶段是论证的一个独立的逻辑段落——不是原文的段落，是推理的段落。

**阶段划分标准：**
- 每个阶段应该有一个可以独立陈述的子目标（如"论证AI无论成败都导致危机"、"论证传统重置机制已失效"）
- 阶段之间的边界通常出现在：论证方向发生重大转折、从一个子问题转向另一个子问题、从历史回到当下
- 阶段标题不超过8字，要体现该阶段在论证中的功能角色（如"AI成败悖论"、"重置困境"）
- subtitle用一句话描述该阶段要完成什么论证任务

### 13. 用connectors显式标注节点间逻辑关系

每两个相邻节点之间必须有一个connector（或者该节点参与了fork/merge）。connector类型：
- **causal**：A 因此 B（因果推导）。label如"因此追问"、"由此推出"
- **parallel**：A 和 B 并列。label如"并列情景"、"另一维度"
- **rebuttal**：B 反驳 A。label如"反驳"、"但是"
- **evidence**：B 是 A 的实例/例证。label如"实例验证"、"案例支撑"
- **self_question**：作者自我质疑。label如"自我质疑"、"反思"
- **fork**：从A分出多条路径。from是单个id，to是id数组。label如"两种情景推演"
- **merge**：多条路径汇合到B。from是id数组，to是单个id。label如"两条路径汇合"

label应该是2-6个字的中文短语，用于UI中节点之间的连接线标注。

### 14. 每个节点必须有one_liner

one_liner是折叠态显示的一句话预览（不超过25字），让读者不展开就能大致了解这个节点在说什么。它比title更具体，比summary更精炼。

## 输出格式

严格输出以下JSON，不要任何额外文字、解释或Markdown标记：

{
  "core_claim": "文章最核心的一句话主张。必须是完整的、可争议的断言，不是主题描述。",
  "argument_density": "N步推导/M千字",
  "claim_clarity": "高/中/低",
  "logic_completeness": "N处缺口",
  "verdict": {
    "strongest": "指出具体的推理步骤编号或名称，说明它为什么在逻辑上站得住。一到两句话。",
    "weakest": "指出具体的推理步骤编号或名称，说明它的逻辑漏洞或证据不足在哪里。一到两句话。",
    "reading_advice": "告诉读者哪些章节/段落值得精读，哪些可以略读。一到两句话。"
  },
  "phases": [
    {
      "id": 1,
      "title": "阶段标题（不超过8字）",
      "subtitle": "一句话描述该阶段在论证中的角色",
      "nodes": [
        {
          "id": "1-0",
          "level": 1,
          "type": "origin",
          "title": "简短有力的标题（不超过15字）",
          "one_liner": "折叠态一句话预览（不超过25字）",
          "summary": "这个节点的核心内容（一到两句话）。如果是断言，写清楚作者主张什么；如果是关键事实或数字推演，保留数字链条；如果是被反驳的流行观点，标注'常见反对意见：……'。",
          "evidence": "回答'凭什么？'。必须包含至少一项：具体数据/百分比/金额、具体案例或历史事件、作者引用的权威观点（标明谁说的）、因果推演的中间步骤。",
          "transition": "两个节点之间的逻辑桥梁（至少20字）。整个输出中最后一个阶段的最后一个节点此字段为null。"
        }
      ],
      "connectors": [
        {
          "type": "causal|parallel|rebuttal|evidence|self_question|fork|merge",
          "from": "1-0",
          "to": "1-1",
          "label": "2-6个字的中文短语"
        }
      ],
      "gaps": [
        {
          "after_node": "1-3",
          "title": "缺口标题（不超过15字）",
          "detail": "回答三个问题：(1)缺少的中间步骤是什么？(2)有什么替代可能性被忽略？(3)对最终结论的可信度影响有多大？",
          "severity": "low|medium|high"
        }
      ]
    }
  ]
}

### 字段规则
- node.type只允许：origin、setup、reasoning、turning、conclusion
- node.level只允许1或2。level 2节点紧跟在它所支撑的level 1节点后面。
- node.id格式为"阶段号-序号"，如"1-0"、"1-1"、"2-0"、"2-3"
- 整个输出中最后一个阶段的最后一个节点的transition必须是null，其他所有节点的transition必须是非空字符串且至少20字
- evidence字段必须是非空字符串，不允许为null
- one_liner不超过25字
- connector.type为fork时，to是数组；为merge时，from是数组；其他类型from和to都是单个id字符串
- connector.label是2-6个字的中文短语
- gaps数组可以为空（如果该阶段没有逻辑缺口）
- phases数量${phaseMin}-${phaseMax}个
- 所有phases中nodes总数${nodeMin}-${nodeMax}个（硬性下限${nodeMin}个），其中level=1主论点${mainMin}-${mainMax}个，level=2子论点不少于${subMin}个
- 本文约${Math.round(charCount / 1000)}千字

## 待分析文章

${text}`;
};

/* 鈹€鈹€ Rate limit (KV-based) 鈹€鈹€ */
const DAILY_LIMIT = 5;
const MINUTE_LIMIT = 3;

async function checkRateLimit(ip, kvStore) {
  const today = new Date().toISOString().slice(0, 10);
  const dayKey = `day:${ip}:${today}`;

  const nowMin = new Date().toISOString().slice(0, 16);
  const minKey = `min:${ip}:${nowMin}`;

  const dayCountRaw = await kvStore.get(dayKey);
  const dayCount = dayCountRaw ? parseInt(dayCountRaw, 10) : 0;
  if (dayCount >= DAILY_LIMIT) {
    return {
      ok: false,
      message: 'Daily analysis limit reached (5/day). Please try again tomorrow! / \\u4eca\\u65e5\\u5206\\u6790\\u6b21\\u6570\\u5df2\\u7528\\u5b8c\\uff085\\u6b21/\\u5929\\uff09\\u3002\\u660e\\u5929\\u518d\\u6765\\u5427\\uff01'
    };
  }

  const minCountRaw = await kvStore.get(minKey);
  const minCount = minCountRaw ? parseInt(minCountRaw, 10) : 0;
  if (minCount >= MINUTE_LIMIT) {
    return {
      ok: false,
      message: 'Too many requests. Please wait a moment. / \\u8bf7\\u6c42\\u8fc7\\u4e8e\\u9891\\u7e41\\uff0c\\u8bf7\\u7a0d\\u540e\\u518d\\u8bd5'
    };
  }

  await kvStore.put(dayKey, String(dayCount + 1), { expirationTtl: 90000 });
  await kvStore.put(minKey, String(minCount + 1), { expirationTtl: 120 });

  return { ok: true, remaining: DAILY_LIMIT - dayCount - 1 };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function jsonError(message, status, headers) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

function sanitizeInput(text) {
  return text
    .replace(/<\/?system>/gi, '')
    .replace(/<\/?user>/gi, '')
    .replace(/<\/?assistant>/gi, '')
    .replace(/\bignore\s+(all\s+)?previous\s+instructions?\b/gi, '[REMOVED]')
    .replace(/\byou\s+are\s+now\b/gi, '[REMOVED]')
    .replace(/\bact\s+as\b/gi, '[REMOVED]')
    .replace(/\bforget\s+(all\s+)?(your\s+)?instructions?\b/gi, '[REMOVED]')
    .replace(/\bsystem\s*:\s*/gi, '[REMOVED]')
    .replace(/\bprompt\s*:\s*/gi, '[REMOVED]');
}

function safeJsonParse(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON not found');
  return JSON.parse(candidate.slice(start, end + 1));
}

function validateAnalysis(parsed) {
  if (!parsed || typeof parsed !== 'object') return 'AI response is not a JSON object';
  if (!parsed.core_claim) return 'Missing core_claim';
  if (!parsed.verdict || typeof parsed.verdict !== 'object') return 'Missing or invalid verdict';
  if (!parsed.verdict.strongest || !parsed.verdict.weakest) return 'Verdict missing strongest/weakest';
  if (!Array.isArray(parsed.phases) || parsed.phases.length === 0) return 'Missing phases';
  for (const phase of parsed.phases) {
    if (!phase.title) return 'Phase ' + phase.id + ' missing title';
    if (!Array.isArray(phase.nodes) || phase.nodes.length === 0) return 'Phase ' + phase.id + ' has no nodes';
    if (!Array.isArray(phase.connectors)) return 'Phase ' + phase.id + ' missing connectors';
  }
  return '';
}


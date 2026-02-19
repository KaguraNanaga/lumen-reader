export async function onRequestPost(context) {
  const headers = corsHeaders();
  const { request, env } = context;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const limitCheck = checkRateLimit(ip);
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

  const prompt = ANALYSIS_PROMPT(text);

  let upstreamResponse;
  try {
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
        temperature: 0.3,
        stream: false
      })
    });
  } catch (error) {
    return jsonError('Upstream request failed', 502, headers);
  }

  if (!upstreamResponse.ok) {
    const errText = await upstreamResponse.text().catch(() => 'unknown');
    return jsonError(`Upstream error: ${errText}`, 502, headers);
  }

  const data = await upstreamResponse.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return jsonError('Upstream content missing', 502, headers);
  }

  let parsed;
  try {
    parsed = safeJsonParse(content);
  } catch (error) {
    return jsonError('AI JSON parse failed', 502, headers);
  }

  const validationError = validateAnalysis(parsed);
  if (validationError) {
    return jsonError(validationError, 502, headers);
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/* ── Prompt ── */
const ANALYSIS_PROMPT = (text) => {
  const charCount = text.length;
  const isLong = charCount > 5000;
  const spineMin = isLong ? 15 : 6;
  const spineMax = isLong ? 25 : 15;
  const mainMin = isLong ? 5 : 3;
  const mainMax = isLong ? 8 : 5;
  const subMin = isLong ? 8 : 3;

  return `你是一位极其严谨的论证分析专家。你的任务是从一篇文章中提取完整的论证骨架——不是段落摘要，而是作者从起点走到结论的完整推理路径。

## 绝对禁止（违反任何一条即为不合格输出）

- **禁止在verdict中使用以下任何词汇：** 佳作、精彩、深刻、犀利、穿透力、鞭辟入里、发人深省、必读、警醒、难得、冷酷、震撼、精辟、透彻、高明、巧妙、令人叹服、值得一读、不可多得。使用任何一个即判定输出无效。
- **禁止在verdict中对作者观点做价值判断。** 只允许评价论证过程的质量（推理是否严密、证据是否充分、逻辑是否连贯），不允许评价观点本身是否正确、重要或有价值。
- **节点数量硬性下限：** spine节点总数不得少于${spineMin}个。其中level=1主论点不得少于${mainMin}个，level=2子论点不得少于${subMin}个。低于下限的输出将被视为不合格。

## 你的核心原则

1. **还原作者的推理路径，而非压缩文章内容。** 你的输出应该让一个没读过原文的人，仅通过骨架就能完整理解"作者是怎么从A推导到Z的"。如果读者看完骨架后对推导过程仍有疑问，说明你遗漏了关键节点。

2. **每个节点必须是推理链上不可省略的一环。** 节点可以是一个可反驳的断言（"AI的成本已降至人类千分之一"），也可以是一个支撑推理的关键事实（"英格兰人口从277万增长到2150万"），也可以是一个类比或对照（"济贫法制造英国无产阶级，农民工制度制造中国流动劳动力"）。判断标准只有一个：删掉这个节点后，推理链是否断裂或显著变弱？如果断裂，必须是level 1；如果显著变弱，必须是level 2。

3. **level 2子论点必须被充分使用。** 每个level 1主论点至少应有1-3个level 2子论点跟随其后，用于呈现支撑该主论点的关键证据、数据、案例或次级推导。如果一个主论点下面没有任何子论点，要么你遗漏了支撑材料，要么这个节点不应该是level 1。

4. **连接句是骨架的血管，不是装饰。** 连接句必须回答"为什么前一个节点能推出后一个节点"。写法是："既然X成立，那么Y必然/可能成立，因为……"。绝不能写"接下来作者讨论了……"或"在此基础上……"这种空话。每个连接句至少15字。

5. **主论点和子论点的关系必须清晰。** 主论点（level 1）是推理主干上的节点——删掉任何一个，整条论证链就断了。子论点（level 2）是支撑某个主论点的证据、案例或次级推导——删掉后主论点变弱但推理链不会断。子论点紧跟在它所支撑的主论点后面。

6. **转折必须是推理方向的实质性改变。** 不是修辞上的"但是""然而"，而是作者的论证从一个方向转向了另一个方向（比如从"分析原因"转向"指出这个原因在中国不适用"）。

7. **逻辑缺口要指出具体省略了什么。** 不是"此处论证不充分"，而是"作者从A跳到了B，但没有论证为什么A能推出B而不是C"。特别注意：作者用类比代替论证的地方（"X类似于Y，所以Z"）、引用权威代替推理的地方（"某某学者认为X，所以X成立"）、以及从描述跳到规范的地方（"现状是X，所以应该Y"）。

8. **当作者用具体数字构建推演链时，数字本身就是骨架。** 例如"1000万房子→贷款800万→跌5%即50万→补不上→拍卖600万→倒欠300万"，这种逐步推演是论证的核心武器，不能压缩成"小幅下跌即可导致破产"这种抽象概括。在summary或detail字段中必须保留完整的数字链条和推演步骤。

9. **当文章的论证策略是逐个击破反对意见时，必须保留"立靶→击破"的配对结构。** 在spine中，被反驳的流行观点用setup类型标注（summary中明确写出"常见反对意见：……"，让读者清楚这不是作者的立场），紧跟其后的反驳用reasoning类型标注。每一对"立靶→击破"都应该是独立的节点对，不要把多个反驳压缩合并。读者需要看到作者击破了哪些具体的反对意见。

10. **当作者使用历史类比/制度对照来构建论证时，类比的两端都必须作为独立节点出现。** 例如作者用"英国济贫法限制贫民流动"来类比"中国农民工制度限制农民身份转换"，这不是背景铺垫，而是核心论证工具。类比的源端（历史案例）和目标端（当下对象）应分别作为节点，连接句中说明类比逻辑。绝不能将跨越数千字的历史论证压缩成一两个节点。

## 输出格式

严格输出以下JSON，不要任何额外文字、解释或Markdown标记：

{
  "core_claim": "这篇文章最核心的一句话主张。必须是一个完整的、可争议的断言，而不是主题描述。错误示例：'本文讨论了AI对就业的影响'。正确示例：'AI将在十年内替代90%的初级程序员岗位'",
  "argument_density": "N步推导/M千字",
  "claim_clarity": "高/中/低",
  "verdict": "严格按以下三部分回答，每部分一到两句话，用(1)(2)(3)标号：(1)最扎实：指出某个具体的推理步骤编号或名称，说明它为什么在逻辑上站得住。(2)最薄弱：指出某个具体的推理步骤编号或名称，说明它的逻辑漏洞或证据不足在哪里。(3)阅读建议：告诉读者哪些章节/段落值得精读，哪些可以略读。注意：只评价推理过程，不评价观点对错。",
  "spine": [
    {
      "id": 1,
      "level": 1,
      "type": "origin",
      "title": "简短有力的标题（不超过15字）",
      "summary": "这个节点的核心内容（一到两句话）。如果是断言，写清楚作者主张什么；如果是关键事实或数字推演，写清楚具体数字和推演步骤；如果是对照/类比，写清楚对照的两端和结论；如果是被反驳的流行观点，明确标注'常见反对意见：……'。",
      "detail": "展开：作者用什么证据或推理支撑这个节点？包含关键数据、案例、引文、数字推演链。保留原文中最有力的表述和最关键的数字。如果是反驳节点，写清楚作者用什么论据击破了这个反对意见。",
      "connection_to_next": "连接到下一步的具体逻辑推进。格式：'既然/由于[前一节点的结论]，那么/因此/但是[后一节点的前提]，因为……'。最后一个spine节点此字段为null。"
    }
  ],
  "logic_gaps": [
    {
      "after_step_id": 1,
      "description": "从步骤X到步骤Y之间，作者省略了什么？回答三个问题：(1)缺少的中间步骤是什么？(2)有什么替代可能性被忽略？(3)这个缺口对最终结论的可信度影响有多大——是致命的还是可接受的？"
    }
  ]
}

### 字段规则
- type只允许：origin（起点/前提）、setup（铺垫/背景/被反驳的流行观点）、reasoning（推导/论证/反驳）、turning（转折）、conclusion（结论）
- level只允许1或2。level 2节点紧跟在它所支撑的level 1节点后面。
- 最后一个spine节点的connection_to_next必须是null，其他所有节点的connection_to_next必须是非空字符串。
- detail字段必须是非空字符串，不允许为null。
- 本文约${Math.round(charCount / 1000)}千字。spine节点总数${spineMin}-${spineMax}个（硬性下限${spineMin}个），其中level=1主论点${mainMin}-${mainMax}个，level=2子论点不少于${subMin}个。

## 待分析文章

${text}`;
};

/* ── Rate limit (in-memory, resets on worker restart) ── */
const counters = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = counters.get(ip) || { minuteCount: 0, minuteStart: now, dayCount: 0, dayStart: now };
  if (now - entry.minuteStart >= 60000) { entry.minuteStart = now; entry.minuteCount = 0; }
  if (now - entry.dayStart >= 86400000) { entry.dayStart = now; entry.dayCount = 0; }
  if (entry.minuteCount >= 5) { counters.set(ip, entry); return { ok: false, message: '请求过于频繁，请稍后再试' }; }
  if (entry.dayCount >= 30) { counters.set(ip, entry); return { ok: false, message: '已达今日分析上限（30次）' }; }
  entry.minuteCount += 1;
  entry.dayCount += 1;
  counters.set(ip, entry);
  return { ok: true };
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
  if (!parsed.core_claim) return 'AI response missing core_claim';
  if (!parsed.verdict) return 'AI response missing verdict';
  if (!Array.isArray(parsed.spine)) return 'AI response missing spine';
  return '';
}

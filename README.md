# Lumen — Argument Skeleton Analyzer

**English** | [中文](./README_CN.md)

Lumen extracts the argument skeleton from any article: core claim, reasoning chain, logic gaps, and reading advice. It's a Chrome extension + web app powered by Gemini, designed to help readers see *how* an author argues, not just *what* they argue.

**[Try the Web App](https://lumen-reader.uk)** · **[Install Chrome Extension](#load-the-chrome-extension)**

## What It Does

Paste an article (or click the extension icon on any webpage), and Lumen returns:

- **Core Claim** — The article's central, debatable assertion (not a topic summary)
- **Argument Phases** — The reasoning broken into logical stages, each with nodes showing the step-by-step reasoning path
- **Connectors** — Explicit logical relationships between nodes: causal, parallel, rebuttal, fork, merge, self-question
- **Logic Gaps** — Where the author skipped steps, ignored alternatives, or substituted analogy for argument
- **Verdict** — Strongest link, weakest link, and what's worth close-reading vs. skimming

## Why This Exists

Most AI "summarizers" compress articles into shorter text. Lumen does something different: it maps the *reasoning structure*. The output isn't a summary — it's a skeleton that reveals how the author gets from premise to conclusion, where the logic holds, and where it doesn't.

The interesting part isn't the product shell (any developer can build a Chrome extension). It's the **prompt engineering** — the set of principles that make the AI produce genuinely useful argument analysis instead of generic summaries.

## Prompt Design Principles

The prompt (`functions/api/analyze.js`) encodes 14 analysis principles. Here are the key ideas:

### The Deletion Test (Master Principle)

Every candidate node must pass: *"If I remove this from the skeleton, does the reader's understanding break?"*

- If the reasoning chain breaks → must keep (level 1)
- If the chain survives but weakens significantly → must keep (level 2)
- If the reader barely notices → not a node

The reverse test matters too: if the original article spends 800+ words arguing a point but your skeleton has one vague node, readers will ask "why should I believe this?" — you've over-compressed.

### Structure Recognition, Not Forced Linearization

Articles rarely argue in a straight line A→B→C. The prompt identifies six argument structures:

| Structure | Pattern | Example |
|-----------|---------|---------|
| Chain | A→B→C→conclusion | Classic deductive reasoning |
| Fork | A diverges into B₁, B₂, then converges | "If AI succeeds→X; if it fails→Y; either way→Z" |
| Historical mapping | Past pattern → present projection | Using colonial history to explain modern geopolitics |
| Straw man demolition | Present popular view → dismantle it | "People think X, but actually..." |
| Inductive convergence | Multiple phenomena → common rule | Several examples leading to one principle |
| Concession-limitation | Advance claim → acknowledge boundaries | "This is true, except when..." |

The skeleton's node arrangement and connector types must reflect the *actual* structure, not flatten everything into a list.

### Argument Density ≠ Word Count

1,000 words of tight reasoning and 1,000 words of illustrative examples need very different numbers of nodes. The prompt calibrates node density to *argumentative density*, not length.

### Banned Verdict Language

The prompt explicitly bans 19 flattering adjectives (精彩, 深刻, 犀利, "must-read", etc.) from the verdict. The AI can only evaluate *the quality of reasoning* (is the logic tight? is the evidence sufficient?), never the *value of the opinion itself*.

## Architecture

```
User → Chrome Extension sidepanel / Web app (public/index.html)
         ↓
    Cloudflare Pages Functions (functions/api/analyze.js)
         ↓
    Proxy gateway → Gemini 3 Pro Preview
         ↓
    JSON response → Frontend rendering
```

| Component | Stack |
|-----------|-------|
| API | Cloudflare Pages Functions, KV for rate limiting |
| Web app | React + Babel (in-browser, single file, no build step) |
| Extension | Vanilla JS, Chrome Manifest V3, Side Panel API |
| AI | Gemini 3 Pro Preview via proxy gateway |

## Setup

### Prerequisites

- Node.js 18+
- A Cloudflare account
- A Gemini API key (or compatible proxy)
- Wrangler CLI: `npm install -g wrangler`

### 1. Clone and configure

```bash
git clone https://github.com/KaguraNanaga/lumen-reader.git
cd lumen-reader
```

Create a `.dev.vars` file for local development:

```
GEMINI_API_KEY=your_api_key_here
```

### 2. Set up rate limiting (Cloudflare KV)

```bash
# Create KV namespace
npx wrangler kv namespace create RATE_LIMIT

# Add the returned ID to wrangler.toml
```

Your `wrangler.toml` should look like:

```toml
name = "lumen"
pages_build_output_dir = "public"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "your-kv-namespace-id"
```

### 3. Deploy the web app

```bash
npx wrangler pages deploy public
```

Set the `GEMINI_API_KEY` secret in Cloudflare dashboard → Pages → Settings → Environment variables.

### 4. Load the Chrome extension

The extension is not yet on the Chrome Web Store. Load it in developer mode:

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `lumen-extension/` folder
4. Navigate to any article and click the Lumen icon

> **Note:** The extension calls the deployed API at the URL set in `sidepanel.js` (`API_BASE`). Update this to your own deployment URL.

## Project Structure

```
├── functions/
│   └── api/
│       └── analyze.js          # API: prompt, rate limiting, validation
├── lumen-extension/
│   ├── _locales/               # i18n (en + zh_CN)
│   ├── icons/
│   ├── background.js           # Extension lifecycle
│   ├── content.js              # Article text extraction (Readability.js)
│   ├── sidepanel.js            # Extension UI rendering
│   ├── sidepanel.css
│   ├── sidepanel.html
│   ├── Readability.js          # Mozilla Readability
│   └── manifest.json
├── public/
│   ├── index.html              # Web app (React, single file)
│   ├── privacy.html
│   ├── terms.html
│   └── icons/
├── wrangler.toml
└── README_CN.md                # 中文说明
```

## JSON Schema (V3)

The AI outputs structured JSON with phases, nodes, connectors, and gaps. See the full schema in `analyze.js`.

Key design decisions:
- `spine[]` → `phases[].nodes[]` — long articles need collapsible stage grouping
- `verdict` string → `{ strongest, weakest, reading_advice }` object — higher information density
- `connectors[]` per phase — explicit logical relationships, not just sequential ordering
- Node IDs use `"phase-index"` format (e.g., `"2-3"`) for cross-referencing

## Customizing the Prompt

The most valuable part of this project is the prompt in `analyze.js`. If you want to adapt it:

- **Change node density**: Adjust `nodeMin`/`nodeMax` thresholds based on `charCount`
- **Add analysis principles**: Add to the numbered list; the deletion test should remain the master principle
- **Change output language**: The prompt auto-detects input language; override the language rules section for fixed-language output
- **Change the AI model**: Update the `model` field in the fetch call; the prompt is model-agnostic but tested on Gemini 3 Pro

## Rate Limits

- 5 analyses per IP per day
- 3 analyses per IP per minute
- Stored in Cloudflare KV with TTL auto-expiry

## Bilingual Support

Both the web app and extension support English and Chinese. The web app has a manual toggle button (CN/EN). The AI automatically outputs analysis in the same language as the input article.

## License

MIT

## Acknowledgments

- [Mozilla Readability](https://github.com/mozilla/readability) — Article text extraction
- [Google Gemini](https://deepmind.google/technologies/gemini/) — AI analysis engine
- [Cloudflare Pages](https://pages.cloudflare.com/) — Deployment and edge computing

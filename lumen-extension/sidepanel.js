const API_BASE = 'https://lumen-atj-4t6.pages.dev';
const API_ANALYZE = new URL('/api/analyze', API_BASE).toString();

/* ── Custom i18n system ── */
const I18N = {
  en: {
    appName: 'Lumen',
    waitingAnalysis: 'Waiting for analysis',
    idleHint: 'Click the Lumen icon on any article page to analyze it',
    reanalyzeBtn: 'Reanalyze',
    copyBtn: 'Copy skeleton',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    coreClaim: 'Core Claim',
    argDensity: 'Argument Density',
    claimClarity: 'Claim Clarity',
    logicCompleteness: 'Logic Completeness',
    verdict: 'Verdict',
    strongest: 'Strongest',
    weakest: 'Weakest',
    readingAdvice: 'Reading Advice',
    logicGap: 'Logic Gap',
    logicGaps: 'gaps',
    refOnly: 'For reference only',
    evidence: 'Evidence',
    typeOrigin: 'Origin',
    typeSetup: 'Setup',
    typeReasoning: 'Reasoning',
    typeTurning: 'Turning',
    typeConclusion: 'Conclusion',
    errorUnknown: 'An unknown error occurred.',
    errorStatus: 'Server error',
    loadingExtract: 'Extracting article content...',
    loadingAnalyze: 'Analyzing argument structure...',
    loadingSpine: 'Building argument skeleton...',
    loadingLong: 'This is a long article, still analyzing...',
    loadingAlmost: 'Almost done...',
    nextStep: 'Next Step',
    summary: 'Summary',
    fork: 'Fork',
    merge: 'Merge',
    copied: 'Copied!',
    selectNodeHint: 'Click a node to view details'
  },
  zh: {
    appName: 'Lumen',
    waitingAnalysis: '\u7b49\u5f85\u5206\u6790',
    idleHint: '\u70b9\u51fb\u63d2\u4ef6\u56fe\u6807\uff0c\u5206\u6790\u5f53\u524d\u9875\u9762\u7684\u6587\u7ae0',
    reanalyzeBtn: '\u91cd\u65b0\u5206\u6790',
    copyBtn: '\u590d\u5236\u9aa8\u67b6',
    expandAll: '\u5168\u90e8\u5c55\u5f00',
    collapseAll: '\u5168\u90e8\u6536\u8d77',
    coreClaim: '\u6838\u5fc3\u4e3b\u5f20',
    argDensity: '\u8bba\u8bc1\u5bc6\u5ea6',
    claimClarity: '\u4e3b\u5f20\u6e05\u6670\u5ea6',
    logicCompleteness: '\u903b\u8f91\u5b8c\u6574\u6027',
    verdict: '\u7efc\u5408\u8bc4\u4ef7',
    strongest: '\u6700\u5f3a\u73af\u8282',
    weakest: '\u6700\u5f31\u73af\u8282',
    readingAdvice: '\u9605\u8bfb\u5efa\u8bae',
    logicGap: '\u903b\u8f91\u7f3a\u53e3',
    logicGaps: '\u5904\u7f3a\u53e3',
    refOnly: '\u4ec5\u4f9b\u53c2\u8003',
    evidence: '\u8bba\u636e',
    typeOrigin: '\u8d77\u70b9',
    typeSetup: '\u94fa\u57ab',
    typeReasoning: '\u63a8\u7406',
    typeTurning: '\u8f6c\u6298',
    typeConclusion: '\u7ed3\u8bba',
    errorUnknown: '\u53d1\u751f\u672a\u77e5\u9519\u8bef\u3002',
    errorStatus: '\u670d\u52a1\u5668\u9519\u8bef',
    loadingExtract: '\u6b63\u5728\u63d0\u53d6\u6587\u7ae0\u5185\u5bb9...',
    loadingAnalyze: '\u6b63\u5728\u5206\u6790\u8bba\u8bc1\u7ed3\u6784...',
    loadingSpine: '\u6b63\u5728\u6784\u5efa\u8bba\u8bc1\u9aa8\u67b6...',
    loadingLong: '\u6587\u7ae0\u8f83\u957f\uff0c\u8fd8\u5728\u5206\u6790...',
    loadingAlmost: '\u5373\u5c06\u5b8c\u6210...',
    nextStep: '\u4e0b\u4e00\u6b65',
    summary: '\u6458\u8981',
    fork: '\u5206\u53c9',
    merge: '\u6c47\u5408',
    copied: '\u5df2\u590d\u5236\uff01',
    selectNodeHint: '\u2190 \u70b9\u51fb\u8282\u70b9\u67e5\u770b\u8be6\u60c5'
  }
};

let LANG = localStorage.getItem('lumen_lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en');
function t(key) { return (I18N[LANG] && I18N[LANG][key]) || (I18N.en[key]) || key; }
function getTypeMap() {
  return {
    origin: { label: t('typeOrigin'), color: 'blue' },
    setup: { label: t('typeSetup'), color: 'amber' },
    reasoning: { label: t('typeReasoning'), color: 'green' },
    turning: { label: t('typeTurning'), color: 'red' },
    conclusion: { label: t('typeConclusion'), color: 'blue' }
  };
}

const state = {
  status: 'idle',
  analysis: null,
  title: '',
  url: '',
  errorMessage: '',
  expandedPhases: new Set(),
  expandedNodes: new Set(),
  activeNodes: {},
  expandedGaps: new Set()
};

const dom = {
  pageTitle: document.getElementById('pageTitle'),
  idleState: document.getElementById('idleState'),
  loadingState: document.getElementById('loadingState'),
  errorState: document.getElementById('errorState'),
  resultState: document.getElementById('resultState'),
  btnReanalyze: document.getElementById('btnReanalyze'),
  btnCopy: document.getElementById('btnCopy')
};

let loadingTimers = [];
let loadingInterval = null;
let loadingStageIndex = 0;
let loadingProgress = 0;
let loadingProgressTarget = 0;
let loadingEls = null;

function render() {
  // Refresh i18n on all data-i18n elements
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    el.textContent = t(el.getAttribute('data-i18n'));
  });

  // Ensure language toggle exists in status bar
  renderLangToggle();

  dom.idleState.style.display = state.status === 'idle' ? '' : 'none';
  dom.loadingState.style.display = state.status === 'loading' ? '' : 'none';
  dom.errorState.style.display = state.status === 'error' ? '' : 'none';
  dom.resultState.style.display = state.status === 'success' ? '' : 'none';

  dom.pageTitle.textContent = state.title || t('appName');

  if (state.status === 'loading') {
    renderSkeleton();
    startLoadingStages();
  } else {
    stopLoadingStages();
  }
  if (state.status === 'error') renderError();
  if (state.status === 'success') renderResult();
}

function renderLangToggle() {
  var bar = document.querySelector('.status-bar');
  if (!bar) return;
  var existing = bar.querySelector('.lang-toggle');
  if (existing) existing.remove();

  var wrap = document.createElement('div');
  wrap.className = 'lang-toggle';
  wrap.style.cssText = 'margin-left:auto;display:flex;gap:0;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.25);font-size:11px;font-weight:600;';

  var btnCN = document.createElement('button');
  btnCN.textContent = 'CN';
  btnCN.style.cssText = 'padding:2px 8px;border:none;cursor:pointer;' + (LANG === 'zh' ? 'background:#fff;color:#1a1714;' : 'background:transparent;color:rgba(255,255,255,0.6);');
  btnCN.addEventListener('click', function() { switchLang('zh'); });

  var btnEN = document.createElement('button');
  btnEN.textContent = 'EN';
  btnEN.style.cssText = 'padding:2px 8px;border:none;cursor:pointer;' + (LANG === 'en' ? 'background:#fff;color:#1a1714;' : 'background:transparent;color:rgba(255,255,255,0.6);');
  btnEN.addEventListener('click', function() { switchLang('en'); });

  wrap.appendChild(btnCN);
  wrap.appendChild(btnEN);
  bar.appendChild(wrap);
}

function switchLang(lang) {
  LANG = lang;
  localStorage.setItem('lumen_lang', lang);
  render();
}

function renderSkeleton() {
  dom.loadingState.innerHTML = '';
  ensureLoadingStyles();

  const stageWrap = document.createElement('div');
  stageWrap.className = 'loading-stage';

  const stageRow = document.createElement('div');
  stageRow.className = 'loading-stage-row';

  const spinner = document.createElement('span');
  spinner.className = 'loading-spinner';

  const stageText = document.createElement('div');
  stageText.className = 'loading-stage-text';

  stageRow.appendChild(spinner);
  stageRow.appendChild(stageText);

  const progress = document.createElement('div');
  progress.className = 'loading-progress';

  const progressFill = document.createElement('div');
  progressFill.className = 'loading-progress-fill';
  progress.appendChild(progressFill);

  stageWrap.appendChild(stageRow);
  stageWrap.appendChild(progress);
  dom.loadingState.appendChild(stageWrap);

  loadingEls = { stageText, progressFill };

  for (let i = 0; i < 4; i += 1) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    for (let j = 0; j < 3; j += 1) {
      const line = document.createElement('div');
      line.className = 'skeleton-line';
      card.appendChild(line);
    }
    dom.loadingState.appendChild(card);
  }
}

function renderError() {
  dom.errorState.textContent = state.errorMessage || t('errorUnknown');
}

const WIDE_BREAKPOINT = 780;
let lastIsWide = window.innerWidth >= WIDE_BREAKPOINT;
let resizeBound = false;

function isWide() {
  return window.innerWidth >= WIDE_BREAKPOINT;
}

function renderResult() {
  dom.resultState.innerHTML = '';

  const a = state.analysis;
  if (!a) return;

  renderMetaCard(a, dom.resultState);
  renderToolbar(dom.resultState);

  const phases = Array.isArray(a.phases) ? a.phases : [];
  phases.forEach((phase, idx) => renderPhase(phase, idx, dom.resultState));

  renderVerdict(a.verdict, dom.resultState);
  bindInteractions();
}

function renderMetaCard(analysis, container) {
  const claimBanner = document.createElement('div');
  claimBanner.className = 'claim-banner';

  const claimLabel = document.createElement('div');
  claimLabel.className = 'claim-label';
  claimLabel.textContent = t('coreClaim');

  const claimText = document.createElement('div');
  claimText.className = 'claim-text';
  claimText.textContent = analysis.core_claim || '';

  const claimMetrics = document.createElement('div');
  claimMetrics.className = 'claim-metrics';

  const density = document.createElement('div');
  density.appendChild(makeMetricDot(metricColor(analysis.argument_density)));
  density.appendChild(document.createTextNode(`${t('argDensity')}: ${analysis.argument_density || '—'}`));

  const clarity = document.createElement('div');
  clarity.appendChild(makeMetricDot(metricColor(analysis.claim_clarity)));
  clarity.appendChild(document.createTextNode(`${t('claimClarity')}: ${analysis.claim_clarity || '—'}`));

  const gapCount = (analysis.phases || []).reduce((sum, p) => sum + (p.gaps?.length || 0), 0);
  const completenessValue = analysis.logic_completeness || `${gapCount} ${t('logicGaps')}`;
  const completeness = document.createElement('div');
  completeness.appendChild(makeMetricDot(gapCount === 0 ? 'green' : gapCount <= 2 ? 'amber' : 'red'));
  completeness.appendChild(document.createTextNode(`${t('logicCompleteness')}: ${completenessValue || '—'}`));

  claimMetrics.appendChild(density);
  claimMetrics.appendChild(clarity);
  claimMetrics.appendChild(completeness);

  claimBanner.appendChild(claimLabel);
  claimBanner.appendChild(claimText);
  claimBanner.appendChild(claimMetrics);

  container.appendChild(claimBanner);
}

function renderToolbar(container) {
  const toolbar = document.createElement('div');
  toolbar.className = 'result-toolbar';

  const btnExpand = document.createElement('button');
  btnExpand.className = 'tool-btn';
  btnExpand.dataset.action = 'expand-all';
  btnExpand.textContent = t('expandAll');

  const btnCollapse = document.createElement('button');
  btnCollapse.className = 'tool-btn';
  btnCollapse.dataset.action = 'collapse-all';
  btnCollapse.textContent = t('collapseAll');

  toolbar.appendChild(btnExpand);
  toolbar.appendChild(btnCollapse);
  container.appendChild(toolbar);
}

function renderPhase(phase, index, container) {
  const phaseWrap = document.createElement('div');
  phaseWrap.className = 'phase';
  phaseWrap.dataset.phaseId = String(phase.id);
  if (state.expandedPhases.has(String(phase.id))) phaseWrap.classList.add('open');

  const header = document.createElement('div');
  header.className = 'phase-header';
  header.dataset.phaseHeader = 'true';

  const num = document.createElement('div');
  num.className = `phase-num pn-${(index % 4) + 1}`;
  num.textContent = String(phase.id ?? index + 1);

  const info = document.createElement('div');
  info.className = 'phase-info';

  const title = document.createElement('div');
  title.className = 'phase-title';
  title.textContent = phase.title || '';

  const sub = document.createElement('div');
  sub.className = 'phase-sub';
  sub.textContent = phase.subtitle || '';

  info.appendChild(title);
  info.appendChild(sub);

  const toggle = document.createElement('span');
  toggle.className = 'phase-toggle';
  toggle.textContent = '▶';

  header.appendChild(num);
  header.appendChild(info);
  header.appendChild(toggle);

  const body = document.createElement('div');
  body.className = 'phase-body';

  const inner = document.createElement('div');
  inner.className = 'phase-body-inner';

  const nodeFlow = renderNodeFlow(phase);
  inner.appendChild(nodeFlow);

  const detailPanel = renderDetailPanel(phase);
  inner.appendChild(detailPanel);

  body.appendChild(inner);
  phaseWrap.appendChild(header);
  phaseWrap.appendChild(body);
  container.appendChild(phaseWrap);
}

function renderNodeFlow(phase) {
  const wrap = document.createElement('div');
  wrap.className = 'node-flow';

  const nodes = Array.isArray(phase.nodes) ? phase.nodes : [];
  const connectors = Array.isArray(phase.connectors) ? phase.connectors : [];
  const gaps = Array.isArray(phase.gaps) ? phase.gaps : [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    renderNode(node, phase, wrap);

    const conn = connectors.find((c) => {
      if (c.type === 'fork') return c.from === node.id;
      if (c.type === 'merge') return Array.isArray(c.from) && c.from.includes(node.id) && c.to === nodes[i + 1]?.id;
      return c.from === node.id;
    });

    if (conn && i < nodes.length - 1) {
      if (conn.type === 'fork') renderForkConnector(conn.label, wrap);
      else if (conn.type === 'merge') renderMergeConnector(conn.label, wrap);
      else renderFlowConnector(conn.label, wrap);
    }

    const gap = gaps.find((g) => g.after_node === node.id);
    if (gap) renderGap(gap, wrap);
  }

  return wrap;
}

function renderNode(node, phase, container) {
  const nodeWrap = document.createElement('div');
  nodeWrap.className = 'node-item';
  nodeWrap.dataset.nodeId = String(node.id);
  nodeWrap.dataset.phaseId = String(phase.id);
  if (node.level === 2) nodeWrap.classList.add('sub');

  const isNodeOpen = state.expandedNodes.has(node.id);
  if (isNodeOpen) nodeWrap.classList.add('open');

  const activeId = state.activeNodes[String(phase.id)];
  if (activeId && activeId === node.id) nodeWrap.classList.add('active');

  const head = document.createElement('div');
  head.className = 'node-head';

  const dot = document.createElement('span');
  dot.className = 'node-dot';
  const typeInfo = getTypeMap()[node.type] || {};
  if (typeInfo.color) dot.classList.add(typeInfo.color);

  const headBody = document.createElement('div');
  headBody.style.flex = '1';

  const title = document.createElement('div');
  title.textContent = node.title || '';

  const oneLiner = document.createElement('div');
  oneLiner.className = 'node-one-liner';
  oneLiner.textContent = node.one_liner || '';

  headBody.appendChild(title);
  if (node.one_liner) headBody.appendChild(oneLiner);

  const tag = document.createElement('span');
  tag.className = 'node-type-tag';
  tag.textContent = typeInfo.label || node.type || '';

  head.appendChild(dot);
  head.appendChild(headBody);
  head.appendChild(tag);

  const detail = document.createElement('div');
  detail.className = 'node-detail-inline';

  detail.appendChild(makeDetailSection('summary', node.summary));
  detail.appendChild(makeDetailSection('evidence', node.evidence));
  if (node.transition) detail.appendChild(makeDetailSection('nextStep', node.transition));

  nodeWrap.appendChild(head);
  nodeWrap.appendChild(detail);
  container.appendChild(nodeWrap);
}

function makeDetailSection(label, text) {
  const wrap = document.createElement('div');
  wrap.className = 'nd-section';

  const lab = document.createElement('div');
  lab.className = 'nd-label';
  lab.textContent = t(label);

  const body = document.createElement('div');
  body.className = label === 'nextStep' ? 'nd-transition' : label === 'evidence' ? 'nd-evidence' : 'nd-summary';
  body.textContent = text || '';

  wrap.appendChild(lab);
  wrap.appendChild(body);
  return wrap;
}

function renderFlowConnector(label, container) {
  const conn = document.createElement('div');
  conn.className = 'flow-connector';
  conn.textContent = label || '';
  container.appendChild(conn);
}

function renderForkConnector(label, container) {
  const conn = document.createElement('div');
  conn.className = 'flow-connector';
  const tag = document.createElement('span');
  tag.className = 'flow-fork';
  tag.textContent = label || t('fork');
  conn.appendChild(tag);
  container.appendChild(conn);
}

function renderMergeConnector(label, container) {
  const conn = document.createElement('div');
  conn.className = 'flow-connector';
  const tag = document.createElement('span');
  tag.className = 'flow-merge';
  tag.textContent = label || t('merge');
  conn.appendChild(tag);
  container.appendChild(conn);
}

function renderGap(gap, container) {
  const gapEl = document.createElement('div');
  gapEl.className = 'flow-gap';
  gapEl.dataset.gapKey = String(gap.after_node);
  if (state.expandedGaps.has(String(gap.after_node))) gapEl.classList.add('open');
  gapEl.textContent = gap.title || t('logicGap');

  const detail = document.createElement('div');
  detail.className = 'flow-gap-detail';
  detail.textContent = gap.detail || '';

  container.appendChild(gapEl);
  container.appendChild(detail);
}

function renderDetailPanel(phase) {
  const panel = document.createElement('div');
  panel.className = 'detail-panel';

  const nodes = Array.isArray(phase.nodes) ? phase.nodes : [];
  const gaps = Array.isArray(phase.gaps) ? phase.gaps : [];
  const gapMap = new Map();
  gaps.forEach((g) => gapMap.set(String(g.after_node), g));

  if (!nodes.length) {
    const empty = document.createElement('div');
    empty.className = 'detail-empty';
    empty.textContent = t('selectNodeHint');
    panel.appendChild(empty);
    return panel;
  }

  const activeId = state.activeNodes[String(phase.id)] || nodes[0].id;

  nodes.forEach((node) => {
    const card = document.createElement('div');
    card.className = 'detail-card';
    card.dataset.nodeId = String(node.id);
    card.dataset.phaseId = String(phase.id);
    if (node.id === activeId) card.classList.add('active');

    const header = document.createElement('div');
    header.className = 'dp-header';

    const title = document.createElement('div');
    title.className = 'dp-title';
    title.textContent = node.title || '';

    const typeInfo = getTypeMap()[node.type] || {};
    const type = document.createElement('span');
    type.className = `dp-type dpt-${node.type || 'origin'}`;
    type.textContent = typeInfo.label || node.type || '';

    header.appendChild(title);
    header.appendChild(type);

    const summary = document.createElement('div');
    summary.className = 'dp-summary';
    summary.textContent = node.summary || '';

    const labelEvidence = document.createElement('div');
    labelEvidence.className = 'dp-label';
  labelEvidence.textContent = t('evidence');

    const body = document.createElement('div');
    body.className = 'dp-body';
    body.textContent = node.evidence || '';

    const transition = document.createElement('div');
    transition.className = 'dp-transition';
    transition.textContent = node.transition || '';

    card.appendChild(header);
    card.appendChild(summary);
    card.appendChild(labelEvidence);
    card.appendChild(body);
    if (node.transition) card.appendChild(transition);

    const gap = gapMap.get(String(node.id));
    if (gap) {
      const gapCard = document.createElement('div');
      gapCard.className = 'dp-gap';
      gapCard.textContent = gap.detail || gap.title || t('logicGap');
      card.appendChild(gapCard);
    }

    panel.appendChild(card);
  });

  return panel;
}

function renderVerdict(verdict, container) {
  if (!verdict || typeof verdict !== 'object') return;

  const card = document.createElement('div');
  card.className = 'verdict-card';

  const makeItem = (label, text, cls) => {
    if (!text) return null;
    const item = document.createElement('div');
    item.className = 'verdict-item';
    const tag = document.createElement('span');
    tag.className = `verdict-tag ${cls}`;
    tag.textContent = label;
    const body = document.createElement('div');
    body.className = 'verdict-text';
    body.textContent = text;
    item.appendChild(tag);
    item.appendChild(body);
    return item;
  };

  const strongest = makeItem(t('strongest'), verdict.strongest, 'vt-solid');
  const weakest = makeItem(t('weakest'), verdict.weakest, 'vt-weak');
  const advice = makeItem(t('readingAdvice'), verdict.reading_advice, 'vt-advice');

  if (strongest) card.appendChild(strongest);
  if (weakest) card.appendChild(weakest);
  if (advice) card.appendChild(advice);

  container.appendChild(card);
}

function bindInteractions() {
  const phaseHeaders = dom.resultState.querySelectorAll('[data-phase-header="true"]');
  phaseHeaders.forEach((header) => {
    header.addEventListener('click', () => {
      const phaseId = header.parentElement?.dataset?.phaseId;
      if (!phaseId) return;
      if (state.expandedPhases.has(String(phaseId))) state.expandedPhases.delete(String(phaseId));
      else state.expandedPhases.add(String(phaseId));
      render();
    });
  });

  const nodeHeads = dom.resultState.querySelectorAll('.node-item .node-head');
  nodeHeads.forEach((head) => {
    head.addEventListener('click', () => {
      const node = head.closest('.node-item');
      const nodeId = node?.dataset?.nodeId;
      const phaseId = node?.dataset?.phaseId;
      if (!nodeId || !phaseId) return;

      if (isWide()) {
        state.activeNodes[String(phaseId)] = nodeId;
      } else {
        if (state.expandedNodes.has(nodeId)) state.expandedNodes.delete(nodeId);
        else state.expandedNodes.add(nodeId);
      }
      render();
    });
  });

  const gaps = dom.resultState.querySelectorAll('.flow-gap');
  gaps.forEach((gapEl) => {
    gapEl.addEventListener('click', () => {
      const key = gapEl.dataset.gapKey;
      if (!key) return;
      if (state.expandedGaps.has(key)) state.expandedGaps.delete(key);
      else state.expandedGaps.add(key);
      render();
    });
  });

  const toolbarButtons = dom.resultState.querySelectorAll('.tool-btn');
  toolbarButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (!state.analysis) return;
      if (action === 'expand-all') {
        const phases = state.analysis.phases || [];
        state.expandedPhases = new Set(phases.map((p) => String(p.id)));
        if (isWide()) {
          const active = {};
          phases.forEach((p) => {
            const first = p.nodes?.[0];
            if (first) active[String(p.id)] = first.id;
          });
          state.activeNodes = active;
        } else {
          const nodes = [];
          phases.forEach((p) => (p.nodes || []).forEach((n) => nodes.push(n.id)));
          state.expandedNodes = new Set(nodes);
        }
      }
      if (action === 'collapse-all') {
        state.expandedPhases = new Set();
        state.expandedNodes = new Set();
        state.activeNodes = {};
      }
      render();
    });
  });

  if (!resizeBound) {
    window.addEventListener('resize', () => {
      const wideNow = isWide();
      if (wideNow === lastIsWide) return;
      lastIsWide = wideNow;
      syncModeSwitch(wideNow);
      render();
    });
    resizeBound = true;
  }
}

function syncModeSwitch(toWide) {
  if (!state.analysis) return;
  const phases = state.analysis.phases || [];

  if (toWide) {
    const active = {};
    phases.forEach((p) => {
      const expanded = (p.nodes || []).find((n) => state.expandedNodes.has(n.id));
      const first = p.nodes?.[0];
      if (expanded) active[String(p.id)] = expanded.id;
      else if (first) active[String(p.id)] = first.id;
    });
    state.activeNodes = active;
  } else {
    const expanded = new Set(state.expandedNodes);
    Object.values(state.activeNodes || {}).forEach((id) => expanded.add(id));
    state.expandedNodes = expanded;
  }
}

function ensureLoadingStyles() {
  if (document.getElementById('loadingStyles')) return;
  const style = document.createElement('style');
  style.id = 'loadingStyles';
  style.textContent = `
    .loading-stage {
      margin-bottom: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--paper-card);
      border: 1px solid var(--border-light);
    }
    .loading-stage-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--ink-secondary);
    }
    .loading-spinner {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid var(--border);
      border-top-color: var(--accent-blue);
      animation: spin 0.9s linear infinite;
      flex-shrink: 0;
    }
    .loading-progress {
      margin-top: 10px;
      height: 6px;
      border-radius: 999px;
      background: var(--paper-warm);
      overflow: hidden;
    }
    .loading-progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-green));
      transition: width 0.35s ease;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

function startLoadingStages() {
  if (!loadingEls) return;
  stopLoadingStages();

  const stages = [
    { delay: 0, text: t('loadingExtract'), percent: 0 },
    { delay: 1000, text: t('loadingAnalyze'), percent: 10 },
    { delay: 5000, text: t('loadingSpine'), percent: 30 },
    { delay: 15000, text: t('loadingLong'), percent: 60 },
    { delay: 30000, text: t('loadingAlmost'), percent: 85 }
  ];

  const setStage = (index) => {
    loadingStageIndex = index;
    loadingProgress = stages[index].percent;
    loadingProgressTarget = stages[index + 1] ? stages[index + 1].percent - 2 : 95;
    loadingEls.stageText.textContent = stages[index].text;
    loadingEls.progressFill.style.width = `${loadingProgress}%`;
  };

  setStage(0);

  for (let i = 1; i < stages.length; i += 1) {
    const timer = setTimeout(() => setStage(i), stages[i].delay);
    loadingTimers.push(timer);
  }

  loadingInterval = setInterval(() => {
    if (!loadingEls) return;
    if (loadingProgress < loadingProgressTarget) {
      loadingProgress = Math.min(loadingProgress + 0.3, loadingProgressTarget);
      loadingEls.progressFill.style.width = `${loadingProgress}%`;
    }
  }, 200);
}

function stopLoadingStages() {
  loadingTimers.forEach((t) => clearTimeout(t));
  loadingTimers = [];
  if (loadingInterval) clearInterval(loadingInterval);
  loadingInterval = null;
  loadingStageIndex = 0;
  loadingProgress = 0;
  loadingProgressTarget = 0;
}

function metricColor(value) {
  if (!value) return 'amber';
  const v = String(value).toLowerCase();
  if (v.includes('高') || v.includes('强') || v.includes('好') || v.includes('high') || v.includes('strong') || v.includes('good')) return 'green';
  if (v.includes('低') || v.includes('弱') || v.includes('差') || v.includes('low') || v.includes('weak') || v.includes('poor')) return 'red';
  return 'amber';
}

function makeMetricDot(color) {
  const dot = document.createElement('span');
  dot.className = 'metric-dot';
  if (color) dot.classList.add(color);
  return dot;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.action) return;

  if (msg.action === 'analyze') {
    state.title = msg.title || '';
    state.url = msg.url || '';
    state.status = 'loading';
    state.expandedPhases = new Set();
    state.expandedNodes = new Set();
    state.activeNodes = {};
    state.expandedGaps = new Set();
    render();
    analyzeText(msg.text);
  }

  if (msg.action === 'error') {
    state.status = 'error';
    state.errorMessage = msg.message || t('errorUnknown');
    render();
  }
});

async function analyzeText(text) {
  try {
    const res = await fetch(API_ANALYZE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      let errMessage = '';
      if (contentType.includes('application/json')) {
        const err = await res.json().catch(() => ({}));
        errMessage = err.error || '';
      } else {
        const errText = await res.text().catch(() => '');
        errMessage = errText.trim();
      }
      throw new Error(errMessage || t('errorStatus', String(res.status)));
    }

    const data = await res.json();
    state.analysis = data;
    state.status = 'success';
    state.expandedPhases = new Set((data.phases || []).slice(0, 1).map(p => String(p.id)));
    state.expandedNodes = new Set();
    state.activeNodes = {};
    state.expandedGaps = new Set();
    const firstPhase = data.phases?.[0];
    if (firstPhase && firstPhase.nodes?.[0]) {
      if (isWide()) state.activeNodes[String(firstPhase.id)] = firstPhase.nodes[0].id;
      else state.expandedNodes.add(firstPhase.nodes[0].id);
    }
  } catch (err) {
    state.status = 'error';
    state.errorMessage = err.message || t('errorUnknown');
  }

  render();
}

dom.btnReanalyze.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'reanalyze' });
});

dom.btnCopy.addEventListener('click', () => {
  if (!state.analysis) return;
  const a = state.analysis;
  let text = '【' + (a.core_claim || '') + '】\n\n';
  text += t('argDensity') + ': ' + (a.argument_density || '') + '\n';
  text += t('claimClarity') + ': ' + (a.claim_clarity || '') + '\n\n';
  for (const phase of (a.phases || [])) {
    text += '=== ' + (phase.title || '') + ' ===\n';
    text += (phase.subtitle || '') + '\n\n';
    for (const node of (phase.nodes || [])) {
      const prefix = node.level === 2 ? '  └ ' : '● ';
      text += prefix + (node.title || '') + '：' + (node.summary || '') + '\n';
    }
    text += '\n';
  }
  if (a.verdict) {
    text += '--- ' + t('verdict') + ' ---\n';
    text += t('strongest') + ': ' + (a.verdict.strongest || '') + '\n';
    text += t('weakest') + ': ' + (a.verdict.weakest || '') + '\n';
    text += t('readingAdvice') + ': ' + (a.verdict.reading_advice || '') + '\n';
  }
  navigator.clipboard.writeText(text).then(() => {
    const original = dom.btnCopy.textContent;
    dom.btnCopy.textContent = t('copied');
    dom.btnCopy.disabled = true;
    setTimeout(() => { dom.btnCopy.textContent = original; dom.btnCopy.disabled = false; }, 2000);
  });
});

// Initial render (includes i18n application and lang toggle)
render();

// Tell background we're ready to receive messages
chrome.runtime.sendMessage({ action: 'sidepanelReady' });
console.log('Lumen sidepanel loaded and ready');




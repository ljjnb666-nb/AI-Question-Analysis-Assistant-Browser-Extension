const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
if (!API_KEY) {
  console.error('Missing DEEPSEEK_API_KEY');
  process.exit(1);
}

const BASE_URL = 'https://www.tiku.cn/chapterq?cid=8&cno=1&p=9';

const SYSTEM_PROMPT = `你是一个专业的题目解析助手。分析用户发送的题目文本，严格按如下JSON格式回复，不要有其他文字：
{"questionType":"single_choice","answer":"B","confidence":0.95,"briefExplanation":"简短解析（1-2句）","detailedExplanation":"详细步骤解析","recognizedText":"题目原文","warning":null}`;

function buildPrompt(text) {
  return [
    'Current route: text-only',
    'For multiple-choice questions, option mapping accuracy is critical.',
    'Always reconstruct all options exactly before deciding the answer.',
    'If options are composite forms (e.g. A=①②④, B=①③④), verify each statement first, then map to A/B/C/D.',
    'If any option text is missing or ambiguous, set warning with a concise reason instead of guessing confidently.',
    '<<<QUESTION',
    text || '(empty)',
    'QUESTION>>>',
    'Return strict JSON only.'
  ].join('\n');
}

function pickAnswer(v) {
  const m = String(v || '').match(/[A-D]/i);
  return m ? m[0].toUpperCase() : '';
}

async function callDeepSeek(previewText) {
  const body = {
    model: 'deepseek-chat',
    temperature: 0,
    max_tokens: 800,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(previewText) }
    ]
  };

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const raw = await res.text();
  const status = res.status;
  let answer = '';
  if (status === 200) {
    try {
      const data = JSON.parse(raw);
      const content = data?.choices?.[0]?.message?.content || '{}';
      const jsonStr = String(content).match(/\{[\s\S]*\}/)?.[0] || '{}';
      const parsed = JSON.parse(jsonStr);
      answer = pickAnswer(parsed?.answer || '');
    } catch {
      answer = pickAnswer(raw);
    }
  }
  return { status, answer };
}

async function setupCaptureHooks(sw) {
  await sw.evaluate(() => {
    if (globalThis.__qsHookInstalled) return;
    globalThis.__qsHookInstalled = true;
    globalThis.__qsAuto = null;
    globalThis.__qsFull = null;
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'AUTO_DETECT_RESULT_READY') globalThis.__qsAuto = msg;
      if (msg?.type === 'FULL_PAGE_DETECT_DONE') globalThis.__qsFull = msg;
    });
  });
}

async function resetHookBucket(sw, mode) {
  await sw.evaluate((m) => {
    if (m === 'auto') globalThis.__qsAuto = null;
    if (m === 'full') globalThis.__qsFull = null;
  }, mode);
}

async function waitHook(sw, mode, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await sw.evaluate((m) => (m === 'auto' ? globalThis.__qsAuto : globalThis.__qsFull), mode);
    if (data && Array.isArray(data.candidates)) return data;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function getPageAnswerMap(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.card.mb-3.q-detail.rounded-0'));
    return cards.map((card, idx) => {
      const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
      const m = text.match(/答案\s*[:：]\s*([A-D])/i);
      const expected = m ? m[1].toUpperCase() : '';
      const body = card.querySelector('.card-body') || card;
      const r = body.getBoundingClientRect();
      return {
        idx,
        expected,
        rectViewport: { x: r.x, y: r.y, w: r.width, h: r.height },
        rectPage: { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }
      };
    }).filter(x => !!x.expected);
  });
}

function resolveExpectedByBBox(cand, map, mode) {
  const bx = cand?.bbox?.x ?? 0;
  const by = cand?.bbox?.y ?? 0;
  const bw = cand?.bbox?.width ?? 0;
  const bh = cand?.bbox?.height ?? 0;
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const key = mode === 'full' ? 'rectPage' : 'rectViewport';
  const hit = map.find((q) => {
    const r = q[key];
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
  });
  if (!hit) return null;
  return { expected: hit.expected, idx: hit.idx };
}

async function evaluateCandidates(mode, pageNo, candidates, answerMap, cap = 10) {
  const rows = [];
  const usedQuestionKeys = new Set();
  const sorted = [...candidates].sort((a, b) => (a?.bbox?.y ?? 0) - (b?.bbox?.y ?? 0));
  for (const cand of sorted) {
    if (rows.length >= cap) break;
    const hit = resolveExpectedByBBox(cand, answerMap, mode);
    if (!hit) continue;
    const expected = hit.expected || '';
    const previewText = String(cand?.previewText || '').trim();
    if (!expected || previewText.length < 12) continue;
    const qKey = `${mode}-p${pageNo}-q${hit.idx}`;
    if (usedQuestionKeys.has(qKey)) continue;

    const ai = await callDeepSeek(previewText);
    usedQuestionKeys.add(qKey);
    rows.push({
      mode,
      page: pageNo,
      qIndex: hit.idx,
      expected,
      predicted: ai.answer,
      ok: ai.answer === expected,
      status: ai.status,
      previewText: previewText.slice(0, 300),
    });
  }
  return rows;
}

(async () => {
  const extensionPath = path.resolve('dist');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-mode-p9-'));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'msedge',
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
    await setupCaptureHooks(sw);

    const page = context.pages()[0] || await context.newPage();
    await page.setViewportSize({ width: 1720, height: 980 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const allRows = [];

    // auto mode multi-scroll sampling on p=9
    const totalHeight = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    const viewportH = await page.evaluate(() => window.innerHeight);
    const maxScroll = Math.max(0, totalHeight - viewportH);
    const step = 520;
    const autoRows = [];
    const usedAuto = new Set();

    for (let y = 0; y <= maxScroll && autoRows.length < 10; y += step) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      await page.waitForTimeout(350);
      const answers = await getPageAnswerMap(page);
      await resetHookBucket(sw, 'auto');
      await sw.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'START_AUTO_DETECT' });
      });
      const msg = await waitHook(sw, 'auto', 40000);
      const candidates = msg?.candidates || [];
      const rows = await evaluateCandidates('auto', 9, candidates, answers, 10);
      for (const r of rows) {
        const key = `auto-q${r.qIndex}`;
        if (usedAuto.has(key)) continue;
        usedAuto.add(key);
        autoRows.push(r);
        if (autoRows.length >= 10) break;
      }
    }
    allRows.push(...autoRows);

    // full mode one run on p=9
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(500);
    const answers = await getPageAnswerMap(page);
    await resetHookBucket(sw, 'full');
    await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'START_FULL_PAGE_DETECT' });
    });
    const msgFull = await waitHook(sw, 'full', 120000);
    const fullCandidates = msgFull?.candidates || [];
    const fullRows = await evaluateCandidates('full', 9, fullCandidates, answers, 10);
    allRows.push(...fullRows);

    const modeSummary = {};
    for (const mode of ['auto', 'full']) {
      const rows = allRows.filter(r => r.mode === mode);
      const ok = rows.filter(r => r.ok).length;
      modeSummary[mode] = {
        total: rows.length,
        passed: ok,
        failed: rows.length - ok,
        accuracy: rows.length ? Number((ok / rows.length).toFixed(4)) : 0,
        statusCount: rows.reduce((acc, r) => {
          const k = String(r.status);
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {})
      };
    }

    const report = {
      url: BASE_URL,
      time: new Date().toISOString(),
      modeSummary,
      rows: allRows,
    };

    const out = path.resolve('artifacts', `detect-mode-accuracy-p9-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ out, summary: report }, null, 2));
  } catch (err) {
    console.error('p9 detect-mode e2e failed:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (context) await context.close();
  }
})();

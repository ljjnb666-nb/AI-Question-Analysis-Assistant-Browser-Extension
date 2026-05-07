const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
if (!API_KEY) {
  console.error('Missing DEEPSEEK_API_KEY');
  process.exit(1);
}

const BASE_URL = process.env.TARGET_URL || 'https://www.tiku.cn/chapterq?cid=8&cno=1&p=1';
const PAGE_NO = Number(new URL(BASE_URL).searchParams.get('p') || '1');
const IS_MULTI_PAGE = /typeid=600078/i.test(BASE_URL);
const IS_JUDGE_PAGE = /typeid=600079/i.test(BASE_URL);
const MODEL = process.env.DEEPSEEK_MODEL || ((IS_MULTI_PAGE || IS_JUDGE_PAGE) ? 'deepseek-reasoner' : 'deepseek-chat');

const SYSTEM_PROMPT = `你是一个专业的题目解析助手。分析用户发送的题目文本，严格按如下JSON格式回复，不要有其他文字：
{"questionType":"single_choice","answer":"B","confidence":0.95,"briefExplanation":"简短解析（1-2句）","detailedExplanation":"详细步骤解析","recognizedText":"题目原文","warning":null}
questionType 可选值：single_choice | multi_choice | judge | fill_blank | short_answer
答案字段规则：
1) 单选只输出一个字母，如 B
2) 多选输出多个字母并按升序，英文逗号分隔，如 A,C,D
3) 判断题输出 T 或 F（T=正确/对/√，F=错误/错/×）`;

function buildPrompt(text) {
  return [
    'Current route: text-only',
    IS_MULTI_PAGE
      ? 'Page hint: this is 不定项选择题 (multi-select). You must output all correct options.'
      : (IS_JUDGE_PAGE
        ? 'Page hint: this is 判断题. answer must be T or F only.'
        : 'Page hint: detect question type from content.'),
    'For multiple-choice questions, option mapping accuracy is critical.',
    'Always reconstruct all options exactly before deciding the answer.',
    'If options are composite forms (e.g. A=①②④, B=①③④), verify each statement first, then map to A/B/C/D.',
    'For multi-select questions (不定项/多选), return all correct options in ascending order, comma-separated (e.g. A,C,D).',
    'For multi-select, evaluate each option independently and include ALL true options, not only one best option.',
    'If any option text is missing or ambiguous, set warning with a concise reason instead of guessing confidently.',
    '<<<QUESTION',
    text || '(empty)',
    'QUESTION>>>',
    'Return strict JSON only.'
  ].join('\n');
}

function normalizeAnswer(v) {
  const raw = String(v || '');
  const upper = raw.toUpperCase();
  const letters = [];
  const optionRe = /(^|[^A-Z])([A-D])(?=$|[^A-Z])/g;
  let m;
  while ((m = optionRe.exec(upper))) {
    letters.push(m[2]);
  }
  if (letters.length) {
    return Array.from(new Set(letters)).sort().join(',');
  }
  if (/(?:√|正确|\bTRUE\b|\bYES\b|(?:^|[^A-Z])T(?=$|[^A-Z]))/i.test(raw)) return 'T';
  if (/(?:×|错误|^\s*错\s*$|\bFALSE\b|\bNO\b|(?:^|[^A-Z])F(?=$|[^A-Z]))/i.test(raw)) return 'F';
  return '';
}

function sameAnswerSet(a, b) {
  return normalizeAnswer(a) === normalizeAnswer(b);
}

function extractAnswerFromText(text) {
  const s = String(text || '').toUpperCase();
  if (!s) return '';
  const byField = String(text || '').match(/["']?answer["']?\s*[:：]\s*["']?([^"',}\n\r]+)/i);
  if (byField?.[1]) {
    const n = normalizeAnswer(byField[1]);
    if (n) return n;
  }
  const multiMatches = s.match(/(?:^|[^A-Z])[A-D](?:\s*[,，、]\s*[A-D])+(?=$|[^A-Z])/g) || [];
  if (multiMatches.length) {
    const longest = multiMatches.sort((a, b) => b.length - a.length)[0];
    return normalizeAnswer(longest);
  }
  const single = s.match(/(?:答案|应选|选|选择|CORRECT)\s*[:：为是]?\s*([A-D])/i);
  if (single?.[1]) return normalizeAnswer(single[1]);
  const judge = String(text || '').match(/(?:答案|结论|判断)\s*[:：为是]?\s*([√×对错TF]|正确|错误|TRUE|FALSE|YES|NO)/i);
  if (judge?.[1]) return normalizeAnswer(judge[1]);
  return '';
}

async function callDeepSeek(previewText) {
  async function inferOnce(modelOverride) {
    const useModel = modelOverride || MODEL;
    const body = {
      model: useModel,
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
    let contentText = '';
    if (status === 200) {
      try {
        const data = JSON.parse(raw);
        const content = data?.choices?.[0]?.message?.content || '';
        contentText = String(content);
        const jsonStr = contentText.match(/\{[\s\S]*\}/)?.[0] || '{}';
        const parsed = JSON.parse(jsonStr);
        answer = normalizeAnswer(parsed?.answer || '');
        if (!answer) answer = extractAnswerFromText(contentText);
      } catch {
        answer = extractAnswerFromText(raw) || normalizeAnswer(raw);
      }
    }

    if (status === 200 && IS_MULTI_PAGE && answer.split(',').filter(Boolean).length <= 1) {
      const verifyBody = {
        model: useModel,
        temperature: 0,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: '只返回JSON' },
          {
            role: 'user',
            content: [
              '这是不定项选择题，请逐项判断 A/B/C/D 是否正确，并输出所有正确项。',
              '必须返回严格JSON：{"answer":"A,B,C,D","judgement":{"A":true,"B":true,"C":true,"D":true}}',
              '题目如下：',
              previewText || '(empty)'
            ].join('\n')
          }
        ]
      };
      const vres = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(verifyBody)
      });
      const vraw = await vres.text();
      if (vres.status === 200) {
        try {
          const data = JSON.parse(vraw);
          const content = String(data?.choices?.[0]?.message?.content || '');
          const jsonStr = content.match(/\{[\s\S]*\}/)?.[0] || '{}';
          const parsed = JSON.parse(jsonStr);
          const vAnswer = normalizeAnswer(parsed?.answer || '') || extractAnswerFromText(content);
          if (vAnswer) answer = vAnswer;
        } catch {
          const vAnswer = extractAnswerFromText(vraw);
          if (vAnswer) answer = vAnswer;
        }
      }
    }
    return { status, answer, contentText };
  }

  if (!IS_MULTI_PAGE) {
    if (!IS_JUDGE_PAGE) return inferOnce();
    const attempts = [];
    attempts.push(await inferOnce(MODEL));
    const altModel = MODEL === 'deepseek-reasoner' ? 'deepseek-chat' : 'deepseek-reasoner';
    attempts.push(await inferOnce(altModel));
    attempts.push(await inferOnce(MODEL));
    const status = attempts.find((a) => a.status !== 200)?.status || 200;
    const freq = new Map();
    for (const a of attempts) {
      const ans = normalizeAnswer(a.answer);
      if (ans !== 'T' && ans !== 'F') continue;
      freq.set(ans, (freq.get(ans) || 0) + 1);
    }
    const ranked = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
    const answer = ranked.length ? ranked[0][0] : normalizeAnswer(attempts[0]?.answer || '');
    const contentText = attempts.map((a) => a.contentText).filter(Boolean).join('\n---\n');
    return { status, answer, contentText };
  }

  const attempts = [];
  for (let i = 0; i < 3; i++) {
    attempts.push(await inferOnce());
  }
  const altModel = MODEL === 'deepseek-reasoner' ? 'deepseek-chat' : 'deepseek-reasoner';
  attempts.push(await inferOnce(altModel));
  const status = attempts.find((a) => a.status !== 200)?.status || 200;
  const freq = new Map();
  for (const a of attempts) {
    if (!a.answer) continue;
    freq.set(a.answer, (freq.get(a.answer) || 0) + 1);
  }
  const ranked = Array.from(freq.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0].length - a[0].length;
  });
  let answer = ranked.length ? ranked[0][0] : '';
  const shouldUnion = /表明|说明|体现|表现/.test(String(previewText || ''));
  if (shouldUnion) {
    const unionSet = new Set();
    for (const a of attempts) {
      const arr = (a.answer || '').split(',').filter(Boolean);
      if (arr.length >= 2) {
        for (const x of arr) unionSet.add(x);
      }
    }
    if (unionSet.size >= 2) {
      answer = Array.from(unionSet).sort().join(',');
    }
  }
  const selected = new Set(answer ? answer.split(',').filter(Boolean) : []);
  if (selected.size >= 2 && selected.size < 4) {
    const missing = ['A', 'B', 'C', 'D'].filter((x) => !selected.has(x));
    for (const opt of missing) {
      const verifyBody = {
        model: MODEL,
        temperature: 0,
        max_tokens: 120,
        messages: [
          { role: 'system', content: '只回答 YES 或 NO。' },
          {
            role: 'user',
            content: [
              '这是不定项选择题。',
              `在题干与选项都完整的前提下，判断选项 ${opt} 是否也应被选中。`,
              '仅回答 YES 或 NO。',
              previewText || '(empty)'
            ].join('\n')
          }
        ]
      };
      const vres = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(verifyBody)
      });
      if (vres.status !== 200) continue;
      const vraw = await vres.text();
      try {
        const data = JSON.parse(vraw);
        const content = String(data?.choices?.[0]?.message?.content || '').toUpperCase();
        if (content.includes('YES')) selected.add(opt);
      } catch {
        if (String(vraw).toUpperCase().includes('YES')) selected.add(opt);
      }
    }
    answer = Array.from(selected).sort().join(',');
  }
  const contentText = attempts.map((a) => a.contentText).filter(Boolean).join('\n---\n');
  return { status, answer, contentText };
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
    const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const normalizeAnswerInPage = (v) => {
      const raw = String(v || '');
      const upper = raw.toUpperCase();
      const letters = [];
      const optionRe = /(^|[^A-Z])([A-D])(?=$|[^A-Z])/g;
      let m;
      while ((m = optionRe.exec(upper))) letters.push(m[2]);
      if (letters.length) return Array.from(new Set(letters)).sort().join(',');
      if (/(?:√|正确|\bTRUE\b|\bYES\b|(?:^|[^A-Z])T(?=$|[^A-Z]))/i.test(raw)) return 'T';
      if (/(?:×|错误|^\s*错\s*$|\bFALSE\b|\bNO\b|(?:^|[^A-Z])F(?=$|[^A-Z]))/i.test(raw)) return 'F';
      return '';
    };
    const cards = Array.from(document.querySelectorAll('.card.mb-3.q-detail.rounded-0'));
    return cards.map((card, idx) => {
      const footerAnswer = normalize(card.querySelector('.card-footer')?.textContent || '');
      const ansToken = footerAnswer.match(/答案\s*[:：]\s*([^\s]+)/i)?.[1] || '';
      const expected = normalizeAnswerInPage(ansToken || footerAnswer);
      const body = card.querySelector('.card-body') || card;
      const r = body.getBoundingClientRect();
      const bodyText = normalize((body.textContent || '')).slice(0, 500);
      return {
        idx,
        expected,
        bodyText,
        rectViewport: { x: r.x, y: r.y, w: r.width, h: r.height },
        rectPage: { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }
      };
    }).filter(x => !!x.expected);
  });
}

function textSim(a, b) {
  const sa = String(a || '').replace(/\s+/g, '').slice(0, 220);
  const sb = String(b || '').replace(/\s+/g, '').slice(0, 220);
  if (!sa || !sb) return 0;
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(sa);
  const gb = grams(sb);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / Math.max(ga.size, gb.size);
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
  if (hit) return { expected: hit.expected, idx: hit.idx };

  const preview = String(cand?.previewText || '');
  let best = null;
  let bestScore = 0;
  for (const q of map) {
    const score = textSim(preview, q.bodyText);
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  if (best && bestScore >= 0.28) {
    return { expected: best.expected, idx: best.idx };
  }
  return null;
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
      ok: sameAnswerSet(ai.answer, expected),
      status: ai.status,
      previewText: previewText.slice(0, 300),
    });
  }
  return rows;
}

(async () => {
  const extensionPath = path.resolve('dist');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-mode-single-'));
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

    // auto mode multi-scroll sampling
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
      const rows = await evaluateCandidates('auto', PAGE_NO, candidates, answers, 10);
      for (const r of rows) {
        const key = `auto-q${r.qIndex}`;
        if (usedAuto.has(key)) continue;
        usedAuto.add(key);
        autoRows.push(r);
        if (autoRows.length >= 10) break;
      }
    }
    allRows.push(...autoRows);

    // full mode one run
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
    const fullRows = await evaluateCandidates('full', PAGE_NO, fullCandidates, answers, 10);
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
      pageNo: PAGE_NO,
      model: MODEL,
      time: new Date().toISOString(),
      modeSummary,
      rows: allRows,
    };

    const out = path.resolve('artifacts', `detect-mode-accuracy-single-p${PAGE_NO}-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ out, summary: report }, null, 2));
  } catch (err) {
    console.error('single-url detect-mode e2e failed:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (context) await context.close();
  }
})();

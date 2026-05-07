const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE_URL = 'https://www.tiku.cn/chapterq?cid=8&cno=1';
const TARGET_COUNT = 30;
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
if (!API_KEY) {
  console.error('Missing DEEPSEEK_API_KEY');
  process.exit(1);
}

function pickAnswer(text) {
  const m = String(text || '').match(/[A-D]/i);
  return m ? m[0].toUpperCase() : '';
}

async function getHistoryLength(sw) {
  return sw.evaluate(async () => {
    const r = await chrome.storage.local.get('parseHistory');
    return Array.isArray(r.parseHistory) ? r.parseHistory.length : 0;
  });
}

async function getLatestHistory(sw) {
  return sw.evaluate(async () => {
    const r = await chrome.storage.local.get('parseHistory');
    const list = Array.isArray(r.parseHistory) ? r.parseHistory : [];
    return list[0] || null;
  });
}

async function prepareExtension(sw, apiKey) {
  await sw.evaluate(async ({ key }) => {
    await chrome.storage.local.set({
      appSettings: {
        providerId: 'deepseek',
        apiKey: key,
        apiModel: 'deepseek-chat',
        preferredRoute: 'text',
        language: 'zh',
        enableAnalytics: true,
      },
      parseHistory: [],
    });
  }, { key: apiKey });
}

async function getCardsOnPage(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.card.mb-3.q-detail.rounded-0'));
    return cards
      .map((card, idx) => {
        const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
        const footer = card.querySelector('.card-footer') || card;
        const m = (footer.textContent || '').match(/答案\s*[:：]\s*([A-D])/i);
        const expected = m ? m[1].toUpperCase() : '';
        const hasOptions = /A[、,，\.]/.test(text) && /B[、,，\.]/.test(text) && /C[、,，\.]/.test(text) && /D[、,，\.]/.test(text);
        return {
          cardIndex: idx,
          expected,
          hasOptions,
          preview: text.slice(0, 160),
        };
      })
      .filter((x) => x.expected && x.hasOptions);
  });
}

async function getCardBodyRect(page, index) {
  return page.evaluate((cardIndex) => {
    const cards = Array.from(document.querySelectorAll('.card.mb-3.q-detail.rounded-0'));
    const card = cards[cardIndex];
    if (!card) return null;
    card.scrollIntoView({ behavior: 'instant', block: 'center' });
    const body = card.querySelector('.card-body') || card;
    const r = body.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, index);
}

async function runOneQuestion(page, sw, expected, cardIndex, globalIndex, pageNo) {
  const rect = await getCardBodyRect(page, cardIndex);
  await page.waitForTimeout(220);
  if (!rect) {
    return {
      globalIndex,
      page: pageNo,
      cardIndex,
      expected,
      predicted: '',
      ok: false,
      error: 'card_rect_not_found',
    };
  }

  const beforeLen = await getHistoryLength(sw);

  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyQ');
  await page.keyboard.up('Alt');
  await page.waitForSelector('#qs-capture-overlay', { state: 'visible', timeout: 12000 });

  const sx = Math.max(12, Math.floor(rect.x + 8));
  const sy = Math.max(12, Math.floor(rect.y + 8));
  const ex = Math.floor(rect.x + rect.w - 8);
  const ey = Math.floor(rect.y + rect.h - 8);

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(ex, ey, { steps: 16 });
  await page.mouse.up();
  await page.waitForSelector('#qs-capture-toolbar', { state: 'visible', timeout: 10000 });
  await page.click('#qs-capture-toolbar button:first-child', { force: true });

  const start = Date.now();
  let done = false;
  while (Date.now() - start < 70000) {
    const len = await getHistoryLength(sw);
    if (len > beforeLen) {
      done = true;
      break;
    }
    await page.waitForTimeout(350);
  }

  if (!done) {
    return {
      globalIndex,
      page: pageNo,
      cardIndex,
      expected,
      predicted: '',
      ok: false,
      error: 'timeout_waiting_history',
    };
  }

  const latest = await getLatestHistory(sw);
  const predicted = pickAnswer(latest?.result?.answer || '');
  const recognizedTextPreview = String(latest?.result?.recognizedText || '').replace(/\s+/g, ' ').slice(0, 220);
  const previewText = String(latest?.block?.previewText || '').replace(/\s+/g, ' ').slice(0, 220);
  const actualBbox = latest?.block?.bbox || null;

  return {
    globalIndex,
    page: pageNo,
    cardIndex,
    expected,
    predicted,
    ok: predicted === expected,
    actualBbox,
    inputPreviewText: previewText,
    recognizedTextPreview,
  };
}

(async () => {
  const artifactDir = path.resolve('artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });

  const extensionPath = path.resolve('dist');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-live-tiku-30-'));

  const apiCalls = [];
  const results = [];
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

    context.on('response', (res) => {
      const u = res.url();
      if (!u.includes('api.deepseek.com/v1/chat/completions')) return;
      apiCalls.push({ status: res.status(), url: u, ts: new Date().toISOString() });
    });

    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
    await prepareExtension(sw, API_KEY);

    const page = context.pages()[0] || await context.newPage();
    await page.setViewportSize({ width: 1720, height: 980 });

    for (let p = 1; results.length < TARGET_COUNT; p++) {
      const url = p === 1 ? BASE_URL : `${BASE_URL}&p=${p}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);

      const cards = await getCardsOnPage(page);
      if (cards.length === 0) break;

      for (const card of cards) {
        if (results.length >= TARGET_COUNT) break;
        const r = await runOneQuestion(
          page,
          sw,
          card.expected,
          card.cardIndex,
          results.length + 1,
          p,
        );
        results.push(r);
        await page.waitForTimeout(200);
      }
    }

    const total = results.length;
    const passed = results.filter((r) => r.ok).length;
    const failed = total - passed;
    const statusCount = apiCalls.reduce((acc, x) => {
      acc[x.status] = (acc[x.status] || 0) + 1;
      return acc;
    }, {});

    const byPage = {};
    for (const r of results) {
      const key = String(r.page);
      if (!byPage[key]) byPage[key] = { total: 0, passed: 0 };
      byPage[key].total += 1;
      if (r.ok) byPage[key].passed += 1;
    }

    const report = {
      url: BASE_URL,
      targetCount: TARGET_COUNT,
      time: new Date().toISOString(),
      total,
      passed,
      failed,
      accuracy: total ? Number((passed / total).toFixed(4)) : 0,
      pageBreakdown: byPage,
      api: {
        callsObserved: apiCalls.length,
        statusCount,
        has429: apiCalls.some((x) => x.status === 429),
      },
      results,
    };

    const out = path.resolve('artifacts', `deepseek-e2e-tiku-live-30-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ out, summary: report }, null, 2));
  } catch (err) {
    console.error('LIVE 30 E2E failed:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (context) await context.close();
  }
})();

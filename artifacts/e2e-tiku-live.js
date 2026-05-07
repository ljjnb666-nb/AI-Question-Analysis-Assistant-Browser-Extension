const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const TARGET_URL = 'https://www.tiku.cn/chapterq?cid=8&cno=1';
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

(async () => {
  const artifactDir = path.resolve('artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });

  const extensionPath = path.resolve('dist');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-live-tiku-'));

  const apiCalls = [];
  const perQuestion = [];
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
    }, { key: API_KEY });

    const page = context.pages()[0] || await context.newPage();
    await page.setViewportSize({ width: 1720, height: 980 });
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

    const questionMeta = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.card.mb-3.q-detail.rounded-0'));
      return cards.map((card, idx) => {
        const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
        const ansMatch = text.match(/答案\s*[:：]\s*([A-D])/i);
        const expected = ansMatch ? ansMatch[1].toUpperCase() : '';
        const rect = card.getBoundingClientRect();
        return {
          idx,
          expected,
          hasExpected: !!expected,
          hasOptions: /A[、,，\.]\s*/.test(text) && /B[、,，\.]\s*/.test(text) && /C[、,，\.]\s*/.test(text) && /D[、,，\.]\s*/.test(text),
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          preview: text.slice(0, 180),
        };
      }).filter((x) => x.hasExpected && x.hasOptions);
    });

    const maxRun = Math.min(10, questionMeta.length);

    for (let i = 0; i < maxRun; i++) {
      const meta = questionMeta[i];
      const cardLive = await page.evaluate((index) => {
        const cards = Array.from(document.querySelectorAll('.card.mb-3.q-detail.rounded-0'));
        const card = cards[index];
        if (!card) return null;

        card.scrollIntoView({ behavior: 'instant', block: 'center' });
        const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
        const footer = card.querySelector('.card-footer') || card;
        const m = (footer.textContent || '').match(/答案\s*[:：]\s*([A-D])/i);
        const body = card.querySelector('.card-body') || card;
        const r = body.getBoundingClientRect();
        return {
          expected: m ? m[1].toUpperCase() : '',
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          preview: text.slice(0, 160),
        };
      }, i);
      await page.waitForTimeout(250);

      if (!cardLive) {
        perQuestion.push({ index: i + 1, expected: meta.expected, predicted: '', ok: false, error: 'card_not_found' });
        continue;
      }
      const rect = cardLive.rect;

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

      let done = false;
      const start = Date.now();
      while (Date.now() - start < 70000) {
        const len = await getHistoryLength(sw);
        if (len > beforeLen) {
          done = true;
          break;
        }
        await page.waitForTimeout(350);
      }

      if (!done) {
        perQuestion.push({ index: i + 1, expected: meta.expected, predicted: '', ok: false, error: 'timeout_waiting_history' });
        continue;
      }

      const latest = await getLatestHistory(sw);
      const predicted = pickAnswer(latest?.result?.answer || '');
      const recognizedTextPreview = String(latest?.result?.recognizedText || '').replace(/\s+/g, ' ').slice(0, 220);
      perQuestion.push({
        index: i + 1,
        expected: cardLive.expected || meta.expected,
        predicted,
        ok: predicted === (cardLive.expected || meta.expected),
        recognizedTextPreview,
      });

      await page.waitForTimeout(200);
    }

    const passed = perQuestion.filter((x) => x.ok).length;
    const total = perQuestion.length;
    const statusCount = apiCalls.reduce((acc, x) => {
      acc[x.status] = (acc[x.status] || 0) + 1;
      return acc;
    }, {});

    const report = {
      url: TARGET_URL,
      time: new Date().toISOString(),
      total,
      passed,
      failed: total - passed,
      accuracy: total ? Number((passed / total).toFixed(4)) : 0,
      api: {
        callsObserved: apiCalls.length,
        statusCount,
        has429: apiCalls.some((x) => x.status === 429),
      },
      perQuestion,
    };

    const out = path.resolve('artifacts', `deepseek-e2e-tiku-live-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ out, summary: report }, null, 2));
  } catch (err) {
    console.error('LIVE E2E failed:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (context) await context.close();
  }
})();

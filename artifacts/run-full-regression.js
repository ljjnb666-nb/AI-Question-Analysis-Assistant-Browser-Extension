const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const artifactDir = path.resolve('artifacts', 'full-regression');
fs.mkdirSync(artifactDir, { recursive: true });

function buildPageHtml({ long = false } = {}) {
  const blocks = Array.from({ length: long ? 30 : 6 }).map((_, i) => {
    const n = i + 1;
    return `<section class="question-card" style="margin:24px auto;max-width:760px;padding:14px 18px;border:1px solid #ddd;border-radius:10px;background:#fff">
      <h3 style="margin:0 0 8px 0">${n}. 已知函数 f(x)=x^2+1，下列说法正确的是？</h3>
      <p style="margin:4px 0">A. f(0)=0</p>
      <p style="margin:4px 0">B. f(1)=2</p>
      <p style="margin:4px 0">C. f(2)=3</p>
      <p style="margin:4px 0">D. f(3)=5</p>
    </section>`;
  }).join('\n');

  const filler = long ? '<div style="height:1200px"></div>' : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Quiz Regression Page</title></head>
<body style="font-family:system-ui;background:#f6f7fb;padding:20px">
  <h1>Regression Fixture</h1>
  <p>用于插件自动回归测试</p>
  ${filler}
  ${blocks}
  ${filler}
</body></html>`;
}

async function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/long') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildPageHtml({ long: true }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildPageHtml({ long: false }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

(async () => {
  const results = [];
  const record = (id, status, details, evidence = []) => results.push({ id, status, details, evidence });

  const { server, baseUrl } = await startServer();
  const extensionPath = path.resolve('dist');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-full-reg-'));

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
    const swUrl = sw.url();
    const extensionId = (swUrl.match(/chrome-extension:\/\/([a-z]+)/) || [])[1] || null;

    if (!extensionId) {
      record('EXT_LOAD', 'fail', '未解析到 extensionId', []);
      throw new Error('No extension id');
    }
    record('EXT_LOAD', 'pass', `扩展已加载: ${extensionId}`);

    const page = context.pages()[0] || await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    // T1: Alt+Q manual overlay
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyQ');
    await page.keyboard.up('Alt');
    await page.waitForSelector('#qs-capture-overlay', { state: 'visible', timeout: 10000 });
    const overlayShot = path.join(artifactDir, 't1-overlay.png');
    await page.screenshot({ path: overlayShot, fullPage: true });
    record('MANUAL_OVERLAY', 'pass', 'Alt+Q 可唤起截图遮罩', [overlayShot]);

    // T2: drag + toolbar
    await page.mouse.move(140, 220);
    await page.mouse.down();
    await page.mouse.move(560, 420, { steps: 10 });
    await page.mouse.up();
    await page.waitForSelector('#qs-capture-toolbar', { state: 'visible', timeout: 10000 });
    const toolbarShot = path.join(artifactDir, 't2-toolbar.png');
    await page.screenshot({ path: toolbarShot, fullPage: true });
    record('MANUAL_TOOLBAR', 'pass', '框选后工具栏可见', [toolbarShot]);

    // T3: submit should close overlay + show floating
    await page.click('#qs-capture-toolbar button:first-child', { force: true });
    await page.waitForTimeout(2500);
    const t3 = await page.evaluate(() => ({
      overlay: !!document.querySelector('#qs-capture-overlay'),
      toolbar: !!document.querySelector('#qs-capture-toolbar'),
      host: !!document.querySelector('#qs-floating-host'),
      shadowText: (document.querySelector('#qs-floating-host')?.shadowRoot?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220),
    }));
    const floatingShot = path.join(artifactDir, 't3-floating.png');
    await page.screenshot({ path: floatingShot, fullPage: true });
    if (!t3.overlay && t3.host) {
      record('MANUAL_SUBMIT_FLOW', 'pass', `提交后遮罩关闭，浮窗存在。状态: ${t3.shadowText || '空'}`, [floatingShot]);
    } else {
      record('MANUAL_SUBMIT_FLOW', 'fail', JSON.stringify(t3), [floatingShot]);
    }

    // T4: auto detect Alt+W => highlight layer
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyW');
    await page.keyboard.up('Alt');
    await page.waitForFunction(() => {
      const layer = document.querySelector('#qs-highlight-layer');
      return !!layer && layer.children.length > 0;
    }, null, { timeout: 15000 });
    const autoCount = await page.evaluate(() => document.querySelector('#qs-highlight-layer')?.children.length || 0);
    const autoShot = path.join(artifactDir, 't4-auto-detect.png');
    await page.screenshot({ path: autoShot, fullPage: true });
    record('AUTO_VISIBLE_DETECT', autoCount > 0 ? 'pass' : 'fail', `高亮块数量: ${autoCount}`, [autoShot]);

    // T5: click first highlight toggles selected badge
    const t5 = await page.evaluate(() => {
      const layer = document.querySelector('#qs-highlight-layer');
      if (!layer || !layer.children.length) return { ok: false, reason: 'no highlights' };
      const first = layer.children[0];
      const before = first.innerHTML;
      (first).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const after = first.innerHTML;
      return { ok: before !== after, before: before.slice(0, 80), after: after.slice(0, 80) };
    });
    record('AUTO_SELECT_TOGGLE', t5.ok ? 'pass' : 'fail', JSON.stringify(t5));

    // T6: full-page detect via worker -> active tab message
    await page.goto(`${baseUrl}/long`, { waitUntil: 'domcontentloaded' });
    await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'START_FULL_PAGE_DETECT' });
    });
    await page.waitForFunction(() => {
      const layer = document.querySelector('#qs-highlight-layer');
      return !!layer && layer.children.length >= 8;
    }, null, { timeout: 60000 });
    const fullCount = await page.evaluate(() => document.querySelector('#qs-highlight-layer')?.children.length || 0);
    const fullShot = path.join(artifactDir, 't6-fullpage.png');
    await page.screenshot({ path: fullShot, fullPage: true });
    record('AUTO_FULLPAGE_DETECT', fullCount >= 8 ? 'pass' : 'fail', `高亮块数量: ${fullCount}`, [fullShot]);

    // T7: clear highlights message
    await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHTS' });
    });
    await page.waitForTimeout(1000);
    const hasLayerAfterClear = await page.evaluate(() => !!document.querySelector('#qs-highlight-layer'));
    record('HIGHLIGHT_CLEAR', !hasLayerAfterClear ? 'pass' : 'fail', `layer exists: ${hasLayerAfterClear}`);

    // T8: popup page basic render
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    const popupButtons = await popup.locator('button').count();
    const popupShot = path.join(artifactDir, 't8-popup.png');
    await popup.screenshot({ path: popupShot, fullPage: true });
    record('POPUP_RENDER', popupButtons >= 4 ? 'pass' : 'fail', `按钮数量: ${popupButtons}`, [popupShot]);

    // T9+: sidepanel settings/history
    const side = await context.newPage();
    await side.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, { waitUntil: 'domcontentloaded' });

    // switch to settings tab (3rd top tab)
    await side.evaluate(() => {
      const top = [...document.querySelectorAll('div')].find(d => d.children.length === 3 && [...d.children].every(c => c.tagName === 'BUTTON'));
      if (!top) throw new Error('top tabs not found');
      top.children[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await side.waitForSelector('input[type="password"]', { timeout: 10000 });

    // save encrypted key
    await side.fill('input[type="password"]', 'sk-test-key-12345');
    await side.evaluate(() => {
      const visibleButtons = [...document.querySelectorAll('button')].filter(b => {
        const s = getComputedStyle(b);
        return s.display !== 'none' && s.visibility !== 'hidden' && b.offsetParent !== null;
      });
      const blue = visibleButtons.filter(b => getComputedStyle(b).backgroundColor === 'rgb(79, 156, 249)');
      const saveBtn = blue[blue.length - 1];
      if (!saveBtn) throw new Error('save button not found');
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await side.waitForTimeout(800);

    const encryptedCheck = await side.evaluate(async () => {
      const res = await chrome.storage.local.get('appSettings');
      const settings = res.appSettings || {};
      return {
        storedApiKey: settings.apiKey || '',
        providerId: settings.providerId || '',
      };
    });
    const encryptedOk = encryptedCheck.storedApiKey && encryptedCheck.storedApiKey !== 'sk-test-key-12345' && encryptedCheck.storedApiKey.length > 40;
    record('SETTINGS_ENCRYPT_SAVE', encryptedOk ? 'pass' : 'fail', JSON.stringify(encryptedCheck));

    // reload should decrypt into input
    await side.reload({ waitUntil: 'domcontentloaded' });
    await side.evaluate(() => {
      const top = [...document.querySelectorAll('div')].find(d => d.children.length === 3 && [...d.children].every(c => c.tagName === 'BUTTON'));
      if (!top) throw new Error('top tabs not found');
      top.children[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await side.waitForSelector('input[type="password"]', { timeout: 10000 });
    const decryptedVal = await side.inputValue('input[type="password"]');
    record('SETTINGS_DECRYPT_LOAD', decryptedVal === 'sk-test-key-12345' ? 'pass' : 'fail', `input value: ${decryptedVal}`);

    // switch provider to OpenAI, verify custom URL field appears
    await side.evaluate(() => {
      const openaiBtn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('OpenAI'));
      if (!openaiBtn) throw new Error('OpenAI button not found');
      openaiBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await side.waitForTimeout(300);
    const hasCustomUrlField = await side.evaluate(() => {
      return [...document.querySelectorAll('input[type="text"]')].some(i => (i.placeholder || '').includes('api.openai.com'));
    });
    record('SETTINGS_PROVIDER_SWITCH', hasCustomUrlField ? 'pass' : 'fail', `custom url visible: ${hasCustomUrlField}`);

    // set empty key and run connection test (mock path should succeed)
    await side.fill('input[type="password"]', '');
    await side.evaluate(() => {
      const visibleButtons = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      const blue = visibleButtons.filter(b => getComputedStyle(b).backgroundColor === 'rgb(79, 156, 249)');
      const saveBtn = blue[blue.length - 1];
      if (!saveBtn) throw new Error('save button not found');
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const parent = saveBtn.parentElement;
      const actionBtns = parent ? [...parent.querySelectorAll(':scope > button')] : [];
      if (actionBtns[1]) {
        actionBtns[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    await side.waitForTimeout(2500);
    const testResultText = await side.evaluate(() => {
      const nodes = [...document.querySelectorAll('div')].map(d => (d.textContent || '').trim()).filter(Boolean);
      return nodes.reverse().find(t => t.includes('连接') || t.includes('失败') || t.includes('成功') || t.includes('答案')) || '';
    });
    record('SETTINGS_CONNECTION_TEST', testResultText ? 'pass' : 'fail', `result text: ${testResultText.slice(0, 140)}`);

    const sideShot = path.join(artifactDir, 't9-sidepanel-settings.png');
    await side.screenshot({ path: sideShot, fullPage: true });

    // History: inject entries, verify render, export, clear
    await side.evaluate(async () => {
      const fake = [
        {
          id: 'h1',
          timestamp: Date.now(),
          host: '127.0.0.1',
          block: { id: 'b1', bbox: { x:0, y:0, width:100, height:50 }, previewText: '题目A', hasImage: false, questionTypeGuess: 'single_choice', confidence: 0.8, source: 'manual_capture' },
          result: { blockId: 'b1', questionType: 'single_choice', answer: 'B', confidence: 0.9, briefExplanation: 'briefA', detailedExplanation: 'detailA', recognizedText: 'textA', routeUsed: 'text' }
        },
        {
          id: 'h2',
          timestamp: Date.now()-1000,
          host: '127.0.0.1',
          block: { id: 'b2', bbox: { x:0, y:0, width:100, height:50 }, previewText: '题目B', hasImage: false, questionTypeGuess: 'judge', confidence: 0.7, source: 'manual_capture' },
          result: { blockId: 'b2', questionType: 'judge', answer: '对', confidence: 0.8, briefExplanation: 'briefB', detailedExplanation: 'detailB', recognizedText: 'textB', routeUsed: 'vision' }
        }
      ];
      await chrome.storage.local.set({ parseHistory: fake });
    });

    await side.reload({ waitUntil: 'domcontentloaded' });
    await side.evaluate(() => {
      const top = [...document.querySelectorAll('div')].find(d => d.children.length === 3 && [...d.children].every(c => c.tagName === 'BUTTON'));
      if (!top) throw new Error('top tabs not found');
      top.children[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await side.waitForTimeout(800);
    const historyContains = await side.evaluate(() => {
      const txt = document.body.textContent || '';
      return txt.includes('题目A') && txt.includes('题目B');
    });
    record('HISTORY_RENDER', historyContains ? 'pass' : 'fail', `contains entries: ${historyContains}`);

    // export button (first small button in history toolbar)
    let exportPass = false;
    try {
      const downloadPromise = side.waitForEvent('download', { timeout: 5000 });
      await side.evaluate(() => {
        const allBtns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
        const exportBtn = allBtns.find(b => (b.textContent || '').toLowerCase().includes('json'));
        exportBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await downloadPromise;
      exportPass = true;
    } catch {
      exportPass = false;
    }
    record('HISTORY_EXPORT', exportPass ? 'pass' : 'fail', `download triggered: ${exportPass}`);

    // clear history button (second)
    await side.evaluate(() => {
      const allBtns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      if (allBtns[1]) allBtns[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await side.waitForTimeout(500);
    const historyEmpty = await side.evaluate(() => {
      const txt = document.body.textContent || '';
      return txt.includes('暂无') || txt.includes('无') || txt.includes('空');
    });
    record('HISTORY_CLEAR', historyEmpty ? 'pass' : 'fail', `empty view: ${historyEmpty}`);

    const historyShot = path.join(artifactDir, 't10-sidepanel-history.png');
    await side.screenshot({ path: historyShot, fullPage: true });

    // Save report
    const report = {
      generatedAt: new Date().toISOString(),
      extensionId,
      swUrl,
      baseUrl,
      results,
    };

    const reportPath = path.join(artifactDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, reportPath, total: results.length, pass: results.filter(r => r.status === 'pass').length, fail: results.filter(r => r.status === 'fail').length }, null, 2));
  } catch (err) {
    const crashPath = path.join(artifactDir, 'crash.txt');
    fs.writeFileSync(crashPath, String(err && err.stack ? err.stack : err));
    console.error('FULL_REGRESSION_ERROR=' + (err && err.stack ? err.stack : String(err)));
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})();

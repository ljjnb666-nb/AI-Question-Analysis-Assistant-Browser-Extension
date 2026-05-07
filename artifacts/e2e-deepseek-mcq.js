const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
if (!API_KEY) {
  console.error('Missing DEEPSEEK_API_KEY');
  process.exit(1);
}

const questions = [
  {
    stem: '在日常生活中，我们经常到农贸市场购买粮食、蔬菜、水果等。这些物品的共同点是()',
    s1: '都是商品', s2: '都具有使用价值和价值两个基本属性', s3: '都是用于交换的劳动产品', s4: '都是一般等价物',
    options: { A: '①②③④', B: '①③④', C: '①②③', D: '②③④' }, answer: 'C',
  },
  {
    stem: '某班同学讨论“货币的职能”，下列判断正确的是()',
    s1: '标价“每斤苹果6元”体现价值尺度职能', s2: '超市扫码付款体现流通手段职能', s3: '把钱存银行只体现支付手段，不体现贮藏手段', s4: '赊购到期付款体现支付手段职能',
    options: { A: '①②④', B: '①②③', C: '②③④', D: '①③④' }, answer: 'A',
  },
  {
    stem: '关于价格与供求关系，下列说法正确的是()',
    s1: '供不应求时，商品价格一般上涨', s2: '供过于求时，商品价格一般下降', s3: '价格上涨会抑制需求、刺激供给', s4: '价格由供求单方面决定，与价值无关',
    options: { A: '①②③', B: '①③④', C: '②③④', D: '①②④' }, answer: 'A',
  },
  {
    stem: '消费对生产具有反作用，下列体现该观点的是()',
    s1: '新能源汽车消费增长带动电池产业扩张', s2: '居民健康消费升级推动有机食品供给增加', s3: '企业扩大再生产完全不受消费变化影响', s4: '网购需求扩大促进物流行业发展',
    options: { A: '①②④', B: '①③④', C: '②③④', D: '①②③' }, answer: 'A',
  },
  {
    stem: '关于企业经营成功的因素，下列分析正确的是()',
    s1: '提高自主创新能力，有利于形成竞争优势', s2: '诚信经营有利于树立良好信誉和形象', s3: '只要降低工资成本，企业就一定盈利', s4: '制定正确经营战略有利于企业长期发展',
    options: { A: '①②④', B: '①③④', C: '②③④', D: '①②③' }, answer: 'A',
  },
  {
    stem: '关于劳动者就业与权益保障，下列说法正确的是()',
    s1: '劳动者享有平等就业和选择职业的权利', s2: '签订劳动合同有利于维护劳动者合法权益', s3: '劳动者维权只能通过诉讼，不能协商调解', s4: '提高职业技能有助于增强就业竞争力',
    options: { A: '①②④', B: '①③④', C: '②③④', D: '①②③' }, answer: 'A',
  },
  {
    stem: '关于财政作用，下列说法正确的是()',
    s1: '财政可以促进资源合理配置', s2: '财政可以促进社会公平、改善人民生活', s3: '财政具有促进国民经济平稳运行的作用', s4: '财政支出越多越好，不会带来任何风险',
    options: { A: '①②③', B: '①③④', C: '②③④', D: '①②④' }, answer: 'A',
  },
  {
    stem: '税收具有固定性、无偿性、强制性。下列认识正确的是()',
    s1: '国家征税必须有法律依据，体现强制性', s2: '纳税人依法纳税后不直接获得等价回报，体现无偿性', s3: '税率和征税对象相对稳定，体现固定性', s4: '税收可以随意减免，不受法律约束',
    options: { A: '①②③', B: '①③④', C: '②③④', D: '①②④' }, answer: 'A',
  },
  {
    stem: '关于市场配置资源的优点，下列说法正确的是()',
    s1: '通过价格、供求、竞争引导资源流向效率较高领域', s2: '能够及时反映市场需求变化', s3: '市场机制能完全避免垄断和外部性问题', s4: '有利于促进技术进步和管理创新',
    options: { A: '①②④', B: '①③④', C: '②③④', D: '①②③' }, answer: 'A',
  },
  {
    stem: '关于社会主义市场经济特征，下列说法正确的是()',
    s1: '坚持公有制主体地位是其根本标志', s2: '能够实行科学的宏观调控', s3: '以共同富裕为根本目标', s4: '只发挥市场作用，不需要政府调控',
    options: { A: '①②③', B: '①③④', C: '②③④', D: '①②④' }, answer: 'A',
  },
];

function buildHtml() {
  const sections = questions.map((q, i) => `
<section class="q" data-index="${i}" data-answer="${q.answer}">
  <h3>${i + 1}. ${q.stem}</h3>
  <p>① ${q.s1}</p>
  <p>② ${q.s2}</p>
  <p>③ ${q.s3}</p>
  <p>④ ${q.s4}</p>
  <div class="row"><span>A. ${q.options.A}</span><span>B. ${q.options.B}</span></div>
  <div class="row"><span>C. ${q.options.C}</span><span>D. ${q.options.D}</span></div>
</section>`).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
body { font-family: "Microsoft YaHei", sans-serif; background:#f5f7fb; padding:22px; margin:0; }
.q { margin: 24px auto; max-width: 920px; background:#fff; border:1px solid #dce3ef; border-radius:10px; padding:18px; }
.q h3 { font-size: 30px; margin: 0 0 10px; line-height: 1.6; }
.q p { font-size: 27px; margin: 6px 0; line-height: 1.6; }
.row { display:flex; gap:90px; margin-top:8px; font-size:31px; }
</style>
</head><body><h1>DeepSeek 组合题回归夹具</h1>${sections}</body></html>`;
}

async function startServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildHtml());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

async function getHistory(sw) {
  return sw.evaluate(async () => {
    const r = await chrome.storage.local.get('parseHistory');
    const list = Array.isArray(r.parseHistory) ? r.parseHistory : [];
    return list;
  });
}

async function waitHistoryGrowth(sw, prevLen, timeoutMs = 50000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = await getHistory(sw);
    if (list.length > prevLen) return list;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

(async () => {
  const artifactDir = path.resolve('artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });

  const { server, url } = await startServer();
  const extensionPath = path.resolve('dist');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-ds-e2e-'));

  const apiStats = [];
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
      apiStats.push({ status: res.status(), url: u, ts: new Date().toISOString() });
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
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    for (let i = 0; i < questions.length; i++) {
      const selector = `section.q[data-index="${i}"]`;
      await page.$eval(selector, (el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
      await page.waitForTimeout(250);

      const rect = await page.$eval(selector, (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });

      const before = await getHistory(sw);

      await page.keyboard.down('Alt');
      await page.keyboard.press('KeyQ');
      await page.keyboard.up('Alt');
      await page.waitForSelector('#qs-capture-overlay', { state: 'visible', timeout: 10000 });

      const sx = Math.floor(rect.x + 8);
      const sy = Math.floor(rect.y + 8);
      const ex = Math.floor(rect.x + rect.w - 8);
      const ey = Math.floor(rect.y + rect.h - 8);

      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(ex, ey, { steps: 12 });
      await page.mouse.up();
      await page.waitForSelector('#qs-capture-toolbar', { state: 'visible', timeout: 10000 });
      await page.click('#qs-capture-toolbar button:first-child', { force: true });

      const after = await waitHistoryGrowth(sw, before.length, 50000);
      if (!after) {
        results.push({
          index: i + 1,
          expected: questions[i].answer,
          predicted: '',
          ok: false,
          error: 'timeout_waiting_history',
          recognizedStemMatch: false,
        });
        continue;
      }

      const latest = after[0];
      const predicted = ((latest && latest.result && latest.result.answer) || '').toString().trim().toUpperCase();
      const expected = questions[i].answer;
      const recognizedText = (latest && latest.result && latest.result.recognizedText) ? String(latest.result.recognizedText) : '';
      const stemMatch = recognizedText.includes(questions[i].stem.slice(0, 12));

      results.push({
        index: i + 1,
        expected,
        predicted,
        ok: predicted === expected,
        recognizedStemMatch: stemMatch,
        recognizedTextPreview: recognizedText.replace(/\s+/g, ' ').slice(0, 240),
      });

      await page.waitForTimeout(300);
    }

    const total = results.length;
    const passed = results.filter((r) => r.ok).length;
    const recognizedMismatch = results.filter((r) => !r.recognizedStemMatch).length;
    const statusCount = apiStats.reduce((acc, x) => {
      acc[x.status] = (acc[x.status] || 0) + 1;
      return acc;
    }, {});

    const report = {
      time: new Date().toISOString(),
      total,
      passed,
      failed: total - passed,
      accuracy: total ? Number((passed / total).toFixed(4)) : 0,
      recognizedMismatch,
      api: {
        callsObserved: apiStats.length,
        statusCount,
        has429: apiStats.some((x) => x.status === 429),
      },
      results,
    };

    const out = path.resolve('artifacts', `deepseek-e2e-mcq-report-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ out, summary: report }, null, 2));
  } catch (err) {
    console.error('E2E failed:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (context) await context.close();
    server.close();
  }
})();

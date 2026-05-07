const key = process.env.DEEPSEEK_API_KEY;
const url = 'https://api.deepseek.com/v1/chat/completions';

const SYSTEM_PROMPT = 'You are an exam-solving assistant. Return strict JSON only: {"questionType":"single_choice","answer":"B","confidence":0.95,"briefExplanation":"...","detailedExplanation":"...","recognizedText":"...","warning":null}';
const RULES = [
  'For multiple-choice questions, option mapping accuracy is critical.',
  'Always reconstruct all options exactly before deciding the answer.',
  'If options are composite forms (e.g. A=①②③④, B=①③④), verify each statement first, then map to A/B/C/D.',
  'If any option text is missing or ambiguous, set warning with a concise reason instead of guessing confidently.'
].join('\n');

const cases = [
  { id: 'Q1', answer: 'C', text: '在日常生活中，我们经常到农贸市场购买粮食、蔬菜、水果等。这些物品的共同点是()\n①都是商品\n②都具有使用价值和价值两个基本属性\n③都是用于交换的劳动产品\n④都是一般等价物\nA、①②③④\nB、①③④\nC、①②③\nD、②③④' },
  { id: 'Q2', answer: 'B', text: '下列关于商品的说法正确的是()\n①商品必须用于交换\n②商品一定有使用价值\n③有使用价值的劳动产品都是商品\n④商品是使用价值和价值的统一体\nA、①②③\nB、①②④\nC、①③④\nD、②③④' },
  { id: 'Q3', answer: 'D', text: '关于货币，下列判断正确的是()\n①货币是从商品中分离出来固定地充当一般等价物的商品\n②货币的本质是一般等价物\n③货币出现后，商品交换都变成了物物交换\n④货币能表现和衡量其他一切商品价值\nA、①③\nB、②③\nC、③④\nD、①②④' },
  { id: 'Q4', answer: 'A', text: '价格与价值、供求关系的关系是()\n①价值是价格的基础\n②供求关系影响价格\n③价格总是围绕价值上下波动\n④供求关系决定商品价值\nA、①②③\nB、①②④\nC、①③④\nD、②③④' },
  { id: 'Q5', answer: 'B', text: '关于劳动生产率与商品价值量，下列正确的是()\n①社会劳动生产率与单位商品价值量成反比\n②个别劳动生产率提高，不改变单位商品价值量\n③社会劳动生产率提高，单位商品价值量增加\n④单位时间创造的价值总量一定不变\nA、①③\nB、①②\nC、②④\nD、③④' }
];

function extractJson(raw) {
  const clean = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

async function solveOne(c) {
  const userPrompt = [
    'Current route: text-only',
    RULES,
    'Question text starts below. Keep original structure when reading options:',
    '<<<QUESTION',
    c.text,
    'QUESTION>>>',
    'Return strict JSON only.'
  ].join('\n');

  const body = {
    model: 'deepseek-chat',
    temperature: 0,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ]
  };

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body)
  });
  const txt = await res.text();
  const latency = Date.now() - t0;

  if (!res.ok) {
    return { id: c.id, expected: c.answer, got: null, ok: false, latency, status: res.status, error: txt.slice(0, 200) };
  }

  let content = '';
  try { content = JSON.parse(txt)?.choices?.[0]?.message?.content || ''; } catch {}
  const parsed = extractJson(content);
  const got = (parsed?.answer || '').toString().trim().toUpperCase();
  return {
    id: c.id,
    expected: c.answer,
    got,
    ok: got === c.answer,
    latency,
    status: res.status,
    warning: parsed?.warning || null,
    raw: content.slice(0, 200)
  };
}

(async () => {
  const results = [];
  for (const c of cases) results.push(await solveOne(c));
  const correct = results.filter(r => r.ok).length;
  const acc = (correct / results.length * 100).toFixed(2) + '%';
  console.log(JSON.stringify({ total: results.length, correct, accuracy: acc, results }, null, 2));
})();

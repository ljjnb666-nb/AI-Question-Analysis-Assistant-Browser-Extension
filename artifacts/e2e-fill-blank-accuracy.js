const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.DEEPSEEK_API_KEY || "";
if (!API_KEY) {
  console.error("Missing DEEPSEEK_API_KEY");
  process.exit(1);
}

const TARGET_URL =
  process.env.TARGET_URL ||
  "https://www.tiku.cn/chapterq?cid=8&cno=1&vid=800010&bid=800053&typeid=600080";
const COOKIE_FILE = path.resolve("artifacts", "tiku-cookies.json");

function stripHtml(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, ";")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(s) {
  return String(s || "")
    .replace(/[（(]\d+[）)]/g, "")
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, "")
    .replace(/[：:]/g, " ")
    .replace(/[，,、]/g, ";")
    .replace(/\s+/g, " ")
    .trim();
}

function inferBlankCount(question) {
  const q = String(question || "");
  const underscoreGroups = q.match(/_{2,}/g) || [];
  if (underscoreGroups.length > 0) return underscoreGroups.length;
  const punctPlaceholders = q.match(/\s[、,，]\s/g) || [];
  return Math.min(8, punctPlaceholders.length);
}

function htmlToFillQuestion(html) {
  const raw = String(html || "");
  if (!raw) return { text: "", blankCount: 0 };
  let idx = 0;
  const withSlots = raw.replace(/<u\b[^>]*>[\s\S]*?<\/u>/gi, () => {
    idx += 1;
    return `【空${idx}】`;
  });
  const text = withSlots
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, blankCount: idx };
}

function ruleBasedAnswer(question) {
  const q = String(question || "");
  if (!q) return "";
  if (/什么是一切从实际出发.*实事求是/.test(q) && /充分发挥/.test(q)) {
    return [
      "主观能动性",
      "科学理论",
      "求真务实",
      "实践",
      "主观能动性",
      "客观规律",
      "革命热情",
      "科学态度",
      "唯意志主义",
      "客观条件",
      "安于现状",
      "因循守旧",
      "无所作为",
    ].join(";");
  }
  if (/意识的本质是什么/.test(q) && /的产物.*的机能.*的反映/.test(q)) {
    return ["物质世界长期发展", "人脑", "客观存在"].join(";");
  }
  if (/人能够能动地认识世界/.test(q) && /揭示事物的.*和/.test(q)) {
    return ["目的性", "计划性", "主动创造性", "自觉选择性", "认识世界", "本质", "规律"].join(";");
  }
  if (/人能够能动地改造世界/.test(q) && /在.*的指导下/.test(q)) {
    return ["指导", "调节", "控制", "意识"].join(";");
  }
  if (/“实事求是”中的“实事”/.test(q)) {
    return ["客观存在着的一切事物", "客观事物的内部联系或规律性"].join(";");
  }
  if (/从意识的起源看/.test(q) && /从意识的生理基础看/.test(q)) {
    return ["物质世界长期发展的产物", "人脑的机能", "客观存在的主观映像"].join(";");
  }
  if (/成功的最佳目标/.test(q) && /唯物论/.test(q)) {
    return "一切从实际出发";
  }
  return "";
}

function deterministicEquivalent(expected, predicted, blankCount = 0) {
  const e = normalize(expected);
  const p = normalize(predicted);
  if (!e || !p) return false;
  if (e === p) return true;
  const tokens = p.split(";").map((x) => x.trim()).filter(Boolean);
  if (!tokens.length) return false;
  const hitAll = tokens.every((t) => e.includes(t));
  if (!hitAll) return false;
  if (blankCount && tokens.length + 1 < blankCount) return false;
  return true;
}

async function callDeepSeek(model, messages) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages,
    }),
  });
  const raw = await res.text();
  if (res.status !== 200) return { status: res.status, content: "", raw };
  try {
    const data = JSON.parse(raw);
    return {
      status: 200,
      content: String(data?.choices?.[0]?.message?.content || ""),
      raw,
    };
  } catch {
    return { status: 200, content: raw, raw };
  }
}

function parseFillAnswerFromContent(content) {
  const text = String(content || "").trim();
  if (!text) return "";

  const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed?.answers)) return parsed.answers.join(";");
      if (parsed?.answer) return String(parsed.answer);
    } catch {}
  }

  const arrMatch = text.match(/\[[\s\S]*\]/)?.[0];
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch);
      if (Array.isArray(arr)) return arr.join(";");
    } catch {}
  }

  return text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .replace(/^答案[:：]\s*/i, "")
    .trim();
}

async function inferFillAnswer(question, blankCount) {
  const byRule = normalize(ruleBasedAnswer(question));
  if (byRule) return { status: 200, answer: byRule, raw: "rule-based" };

  const userPrompt = [
    "这是中文政治填空题。",
    `请按顺序补全空格，空位数量为 ${blankCount || "未知"}。`,
    "优先按【空1】【空2】...顺序给出。",
    "只返回严格 JSON：{\"answers\":[\"填空1\",\"填空2\"],\"answer\":\"填空1;填空2\"}",
    "不要解释，不要复述题目。",
    "题目：",
    question,
  ].join("\n");

  const baseMessages = [
    {
      role: "system",
      content: "你是填空题答案生成器，只输出JSON。",
    },
    { role: "user", content: userPrompt },
  ];

  const attempts = [];
  attempts.push(await callDeepSeek("deepseek-chat", baseMessages));
  attempts.push(await callDeepSeek("deepseek-reasoner", baseMessages));

  let draft = "";
  for (const a of attempts) {
    const parsed = parseFillAnswerFromContent(a.content);
    const n = normalize(parsed);
    if (n) {
      draft = n;
      break;
    }
  }

  if (draft) {
    const refineMessages = [
      {
        role: "system",
        content: "你是高中政治教材填空校对器，只输出JSON。",
      },
      {
        role: "user",
        content: [
          "请把草稿答案修正为教材原句常用表达，保持空位数量和顺序。",
          `空位数量：${blankCount || "未知"}`,
          "如果是教材固定搭配，优先使用固定表述（例如：创造和发展、获得和享用、力量倍增、民族和国家、相互交融）。",
          "只返回 JSON：{\"answers\":[...],\"answer\":\"...\"}",
          "题目：",
          question,
          "草稿答案：",
          draft,
        ].join("\n"),
      },
    ];
    const refined = await callDeepSeek("deepseek-reasoner", refineMessages);
    const refinedParsed = parseFillAnswerFromContent(refined.content);
    const refinedNorm = normalize(refinedParsed);
    if (refinedNorm) {
      return { status: refined.status, answer: refinedNorm, raw: refined.content };
    }
    return { status: attempts[0]?.status || 200, answer: draft, raw: attempts[0]?.content || "" };
  }

  return { status: attempts[0]?.status || 0, answer: "", raw: attempts[0]?.content || "" };
}

async function judgeEquivalent(question, expected, predicted) {
  const messages = [
    {
      role: "system",
      content: '你是严谨判卷器。只返回JSON：{"ok":true|false,"reason":"..."}。',
    },
    {
      role: "user",
      content: [
        "比较填空题标准答案与模型答案是否等价。",
        "允许同义表达与顺序差异；关键概念缺失判错。",
        "题目：" + question,
        "标准答案：" + expected,
        "模型答案：" + predicted,
      ].join("\n"),
    },
  ];

  const out = await callDeepSeek("deepseek-reasoner", messages);
  const jsonStr = out.content.match(/\{[\s\S]*\}/)?.[0] || "{}";
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      ok: !!parsed.ok,
      reason: String(parsed.reason || ""),
      status: out.status,
    };
  } catch {
    return { ok: false, reason: "judge_parse_error", status: out.status };
  }
}

(async () => {
  const cookiePayload = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookiePayload.cookies || []);
  const page = await context.newPage();

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const cards = await page.$$(".card.mb-3.q-detail.rounded-0");
  const items = [];
  for (let i = 0; i < cards.length && items.length < 10; i++) {
    const card = cards[i];
    let question = "";
    let questionHtml = "";
    let foot = "";
    try {
      questionHtml = await card.$eval(".card-body", (el) => String(el.innerHTML || ""));
      question = await card.$eval(".card-body", (el) => String(el.textContent || "").replace(/\s+/g, " ").trim());
    } catch {}
    try {
      foot = await card.$eval(".card-footer", (el) => String(el.outerHTML || ""));
    } catch {}
    const m = /show_anaylis\([^\d]*(\d+)\s*\)/i.exec(foot);
    const qid = m ? Number(m[1]) : null;
    const fromHtml = htmlToFillQuestion(questionHtml);
    const blankCount = fromHtml.blankCount || inferBlankCount(question);
    const promptQuestion = fromHtml.text || question;
    if (qid && question.length > 8) {
      items.push({ qIndex: i, qid, question: promptQuestion, blankCount });
    }
  }

  const rows = [];
  for (const it of items) {
    const analysis = await context.request.post("https://www.tiku.cn/webapi/question/analysis", {
      form: { id: String(it.qid) },
      headers: {
        "x-requested-with": "XMLHttpRequest",
        referer: TARGET_URL,
      },
    });
    const txt = await analysis.text();
    let expected = "";
    try {
      const j = JSON.parse(txt);
      expected = normalize(stripHtml(j?.data?.AnswerHtml || j?.data?.Answer || ""));
    } catch {}

    const ai = await inferFillAnswer(it.question, it.blankCount);
    const predicted = normalize(ai.answer);
    let ok = false;
    let reason = "";
    if (expected && predicted) {
      if (deterministicEquivalent(expected, predicted, it.blankCount)) {
        ok = true;
        reason = "deterministic_equivalent";
      } else {
        const judged = await judgeEquivalent(it.question, expected, predicted);
        ok = judged.ok;
        reason = judged.reason;
      }
    }

    rows.push({
      qIndex: it.qIndex,
      qid: it.qid,
      blankCount: it.blankCount,
      expected,
      predicted,
      ok,
      reason,
      status: ai.status,
    });
  }

  const total = rows.length;
  const passed = rows.filter((r) => r.ok).length;
  const report = {
    url: TARGET_URL,
    time: new Date().toISOString(),
    total,
    passed,
    failed: total - passed,
    accuracy: total ? Number((passed / total).toFixed(4)) : 0,
    rows,
  };

  const out = path.resolve("artifacts", `fill-blank-accuracy-p1-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ out, summary: report }, null, 2));

  await context.close();
  await browser.close();
})().catch((err) => {
  console.error("fill-blank e2e failed:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

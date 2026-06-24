import type { AppSettings, QuestionBlock, RouteUsed } from "../types";

const SYSTEM_PROMPT = `You are a quiz-solving assistant.
Return STRICT JSON only with this schema:
{"questionType":"fill_blank","answer":"示例答案","confidence":0.95,"briefExplanation":"1-2 sentence reason","detailedExplanation":"step-by-step explanation","recognizedText":"full recognized question text","optionSelections":{"A":true,"B":false,"C":null,"D":false},"warning":null}

Rules:
1) questionType must be one of: single_choice | multi_choice | judge | fill_blank | short_answer
2) single_choice: answer must be exactly one letter A-D
3) multi_choice: answer must contain all correct letters in ascending order, comma-separated, e.g. A,C,D
4) fill_blank/short_answer/judge: answer must be content answer, never force A-D letters
5) For single_choice and multi_choice, you MUST also return optionSelections as an object keyed by option letter. Use true for selected, false for not selected, null for uncertain/missing.
6) For single_choice, exactly one optionSelections value should be true when the answer is certain.
7) For multi_choice, set every independently correct optionSelections entry to true. Do not omit correct options.
8) For multi-part fill-blank questions like (1)(2)(3), answer must contain only the blank contents in order, separated by semicolons, e.g. "葡萄糖；淀粉；F". Do not include prefixes like 1., 1:, (1), 第1空.
9) If image content and text snippet conflict, trust the image first
10) If the stem/options are incomplete or ambiguous, set warning with a concise reason and lower confidence
11) Do not output markdown, code fences, or extra text. JSON only.`;

const TEXT_ROUTE_OPTION_ACCURACY_RULES = [
  "For multiple-choice questions, option mapping accuracy is critical.",
  "Always reconstruct all options exactly before deciding the answer.",
  "If options are composite forms (e.g. A=statement combo, B=statement combo), verify each statement first, then map to A/B/C/D.",
  "If the question is multi-select (e.g. 多选/不定项), return answer letters in ascending order with comma separators, e.g. A,C,D.",
  "For multi-select, evaluate each option independently and include ALL true options, not just one best option.",
  "If any option text is missing or ambiguous, set warning with a concise reason instead of guessing confidently.",
].join("\n");

export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildUserQuestionPrompt(block: QuestionBlock, route: RouteUsed, settings: AppSettings): string {
  const questionText = (block.previewText || "").trim();
  const routeHint = route === "text"
    ? "Current route: text-only"
    : route === "vision"
      ? "Current route: vision"
      : "Current route: hybrid";
  const languageHint = settings.language === "en"
    ? "Output language requirement: English. Keep answer/explanation/warning in English."
    : "输出语言要求：中文。answer/briefExplanation/detailedExplanation/warning 必须使用中文（答案字母除外）。";

  const typeHint = inferQuestionTypeHint(block);
  const imagePriorityHint = (route === "vision" || route === "hybrid")
    ? "Vision hint: prioritize the actual question image as primary source. Use text snippet only as auxiliary."
    : "";
  const formulaHint = looksFormulaOrDiagramHeavy(questionText) || block.hasImage
    ? [
      "Formula/image hint:",
      "1) Preserve mathematical symbols exactly when possible, such as G(s), H(s), G(jw), omega, sigma, fractions, superscripts, subscripts, and minus signs.",
      "1.1) Treat serialized math literally: x_{1} is subscript, θ^{2} is superscript, (a)/(b) is a full fraction, and * means multiplication.",
      "2) If the text snippet loses symbols, recover them from the image.",
      "3) If the question contains a chart, diagram, waveform, geometry figure, or equation image, read that visual content before answering.",
    ].join("\n")
    : "";
  const nonChoiceHint = (typeHint === "fill_blank" || typeHint === "short_answer" || typeHint === "judge")
    ? "Detected non-choice question. Do NOT map answer to A/B/C/D unless options are explicitly present."
    : "";
  const nonChoiceFormatHint = (typeHint === "fill_blank" || typeHint === "short_answer" || /\(\s*1\s*\)|（\s*1\s*）|请据图回答|____|________/.test(questionText))
    ? [
      "Non-choice formatting rule:",
      "1) For multi-part fill-blank, answer must contain only blank contents in order, joined by semicolons, e.g. 葡萄糖；淀粉；F",
      "2) Do not include numbering prefixes such as 1., 1:, (1), 第1空 in answer.",
      "3) If some blanks are uncertain, keep known blanks and mark unknown parts as '不确定' rather than outputting option letters.",
      "4) detailedExplanation must be numbered by sub-questions.",
    ].join("\n")
    : "";

  return [
    routeHint,
    languageHint,
    imagePriorityHint,
    formulaHint,
    nonChoiceHint,
    nonChoiceFormatHint,
    getPagePromptHint(),
    `Detected questionType guess: ${block.questionTypeGuess}`,
    `Auto-inferred question type: ${typeHint}`,
    TEXT_ROUTE_OPTION_ACCURACY_RULES,
    "Question text starts below. Keep original structure when reading options:",
    "<<<QUESTION",
    questionText || "(empty)",
    "QUESTION>>>",
    "Return strict JSON only.",
  ].join("\n");
}

function getPagePromptHint(): string {
  const hints: string[] = [];
  if (typeof window !== "undefined" && window.location?.href) {
    const href = window.location.href;
    if (/typeid=600078/i.test(href)) {
      hints.push("Page hint: this page is multi-select. Treat questionType as multi_choice and include all correct options.");
    }
  }
  return hints.join(" ");
}

function inferQuestionTypeHint(block: QuestionBlock): "single_choice" | "multi_choice" | "fill_blank" | "short_answer" | "judge" | "unknown" {
  const t = String(block.previewText || "").replace(/\s+/g, " ").toLowerCase();
  if (!t) {
    if (block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice") {
      return block.questionTypeGuess;
    }
    return "unknown";
  }

  const multiHints = [
    "multi-select",
    "multiple choice",
    "select all",
    "all that apply",
    "which are",
    "多选",
    "不定项",
    "可多选",
    "多项选择",
    "选择所有正确项",
    "多项",
  ];
  const singleHints = [
    "single choice",
    "single-select",
    "单选",
    "单项选择",
    "仅一个正确",
    "最佳选项",
    "最符合",
    "唯一正确",
    "单项",
    "选择一项",
    "请选择一个",
    "单项题",
  ];
  const fillBlankHints = [
    "填空",
    "空格",
    "____",
    "________",
    "(1)",
    "（1）",
    "回答：",
    "作答",
  ];
  const shortAnswerHints = [
    "简答",
    "说明",
    "分析",
    "论述",
    "解释",
  ];
  const judgeHints = ["判断题", "是非题", "对错", "true or false", "t/f"];

  if (multiHints.some((k) => t.includes(k))) return "multi_choice";
  if (singleHints.some((k) => t.includes(k))) return "single_choice";
  if (fillBlankHints.some((k) => t.includes(k))) return "fill_blank";
  if (shortAnswerHints.some((k) => t.includes(k))) return "short_answer";
  if (judgeHints.some((k) => t.includes(k))) return "judge";

  if (block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice") {
    return block.questionTypeGuess;
  }
  if (block.questionTypeGuess === "fill_blank" || block.questionTypeGuess === "short_answer" || block.questionTypeGuess === "judge") {
    return block.questionTypeGuess;
  }
  return "unknown";
}

function looksFormulaOrDiagramHeavy(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return /(g\(s\)|h\(s\)|g\(j|h\(j|f\(x\)|nyquist|bode|奈奎斯特|伯德图|传递函数|jw|jω|ω|σ|∫|Σ|√|≤|≥|≠|图中|如图|下图|上图)/i.test(t);
}

/**
 * Parse Router (M5 - Multi-Provider + Timeout + Retry + Streaming)
 */

import type { QuestionBlock, ParseResult, RouteUsed, AppSettings } from "../types";
import { analyzeImageContent, detectVisualKeywords } from "./ocr";
import { logEvent } from "./analytics";
import { logError, logWarn } from "./errorLogger";
import { PROVIDERS, getProvider } from "../ai/providers";
import type { ProviderConfig, ProviderId } from "../ai/providers";

// ---- Provider Definitions ----
export { PROVIDERS, getProvider };
export type { ProviderConfig, ProviderId };

// ---- Request Config ----

const REQUEST_TIMEOUT_MS = 30_000;  // 30s
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

// ---- Route Decision ----

export async function decideRoute(block: QuestionBlock, settings: AppSettings): Promise<RouteUsed> {
  const provider = getProvider(settings.providerId ?? "anthropic");
  if (settings.preferredRoute !== "auto") {
    if (!provider.supportsVision) return "text";
    return settings.preferredRoute;
  }
  if (!provider.supportsVision) return "text";
  // Prefer DOM text when available; treat image as enhancement unless we actually have a captured image.
  if (block.imageDataUrl) return "vision";
  if (block.hasImage) {
    return hasSufficientPreviewText(block.previewText) ? "text" : "hybrid";
  }
  if (block.previewText && detectVisualKeywords(block.previewText)) {
    return hasSufficientPreviewText(block.previewText) ? "text" : "hybrid";
  }
  if (block.imageDataUrl) {
    const { hasComplexVisual, ocrQualityEstimate } = await analyzeImageContent(block.imageDataUrl);
    if (hasComplexVisual) return "vision";
    if (ocrQualityEstimate < 0.4) return "hybrid";
  }
  return "text";
}

// ---- Main Entry ----

export async function parseQuestion(
  block: QuestionBlock,
  settings: AppSettings,
  onStream?: (partial: string) => void,
): Promise<ParseResult> {
  const route = await decideRoute(block, settings);
  const provider = getProvider(settings.providerId ?? "anthropic");
  const modelName = String(settings.apiModel || provider.defaultModel || "").toLowerCase();
  const imageQuestion =
    !!block.hasImage ||
    !!block.imageDataUrl ||
    detectVisualKeywords(block.previewText || "");
  const modelLikelyTextOnly = isLikelyTextOnlyModel(modelName);

  if (route === "text" && imageQuestion && !hasSufficientPreviewText(block.previewText)) {
    const isEn = settings.language === "en";
    if (provider.supportsVision) {
      throw new Error(
        isEn
          ? "This question includes an image. Current route is text-only. Switch to Auto/Vision route or a multimodal model."
          : "检测到该题包含图片，但当前是文本路线。请切换为“自动判断/视觉优先”或使用多模态模型。",
      );
    }
    throw new Error(
      isEn
        ? `Current provider/model is text-only (${provider.name}) and cannot parse image questions. Please switch to a multimodal provider/model.`
        : `当前提供商/模型为文本模型（${provider.name}），无法解析图片题。请切换到支持视觉的多模态模型。`,
    );
  }
  if (imageQuestion && modelLikelyTextOnly) {
    const isEn = settings.language === "en";
    throw new Error(
      isEn
        ? `Current model (${settings.apiModel || provider.defaultModel}) appears text-only and cannot reliably parse image questions. Please switch to a multimodal model.`
        : `当前模型（${settings.apiModel || provider.defaultModel}）疑似文本模型，无法可靠解析图片题。请切换到多模态模型。`,
    );
  }

  // Vision route requires a real image payload; hybrid route can safely continue with text-only prompt.
  if (imageQuestion && provider.supportsVision && route === "vision" && !block.imageDataUrl) {
    const isEn = settings.language === "en";
    throw new Error(
      isEn
        ? "Image question detected but screenshot capture failed, so image was not sent to model. Please retry."
        : "检测到图片题，但截图裁剪失败，未能把图片发送给模型。请重试。",
    );
  }

  logEvent(`route_used_${route}` as "route_used_text", { blockId: block.id, provider: provider.id });

  if (!settings.apiKey && !provider.keyOptional) {
    return mockParse(block, route);
  }

  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
      logEvent("parse_error", { blockId: block.id, attempt, error: lastError?.message });
    }
    try {
      let result: ParseResult;
      const useCustomAnthropic = provider.id === "custom" && settings.customProviderProtocol === "anthropic";
      if (provider.id === "anthropic" || useCustomAnthropic) {
        result = await callAnthropic(block, route, settings, onStream);
      } else if (provider.id === "gemini") {
        result = await callGemini(block, route, settings);
      } else {
        result = await callOpenAICompat(block, route, settings, provider, onStream);
      }

      const duration = Date.now() - startTime;
      logEvent("parse_success", { blockId: block.id, route, provider: provider.id, duration, attempt });
      return result;

    } catch (err) {
      lastError = normalizeNetworkError(err, provider, settings);
      // Don't retry on auth errors (4xx except 429)
      const is4xx = lastError.message.includes(" 4") && !lastError.message.includes("429");
      if (is4xx) break;
    }
  }

  logEvent("parse_error", { blockId: block.id, error: lastError?.message, exhausted: true });
  throw lastError ?? new Error("Parse failed after retries");
}

function normalizeNetworkError(
  err: unknown,
  provider: ProviderConfig,
  settings: AppSettings,
): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  const msg = String(e.message || "");
  const isFailedFetch = /failed to fetch/i.test(msg);
  if (!isFailedFetch) return e;

  const isEn = settings.language === "en";
  const baseUrlRaw = settings.customBaseUrl || provider.baseUrl;
  const baseUrl = String(baseUrlRaw || "").trim();
  const usingLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(baseUrl);
  const usingHttp = /^http:\/\//i.test(baseUrl);
  const host = (() => {
    try {
      return new URL(baseUrl).host || baseUrl;
    } catch {
      return baseUrl || "(unknown)";
    }
  })();

  if (isEn) {
    if (usingLocalhost) {
      return new Error(
        `Network request failed (provider: ${provider.name}, endpoint: ${host}). Local service seems unreachable. Verify local API service is running and base URL is correct.`,
      );
    }
    if (usingHttp) {
      return new Error(
        `Network request failed (provider: ${provider.name}, endpoint: ${host}). Insecure HTTP endpoint may be blocked. Prefer HTTPS endpoint.`,
      );
    }
    return new Error(
      `Network request failed (provider: ${provider.name}, endpoint: ${host}). Check API endpoint, API key, and current network.`,
    );
  }

  if (usingLocalhost) {
    return new Error(
      `网络请求失败（提供商：${provider.name}，地址：${host}）。本地服务不可达，请确认本地 API 服务已启动且 Base URL 正确。`,
    );
  }
  if (usingHttp) {
    return new Error(
      `网络请求失败（提供商：${provider.name}，地址：${host}）。HTTP 明文地址可能被拦截，建议改为 HTTPS。`,
    );
  }
  return new Error(
    `网络请求失败（提供商：${provider.name}，地址：${host}）。请检查 API 地址、API Key 与网络连接。`,
  );
}

function isLikelyTextOnlyModel(name: string): boolean {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return false;
  const visionHints = ["4o", "gpt-4.1", "vision", "vl", "gemini", "llava", "glm-4v", "qwen2.5-vl", "claude-3", "claude-opus-4", "claude-sonnet-4", "claude-haiku-4"];
  if (visionHints.some((k) => n.includes(k))) return false;
  const textOnlyHints = [
    "deepseek-chat",
    "deepseek-reasoner",
    "gpt-3.5",
    "moonshot-v1",
    "qwen-max",
    "qwen-plus",
    "qwen-turbo",
    "glm-4-flash",
    "glm-4-plus",
  ];
  return textOnlyHints.some((k) => n.includes(k));
}

function hasSufficientPreviewText(text?: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (t.length >= 100) return true;
  // Heuristic for structured stems that are likely already complete enough without OCR.
  if (/\(\s*1\s*\)|（\s*1\s*）|A[、.．]|B[、.．]|C[、.．]|D[、.．]/.test(t) && t.length >= 100) {
    return true;
  }
  return false;
}

// ---- Fetch with Timeout ----

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      const timeoutError = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      logError("Request timeout", timeoutError, "fetchWithTimeout", { url });
      throw timeoutError;
    }
    logError("Fetch failed", err, "fetchWithTimeout", { url });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function buildApiUrl(baseUrlRaw: string, endpoint: string): string {
  const baseUrl = String(baseUrlRaw || "").trim().replace(/\/+$/, "");
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  if (baseUrl.endsWith(normalizedEndpoint)) return baseUrl;
  if (baseUrl.endsWith("/v1") && normalizedEndpoint.startsWith("/v1/")) {
    return `${baseUrl}${normalizedEndpoint.slice(3)}`;
  }
  if (baseUrl.endsWith("/v1beta") && normalizedEndpoint.startsWith("/v1beta/")) {
    return `${baseUrl}${normalizedEndpoint.slice(7)}`;
  }
  return `${baseUrl}${normalizedEndpoint}`;
}

// ---- System Prompt ----

const SYSTEM_PROMPT = `You are a quiz-solving assistant.
Return STRICT JSON only with this schema:
{"questionType":"fill_blank","answer":"示例答案","confidence":0.95,"briefExplanation":"1-2 sentence reason","detailedExplanation":"step-by-step explanation","recognizedText":"full recognized question text","warning":null}

Rules:
1) questionType must be one of: single_choice | multi_choice | judge | fill_blank | short_answer
2) single_choice: answer must be exactly one letter A-D
3) multi_choice: answer must contain all correct letters in ascending order, comma-separated, e.g. A,C,D
4) fill_blank/short_answer/judge: answer must be content answer, never force A-D letters
5) For multi-part fill-blank questions like (1)(2)(3), answer must contain only the blank contents in order, separated by semicolons, e.g. "葡萄糖；淀粉；F". Do not include prefixes like 1., 1:, (1), 第1空.
5) If image content and text snippet conflict, trust the image first
6) If the stem/options are incomplete or ambiguous, set warning with a concise reason and lower confidence
7) Do not output markdown, code fences, or extra text. JSON only.`;

const TEXT_ROUTE_OPTION_ACCURACY_RULES = [
  "For multiple-choice questions, option mapping accuracy is critical.",
  "Always reconstruct all options exactly before deciding the answer.",
  "If options are composite forms (e.g. A=statement combo, B=statement combo), verify each statement first, then map to A/B/C/D.",
  "If the question is multi-select (e.g. 多选/不定项), return answer letters in ascending order with comma separators, e.g. A,C,D.",
  "For multi-select, evaluate each option independently and include ALL true options, not just one best option.",
  "If any option text is missing or ambiguous, set warning with a concise reason instead of guessing confidently.",
].join("\n");

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

function buildUserQuestionPrompt(block: QuestionBlock, route: RouteUsed, settings: AppSettings): string {
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

function looksFormulaOrDiagramHeavy(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return /(g\(s\)|h\(s\)|g\(j|h\(j|f\(x\)|nyquist|bode|奈奎斯特|伯德图|传递函数|jw|jω|ω|σ|∫|Σ|√|≤|≥|≠|图中|如图|下图|上图)/i.test(t);
}


// ---- Anthropic ----

async function callAnthropic(
  block: QuestionBlock,
  route: RouteUsed,
  settings: AppSettings,
  onStream?: (partial: string) => void,
): Promise<ParseResult> {
  const provider = getProvider("anthropic");
  const baseUrl = settings.customBaseUrl || provider.baseUrl;
  const content: unknown[] = [];

  if ((route === "vision" || route === "hybrid") && block.imageDataUrl) {
    const base64 = block.imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: base64 } });
  }
  content.push({ type: "text", text: buildUserQuestionPrompt(block, route, settings) });

  // Some custom Anthropic-compatible gateways keep SSE connections open,
  // causing UI-side hangs. Prefer non-stream mode for custom provider.
  const useStream = !!onStream && settings.providerId !== "custom";
  const requestBody = JSON.stringify({
    model: settings.apiModel || provider.defaultModel,
    max_tokens: 1024,
    stream: useStream,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const requestWithAuthMode = async (authMode: "x-api-key" | "bearer") => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (authMode === "x-api-key") headers["x-api-key"] = settings.apiKey;
    else headers.Authorization = `Bearer ${settings.apiKey}`;

    return fetchWithTimeout(buildApiUrl(baseUrl, "/v1/messages"), {
      method: "POST",
      headers,
      body: requestBody,
    });
  };

  let res = await requestWithAuthMode("x-api-key");
  if (!res.ok) {
    const errText = await res.text();
    const isCustomAnthropic = settings.providerId === "custom" && settings.customProviderProtocol === "anthropic";
    const shouldRetryBearer =
      isCustomAnthropic &&
      res.status === 401 &&
      /invalid x-api-key|x-api-key|api key/i.test(errText);
    if (shouldRetryBearer) {
      res = await requestWithAuthMode("bearer");
      if (!res.ok) {
        throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
      }
    } else {
      throw new Error(`Anthropic API ${res.status}: ${errText}`);
    }
  }

  if (useStream && res.body) {
    const text = await consumeAnthropicStream(res.body, onStream!);
    return buildResult(block, route, text);
  }

  const data = await res.json() as { content: Array<{ type: string; text?: string }> };
  return buildResult(block, route, data.content.find(c => c.type === "text")?.text ?? "{}");
}

async function consumeAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onStream: (partial: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const evt = JSON.parse(data) as { type: string; delta?: { type: string; text?: string } };
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          fullText += evt.delta.text ?? "";
          onStream(fullText);
        }
      } catch (parseErr) {
        logWarn("Malformed SSE event", "consumeAnthropicStream", { line, error: String(parseErr) });
      }
    }
  }
  return fullText;
}

// ---- OpenAI-compatible ----

async function callOpenAICompat(
  block: QuestionBlock,
  route: RouteUsed,
  settings: AppSettings,
  provider: ProviderConfig,
  onStream?: (partial: string) => void,
): Promise<ParseResult> {
  const useVision = provider.supportsVision && (route === "vision" || route === "hybrid");
  // Custom OpenAI-compatible endpoints may not fully support SSE semantics.
  // Disable stream for custom provider to avoid indefinite pending.
  const useStream = !!onStream && settings.providerId !== "custom";

  // For non-vision providers, use simple string content
  let userContent: unknown;
  if (useVision && block.imageDataUrl) {
    const contentArray: unknown[] = [];
    contentArray.push({ type: "image_url", image_url: { url: block.imageDataUrl, detail: "high" } });
    contentArray.push({ type: "text", text: buildUserQuestionPrompt(block, route, settings) });
    userContent = contentArray;
  } else {
    // Simple string content for text-only providers
    userContent = buildUserQuestionPrompt(block, route, settings);
  }

  const baseUrl = settings.customBaseUrl || provider.baseUrl;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.authHeader === "bearer" && settings.apiKey) {
    headers["Authorization"] = `Bearer ${settings.apiKey}`;
  }

  const requestBody: Record<string, unknown> = {
    model: settings.apiModel || provider.defaultModel,
    stream: useStream,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  };

  if (provider.id === "minimax") {
    requestBody.max_completion_tokens = 1024;
    requestBody.thinking = { type: "adaptive" };
    requestBody.reasoning_split = true;
  } else {
    requestBody.max_tokens = 1024;
  }

  const res = await fetchWithTimeout(buildApiUrl(baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) throw new Error(`${provider.name} API ${res.status}: ${await res.text()}`);

  if (useStream && res.body) {
    const text = await consumeOpenAIStream(res.body, onStream!);
    return buildResult(block, route, text);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return buildResult(block, route, data.choices?.[0]?.message?.content ?? "{}");
}

async function consumeOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onStream: (partial: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const evt = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) { fullText += delta; onStream(fullText); }
      } catch (parseErr) {
        logWarn("Malformed OpenAI SSE event", "consumeOpenAIStream", { line, error: String(parseErr) });
      }
    }
  }
  return fullText;
}

// ---- Gemini ----

async function callGemini(
  block: QuestionBlock,
  route: RouteUsed,
  settings: AppSettings,
): Promise<ParseResult> {
  const provider = getProvider("gemini");
  const model = settings.apiModel || provider.defaultModel;
  const url = `${provider.baseUrl}/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;

  const parts: unknown[] = [];
  if ((route === "vision" || route === "hybrid") && block.imageDataUrl) {
    const base64 = block.imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
    parts.push({ inline_data: { mime_type: "image/png", data: base64 } });
  }
  parts.push({ text: `${SYSTEM_PROMPT}\n\n${buildUserQuestionPrompt(block, route, settings)}` });

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.1 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  return buildResult(block, route, data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
}

// ---- Result Builder ----

export function buildResult(block: QuestionBlock, route: RouteUsed, rawText: string): ParseResult {
  const clean = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  let parsed: Record<string, unknown> = {};
  let parsedByFallback = false;
  try {
    parsed = JSON.parse(clean);
  } catch (firstErr) {
    logWarn("Failed to parse JSON response, attempting extraction", "buildResult", { rawText: clean.slice(0, 100) });
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (secondErr) {
        logError("Failed to extract JSON from response", secondErr, "buildResult", { rawText: clean.slice(0, 200) });
      }
    }
    if (Object.keys(parsed).length === 0) {
      parsed = extractFieldsFromLooseJsonLikeText(clean);
      parsedByFallback = Object.keys(parsed).length > 0;
    }
  }

  let questionType = (parsed.questionType as ParseResult["questionType"]) ?? "unknown";
  const rawAnswer = typeof parsed.answer === "string" && parsed.answer
    ? parsed.answer
    : (inferAnswerFromRawText(clean) || "—");
  let answer = normalizeAnswerByType(rawAnswer, questionType);
  if (questionType === "single_choice" && /[,，、/|]/.test(answer)) {
    questionType = "multi_choice";
  }
  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.8;

  const parsedRecognizedRaw = typeof parsed.recognizedText === "string" ? parsed.recognizedText : "";
  const parsedRecognized = sanitizeModelText(parsedRecognizedRaw);
  const previewSanitized = sanitizeModelText(block.previewText ?? "");
  const recognizedTextRaw = shouldFallbackToPreview(parsedRecognized, previewSanitized)
    ? previewSanitized
    : parsedRecognized;
  const recognizedText = normalizeRecognizedQuestionText(
    recognizedTextRaw,
    questionType,
    block.questionTypeGuess,
  );
  const briefRaw = typeof parsed.briefExplanation === "string"
    ? parsed.briefExplanation
    : (parsedByFallback ? "已通过容错模式提取解析结果" : "(解析提取失败)");
  const detailedRaw = typeof parsed.detailedExplanation === "string"
    ? parsed.detailedExplanation
    : rawText.slice(0, 600);
  const structured = formatMultiPartExplanation(
    sanitizeModelText(briefRaw),
    sanitizeModelText(detailedRaw),
    recognizedText,
    questionType,
  );
  const corrected = applyBiologyHeuristicCorrections(structured.detailed, recognizedText);
  const nonChoiceLike = shouldTreatAsNonChoice(questionType, recognizedText, structured.detailed, block.previewText || "");
  if (nonChoiceLike) {
    if (questionType === "single_choice" || questionType === "multi_choice" || questionType === "unknown") {
      questionType = inferNonChoiceType(recognizedText, block.previewText || "");
    }
    if (isOptionLetterSet(answer)) {
      const extracted = extractNonChoiceAnswerFromText(`${corrected}\n${structured.brief}`);
      answer = extracted || "需人工确认";
    } else if (isWeakNonChoiceAnswer(answer)) {
      const extracted = extractNonChoiceAnswerFromText(`${answer}\n${corrected}\n${structured.brief}`);
      answer = extracted || "需人工确认";
    }
  }

  answer = normalizePlaceholderAnswer(answer, questionType);

  if (questionType === "single_choice") {
    const correctedByRule = applyProbabilitySingleChoiceCorrection(
      answer,
      recognizedText,
      block.previewText || "",
    );
    if (correctedByRule && correctedByRule !== answer) {
      answer = correctedByRule;
    }
  }

  const warning = typeof parsed.warning === "string" ? parsed.warning : undefined;
  const finalWarning = answer === "需人工确认"
    ? [warning, "答案未提取到稳定的逐空结果，需人工确认后再填写。"].filter(Boolean).join(" ")
    : warning;

  return {
    blockId: block.id,
    questionType,
    answer,
    confidence,
    briefExplanation: structured.brief,
    detailedExplanation: corrected,
    recognizedText,
    routeUsed: route,
    ocrQualityScore: 0.85,
    warning: finalWarning || undefined,
  };
}

function sanitizeModelText(input: string): string {
  const text = String(input || "").replace(/\r/g, "");
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isModelNoiseLine(line));
  const merged = lines.join("\n");
  return stripModelTrailingNoise(merged);
}

function normalizeRecognizedQuestionText(
  text: string,
  questionType: ParseResult["questionType"],
  guessedType: QuestionBlock["questionTypeGuess"],
): string {
  const normalized = sanitizeModelText(text);
  if (!normalized) return "";

  const effectiveType = questionType === "unknown" ? guessedType : questionType;
  if (effectiveType === "single_choice" || effectiveType === "multi_choice") {
    return normalizeChoiceRecognizedText(normalized);
  }
  if (effectiveType === "judge") {
    return normalizeJudgeRecognizedText(normalized);
  }
  if (effectiveType === "fill_blank") {
    return normalizeFillBlankRecognizedText(normalized);
  }
  return trimTrailingQuestionNoise(normalized);
}

function normalizeChoiceRecognizedText(text: string): string {
  const normalized = trimTrailingQuestionNoise(text);
  const firstOptionIdx = normalized.search(/[A-D][\.\):：、]/);
  if (firstOptionIdx < 0) return normalized;

  const stem = dedupeRepeatedLead(normalizeTextLoose(normalized.slice(0, firstOptionIdx)));
  const optionSegment = normalized.slice(firstOptionIdx);
  const rawMatches = Array.from(optionSegment.matchAll(/([A-D])[\.\):：、]\s*([\s\S]*?)(?=(?:\s+[A-D][\.\):：、])|$)/g));
  const dedup = new Map<string, string>();
  for (const match of rawMatches) {
    const key = match[1];
    const value = sanitizeRecognizedOptionValue(match[2] || "");
    if (!value) continue;
    if (!dedup.has(key)) dedup.set(key, value);
  }
  if (dedup.size < 2) return normalized;
  return normalizeTextLoose(`${stem} ${Array.from(dedup.entries()).map(([key, value]) => `${key}. ${value}`).join(" ")}`);
}

function normalizeJudgeRecognizedText(text: string): string {
  let out = trimTrailingQuestionNoise(text);
  const headerMatches = Array.from(out.matchAll(/\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)/g));
  const firstHeaderIndex = headerMatches[0]?.index ?? -1;
  if (firstHeaderIndex > 0) out = out.slice(firstHeaderIndex).trim();
  if (headerMatches.length >= 2 && typeof headerMatches[1].index === "number") {
    out = out.slice(0, headerMatches[1].index!).trim();
  }

  const optionAt = out.search(/\b(?:对|错|正确|错误|true|false)\b/i);
  const stem = dedupeRepeatedLead(normalizeTextLoose(optionAt > 0 ? out.slice(0, optionAt) : out));
  const options: string[] = [];
  if (/\btrue\b|\bfalse\b/i.test(out)) {
    options.push("True", "False");
  } else {
    if (/(?:^|\s)(?:对|正确)(?:\s|$)/.test(out)) options.push("对");
    if (/(?:^|\s)(?:错|错误)(?:\s|$)/.test(out)) options.push("错");
  }
  return normalizeTextLoose(`${stem}${options.length ? ` ${Array.from(new Set(options)).join(" ")}` : ""}`);
}

function normalizeFillBlankRecognizedText(text: string): string {
  const normalized = trimTrailingQuestionNoise(text).replace(/请输入答案/g, " ").replace(/\s+/g, " ").trim();
  return dedupeRepeatedLead(normalized);
}

function sanitizeRecognizedOptionValue(raw: string): string {
  const normalized = trimTrailingQuestionNoise(raw);
  return dedupeRepeatedLead(normalized);
}

function trimTrailingQuestionNoise(text: string): string {
  let out = normalizeTextLoose(text);
  if (!out) return "";

  const noisePattern = /(?:返回|作业详情|提交作业|上一题|下一题|标记此题|课堂练习|总分|题目数|答题卡|在线客服|文件预览|submit|previous|next)/i;
  const noiseMatch = noisePattern.exec(out);
  if (noiseMatch && noiseMatch.index > 0) {
    out = normalizeTextLoose(out.slice(0, noiseMatch.index));
  }

  out = out
    .replace(/\s+[一二三四五六七八九十]+、\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]?(?:单选题|多选题|判断题|填空题)?[\]】]?\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]\s*$/u, "")
    .replace(/\s+第\s*[一二三四五六七八九十\d]+\s*[章节题]\s*$/u, "")
    .trim();

  return out;
}

function dedupeRepeatedLead(text: string): string {
  const normalized = normalizeTextLoose(text);
  if (!normalized) return "";

  const firstSentence = normalized.match(/^(.{8,}?[。！？!?])/);
  if (firstSentence?.[1]) {
    const sentence = normalizeTextLoose(firstSentence[1]);
    const secondIndex = normalized.indexOf(sentence, sentence.length);
    if (secondIndex > 0) {
      return normalizeTextLoose(normalized.slice(0, secondIndex));
    }
  }

  const probe = normalizeTextLoose(normalized.slice(0, Math.min(32, Math.max(12, Math.floor(normalized.length / 2)))));
  if (probe.length >= 12) {
    const repeatedAt = normalized.indexOf(probe, probe.length);
    if (repeatedAt > 0) {
      return normalizeTextLoose(normalized.slice(0, repeatedAt));
    }
  }

  return normalized;
}

function normalizeTextLoose(text: string): string {
  return normalizeMathDisplayText(String(text || "").replace(/\s+/g, " ").trim());
}

function normalizeMathDisplayText(text: string): string {
  let out = String(text || "");
  if (!out) return "";

  out = out
    .replace(/&infin;|&#8734;|\\infty/gi, "∞")
    .replace(/负无穷/g, "-∞")
    .replace(/正无穷/g, "+∞")
    .replace(/&omega;|&#969;|\\omega/gi, "ω")
    .replace(/&sigma;|&#963;|\\sigma/gi, "σ")
    .replace(/&minus;|&#8722;/gi, "-")
    .replace(/[−﹣－]/g, "-")
    .replace(/[＋﹢]/g, "+")
    .replace(/\b([+-])\s*infty\b/gi, "$1∞")
    .replace(/\binfty\b/gi, "∞")
    .replace(/由\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/g, "由-∞到+∞")
    .replace(/从\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/g, "从-∞到+∞");

  out = out.replace(
    /((?:ω|w|omega)[^。；;,.，\n]{0,24}?由)\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/gi,
    (_m, prefix) => `${prefix}-∞到+∞`,
  );

  return out;
}

function isModelNoiseLine(line: string): boolean {
  const t = String(line || "").trim();
  if (!t) return true;
  if (/^```/.test(t)) return true;
  if (/^(?:\{|\}|\[|\]|"questionType"|"answer"|"confidence"|"recognizedText"|"warning")/.test(t)) return true;
  if (/[.#]?[a-zA-Z0-9_-]+\s*\{\s*(?:fill|stroke|font-family|line-join|linecap|width|height)\s*:/i.test(t)) return true;
  if (/^(?:fill|stroke|font-family|stroke-width|stroke-linejoin|stroke-linecap)\s*:/i.test(t)) return true;
  if (/(?:svg|path|stroke|fill)\s*[:=]/i.test(t) && /[{;}]/.test(t)) return true;
  if (t.length > 150 && /[{;}:]/.test(t) && /(rgb\(|font-family|stroke|fill|brush\d+)/i.test(t)) return true;
  return false;
}

function stripModelTrailingNoise(text: string): string {
  const t = String(text || "");
  if (!t) return t;
  const cutMarkers = ["```json", "```", "{\n\"questionType\"", "\"questionType\":", "[\n{", "\n[{", "\n.A.", "\n.w"];
  let cut = -1;
  for (const marker of cutMarkers) {
    const idx = t.indexOf(marker);
    if (idx >= 0 && (cut < 0 || idx < cut)) cut = idx;
  }
  return (cut >= 0 ? t.slice(0, cut) : t).trim();
}

function applyProbabilitySingleChoiceCorrection(
  currentAnswer: string,
  recognizedText: string,
  previewText: string,
): string | null {
  const text = `${recognizedText}\n${previewText}`;
  if (!/在放回抽样/.test(text)) return null;
  const total = firstIntAfter(text, /箱子里有\s*(\d+)\s*只开关/);
  const good = firstIntAfter(text, /正品\s*(\d+)\s*只/);
  if (!total || !good || total <= 0 || good <= 0 || good > total) return null;

  let target: number | null = null;
  if (/X\s*=\s*0\s*表示第.?一?次取出正品/.test(text) && !/X\s*=\s*0\s*[,，、].*Y\s*=\s*0/.test(text)) {
    target = good / total;
  } else if (/Y\s*=\s*0\s*表示第.?二?次取出正品/.test(text) && !/X\s*=\s*0\s*[,，、].*Y\s*=\s*0/.test(text)) {
    target = good / total;
  } else if (/X\s*=\s*0/.test(text) && /Y\s*=\s*0/.test(text)) {
    target = (good / total) * (good / total);
  }
  if (target == null) return null;

  const options = extractChoiceOptionValues(text);
  if (options.length < 2) return null;
  let best: { key: string; diff: number } | null = null;
  for (const op of options) {
    if (op.value == null || !Number.isFinite(op.value)) continue;
    const diff = Math.abs(op.value - target);
    if (!best || diff < best.diff) best = { key: op.key, diff };
  }
  if (!best) return null;

  if (/^[A-D]$/.test(currentAnswer) && currentAnswer === best.key) return null;
  return best.key;
}

function firstIntAfter(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function extractChoiceOptionValues(text: string): Array<{ key: string; value: number | null }> {
  const clean = String(text || "").replace(/\r/g, "");
  const pattern = /(?:^|\n|\s)([A-D])[、.．:：)\]]\s*([^\nA-D]{1,40})/g;
  const out: Array<{ key: string; value: number | null }> = [];
  let m: RegExpExecArray | null = null;
  while ((m = pattern.exec(clean)) !== null) {
    const key = m[1];
    const raw = m[2].trim();
    out.push({ key, value: parseSimpleNumericValue(raw) });
  }
  return out;
}

function parseSimpleNumericValue(raw: string): number | null {
  const s = String(raw || "").replace(/\s+/g, "");
  if (!s) return null;
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
  if (frac) {
    const a = Number(frac[1]);
    const b = Number(frac[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
  }
  const num = s.match(/^-?\d+(?:\.\d+)?$/);
  if (num) {
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function applyBiologyHeuristicCorrections(detailed: string, recognizedText: string): string {
  let out = String(detailed || "");
  const stem = String(recognizedText || "");

  // In this classic "four organics mapping" problem, models may swap A/E in wheat-seed context.
  if (/生物体内四种有机物的组成与功能关系图/.test(stem) && /小麦种子细胞中.*物质A.*物质E/.test(stem)) {
    out = out
      .replace(/物质A[是为]\s*淀粉[^。\n，；]*[，；]\s*物质E[是为]\s*葡萄糖/g, "物质A是葡萄糖，物质E是淀粉")
      .replace(/\(\s*1\s*\)[^。\n]*?淀粉[^。\n]*?葡萄糖/g, (m) => {
        if (/葡萄糖[^。\n]*淀粉/.test(m)) return m;
        return m.replace(/淀粉[\s、，；;]*葡萄糖|淀粉[\s、，；;]+.*?葡萄糖/g, "葡萄糖；淀粉");
      });
  }

  // Protein chain oxygen-count minimum is commonly misreported as a+b-1.
  if (/a个C物质组成b条链|a\s*个\s*C.*b\s*条链/.test(stem)) {
    out = out
      .replace(/\b(?:a\+b|b\+a)\s*-\s*1\b/g, "a+b")
      .replace(/\b(?:a\+b-1|b\+a-1)\b/g, "a+b");
  }

  // Biuret control group should be known protein solution, not water.
  if (/双缩脲|磷酸化酶是否为蛋白质/.test(stem)) {
    out = out.replace(/对照组[^。\n]*?(清水|蒸馏水)/g, (m) => {
      return m.replace(/清水|蒸馏水/g, "等量已知蛋白质液（豆浆、蛋清等）");
    });
  }

  return out;
}

function shouldTreatAsNonChoice(
  questionType: ParseResult["questionType"],
  recognizedText: string,
  detailed: string,
  previewText: string,
): boolean {
  if (questionType === "fill_blank" || questionType === "short_answer" || questionType === "judge") return true;
  const text = `${recognizedText}\n${detailed}\n${previewText}`;
  return /\(\s*1\s*\)|（\s*1\s*）|填空|请据图回答|____|________/.test(text);
}

function inferNonChoiceType(recognizedText: string, previewText: string): ParseResult["questionType"] {
  const text = `${recognizedText}\n${previewText}`;
  if (/填空|____|________/.test(text)) return "fill_blank";
  if (/\(\s*1\s*\)|（\s*1\s*）|请据图回答/.test(text)) return "fill_blank";
  return "short_answer";
}

function isOptionLetterSet(text: string): boolean {
  return /^[A-D](?:\s*[,，、/|]\s*[A-D])*$/.test(String(text || "").trim().toUpperCase());
}

function isWeakNonChoiceAnswer(answer: string): boolean {
  const a = String(answer || "").trim();
  if (!a) return true;
  if (isOptionLetterSet(a)) return true;
  if (looksLikePlaceholderAnswer(a)) return true;
  const hasPoint = /\(\s*\d+\s*\)|（\s*\d+\s*）|[①②③④⑤⑥⑦⑧⑨⑩]/.test(a);
  const uncertain = /(无法|不确定|看不清|不完整|信息不足|缺少|未完整|不能确定)/.test(a);
  if (uncertain && !hasPoint) return true;
  if (a.length > 120 && !hasPoint) return true;
  return false;
}

function extractNonChoiceAnswerFromText(text: string): string {
  const normalized = String(text || "").replace(/\r/g, "").trim();
  if (!normalized) return "";
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => /^(\d+\.|[①②③④⑤⑥⑦⑧⑨⑩])/.test(l));
  if (numbered.length >= 2) {
    const joined = numbered.slice(0, 6).join("；");
    return isOptionLetterSet(joined) ? "" : joined;
  }
  const answerLike = lines.filter((l) => /答案|填|应为|为：|是：/.test(l));
  if (answerLike.length > 0) {
    const joined = answerLike.slice(0, 3).join("；");
    if (/(无法判断|无法确定|题干不完整|信息不完整|看不清)/.test(joined)) return "";
    if (looksLikePlaceholderAnswer(joined)) return "";
    if (/答案\s*[:：]?\s*[A-D](?:\s*[,，、/|]\s*[A-D])*/i.test(joined)) return "";
    return isOptionLetterSet(joined) ? "" : joined;
  }
  return "";
}

function normalizeAnswerByType(raw: string, questionType: ParseResult["questionType"]): string {
  const t = questionType;
  if (t === "single_choice" || t === "multi_choice") return normalizeAnswer(raw);
  if (t === "fill_blank") return normalizeFillBlankAnswer(raw);
  const s = String(raw || "").trim();
  if (!s) return "—";
  return s;
}

function normalizePlaceholderAnswer(answer: string, questionType: ParseResult["questionType"]): string {
  if (questionType === "single_choice" || questionType === "multi_choice" || questionType === "judge") {
    return answer;
  }
  const normalized = String(answer || "").trim();
  if (!normalized) return "需人工确认";
  if (looksLikePlaceholderAnswer(normalized)) return "需人工确认";
  return normalized;
}

function looksLikePlaceholderAnswer(answer: string): boolean {
  const a = String(answer || "").replace(/\s+/g, "");
  if (!a) return true;
  return /(见分点答案|见分点作答|按分点作答|分点作答|仅供参考|参考答案见解析|详见解析|示例答案|需人工确认|未给出逐空答案|未提取到稳定答案|需结合解析判断)/.test(a);
}

function normalizeFillBlankAnswer(raw: string): string {
  const source = String(raw || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "—";

  const numberedMatches = Array.from(
    source.matchAll(/(?:^|[\n;；])\s*(?:\(?\d+\)?[.)、]|第\s*\d+\s*空\s*[:：]?|\d+\.\d+\s*[:：]?|\d+\s*[:：.。．、]\s*)([^\n;；]+)/g),
  );
  if (numberedMatches.length >= 2) {
    const parts = numberedMatches
      .map((match) => sanitizeFillBlankPart(match[1] || ""))
      .filter(Boolean);
    if (parts.length) return parts.join("；");
  }

  const splitParts = source
    .split(/[\n;；]+/)
    .map((part) => sanitizeFillBlankPart(part))
    .filter(Boolean);
  if (splitParts.length >= 2) return splitParts.join("；");

  return sanitizeFillBlankPart(source) || "—";
}

function sanitizeFillBlankPart(part: string): string {
  return String(part || "")
    .replace(/^\s*(?:\(?\d+\)?[.)、]|第\s*\d+\s*空\s*[:：]?|\d+\.\d+\s*[:：]?|\d+\s*[:：.。．、]\s*)/, "")
    .replace(/^答案\s*[:：]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMultiPartExplanation(
  brief: string,
  detailed: string,
  recognizedText: string,
  questionType: ParseResult["questionType"],
): { brief: string; detailed: string } {
  const source = `${recognizedText}\n${detailed}`;
  const multiPartSignals = [
    /\(\s*1\s*\)/,
    /（\s*1\s*）/,
    /\n\s*1[\.、]/,
  ];
  const isLikelyMultiPart =
    (questionType === "fill_blank" || questionType === "short_answer" || questionType === "unknown")
    && multiPartSignals.some((re) => re.test(source));
  if (!isLikelyMultiPart) return { brief, detailed };

  const normalized = String(detailed || "")
    .replace(/（\s*(\d+)\s*）/g, "\n$1. ")
    .replace(/\(\s*(\d+)\s*\)/g, "\n$1. ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  const bulletLike = lines.filter((l) => /^\d+\.\s*/.test(l));
  if (bulletLike.length < 2) {
    return {
      brief: `${brief}\n检测到该题为多小问，建议按(1)(2)(3)分点作答。`,
      detailed: normalized,
    };
  }

  const compact = lines
    .map((l) => (/^\d+\.\s*/.test(l) ? l : `- ${l}`))
    .join("\n");
  return {
    brief: `${brief}\n已按小问分点整理答案。`,
    detailed: compact,
  };
}

function extractFieldsFromLooseJsonLikeText(text: string): Record<string, unknown> {
  const pick = (field: string): string | undefined => {
    const m = text.match(new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,|\\n\\s*"|\\n\\s*\\}|\\})`, "i"));
    return m?.[1];
  };
  const pickNum = (field: string): number | undefined => {
    const m = text.match(new RegExp(`"${field}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"));
    return m ? Number(m[1]) : undefined;
  };
  const out: Record<string, unknown> = {};
  const questionType = pick("questionType");
  const answer = pick("answer");
  const brief = pick("briefExplanation");
  const detailed = pick("detailedExplanation");
  const recognized = pick("recognizedText");
  const warning = pick("warning");
  const confidence = pickNum("confidence");

  if (questionType) out.questionType = unescapeLooseJsonString(questionType);
  if (answer) out.answer = unescapeLooseJsonString(answer);
  if (brief) out.briefExplanation = unescapeLooseJsonString(brief);
  if (detailed) out.detailedExplanation = unescapeLooseJsonString(detailed);
  if (recognized) out.recognizedText = unescapeLooseJsonString(recognized);
  if (warning && warning.toLowerCase() !== "null") out.warning = unescapeLooseJsonString(warning);
  if (typeof confidence === "number" && Number.isFinite(confidence)) out.confidence = confidence;
  return out;
}

function unescapeLooseJsonString(s: string): string {
  return s
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .trim();
}

// ---- Mock Fallback ----

export async function mockParse(block: QuestionBlock, route: RouteUsed = "text"): Promise<ParseResult> {
  await new Promise(r => setTimeout(r, 800 + Math.random() * 500));
  return {
    blockId: block.id,
    questionType: block.questionTypeGuess === "unknown" ? "single_choice" : block.questionTypeGuess,
    answer: "B",
    confidence: 0.91,
    briefExplanation: "根据题意，选项 B 最符合要求。（未设置 API Key，当前为演示结果）",
    detailedExplanation: "请在侧边栏“设置”中选择 AI 提供商并填写 API Key，即可获得真实解析。\n\n当前为 Mock 演示数据。",
    recognizedText: block.previewText || "(请设置 API Key 获取真实 OCR 内容)",
    routeUsed: route,
    ocrQualityScore: 0.85,
    warning: undefined,
  };
}


function normalizeAnswer(raw: string): string {
  const original = String(raw || "").trim();
  if (!original) return "—";
  const s = original.toUpperCase();
  const letters = s.match(/[A-D]/g) || [];
  // For choice questions we normalize to sorted letters; for non-choice answers
  // (fill-blank / short-answer / judge text), keep the original text.
  if (letters.length === 0) return original;
  const uniqueSorted = Array.from(new Set(letters)).sort();
  return uniqueSorted.length > 1 ? uniqueSorted.join(",") : uniqueSorted[0];
}

function inferAnswerFromRawText(raw: string): string {
  const s = String(raw || "").toUpperCase();
  if (!s) return "";
  const multi = s.match(/[A-D](?:\s*[,，、/|]\s*[A-D])+/g);
  if (multi?.length) {
    const longest = multi.sort((a, b) => b.length - a.length)[0];
    return longest;
  }
  const single = s.match(/(?:答案|应选|正确答案|CORRECT)\s*[:：为是]?\s*([A-D])/i);
  return single?.[1] ?? "";
}

function shouldFallbackToPreview(recognizedText: string, previewText: string): boolean {
  const rec = String(recognizedText || "").trim();
  const preview = String(previewText || "").trim();
  if (!rec) return true;
  if (!preview) return false;

  const qCount = (rec.match(/\?/g) || []).length;
  const badRatio = qCount / Math.max(1, rec.length);
  const cjkCount = (rec.match(/[\u4e00-\u9fff]/g) || []).length;

  // If recognized text is mostly '?' and lacks CJK while preview has readable CJK, prefer preview text.
  if (qCount >= 3 && badRatio > 0.08 && cjkCount < 2) {
    const previewCjk = (preview.match(/[\u4e00-\u9fff]/g) || []).length;
    if (previewCjk >= 4) return true;
  }
  return false;
}


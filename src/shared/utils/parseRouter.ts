/**
 * Parse Router (M5 - Multi-Provider + Timeout + Retry + Streaming)
 */

import type { AppSettings, ParseResult, QuestionBlock } from "../types";
import { PROVIDERS, getProvider } from "../ai/providers";
import type { ProviderConfig, ProviderId } from "../ai/providers";
import { buildResult } from "../ai/parseResult";
import { callAnthropic, callGemini, callOpenAICompat } from "../ai/providerClients";
import { decideRoute, hasSufficientPreviewText } from "../ai/routeDecision";
import { mockParse } from "../ai/mockParse";
import { logEvent } from "./analytics";
import { detectVisualKeywords } from "./ocr";

export { PROVIDERS, getProvider, decideRoute, hasSufficientPreviewText, buildResult, mockParse };
export type { ProviderConfig, ProviderId };

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

export async function parseQuestion(
  block: QuestionBlock,
  settings: AppSettings,
  onStream?: (partial: string) => void,
): Promise<ParseResult> {
  const route = await decideRoute(block, settings);
  const provider = getProvider(settings.providerId ?? "anthropic");
  const modelName = String(settings.apiModel || provider.defaultModel || "").toLowerCase();
  const imageQuestion =
    Boolean(block.hasImage) ||
    Boolean(block.imageDataUrl) ||
    detectVisualKeywords(block.previewText || "");
  const modelLikelyTextOnly = isLikelyTextOnlyModel(modelName);

  if (route === "text" && imageQuestion && !hasSufficientPreviewText(block.previewText)) {
    if (provider.supportsVision) {
      throw new Error(getImageRouteMismatchMessage(settings.language));
    }
    throw new Error(getTextOnlyProviderMessage(settings.language, provider.name));
  }

  if (imageQuestion && modelLikelyTextOnly) {
    throw new Error(
      getTextOnlyModelMessage(settings.language, settings.apiModel || provider.defaultModel),
    );
  }

  if (imageQuestion && provider.supportsVision && route === "vision" && !block.imageDataUrl) {
    throw new Error(getMissingScreenshotMessage(settings.language));
  }

  logEvent(`route_used_${route}` as "route_used_text", { blockId: block.id, provider: provider.id });

  if (!settings.apiKey && !provider.keyOptional) {
    return mockParse(block, route);
  }

  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      logEvent("parse_error", { blockId: block.id, attempt, error: lastError?.message });
    }

    try {
      let result: ParseResult;
      const useCustomAnthropic =
        provider.id === "custom" && settings.customProviderProtocol === "anthropic";

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
      const is4xx = lastError.message.includes(" 4") && !lastError.message.includes("429");
      if (is4xx) break;
    }
  }

  logEvent("parse_error", { blockId: block.id, error: lastError?.message, exhausted: true });
  throw lastError ?? new Error("Parse failed after retries");
}

export function normalizeNetworkError(
  err: unknown,
  provider: ProviderConfig,
  settings: AppSettings,
): Error {
  const error = err instanceof Error ? err : new Error(String(err));
  const message = String(error.message || "");
  if (!/failed to fetch/i.test(message)) {
    return error;
  }

  const language = settings.language;
  const baseUrl = String(settings.customBaseUrl || provider.baseUrl || "").trim();
  const usingLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(baseUrl);
  const usingHttp = /^http:\/\//i.test(baseUrl);
  const host = getEndpointHostLabel(baseUrl);

  if (language === "en") {
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
      `网络请求失败（提供商：${provider.name}，地址：${host}）。本地服务似乎不可达，请确认本地 API 服务已启动且 Base URL 正确。`,
    );
  }
  if (usingHttp) {
    return new Error(
      `网络请求失败（提供商：${provider.name}，地址：${host}）。HTTP 明文地址可能被拦截，建议改为 HTTPS。`,
    );
  }
  return new Error(
    `网络请求失败（提供商：${provider.name}，地址：${host}）。请检查 API 地址、API Key 与当前网络连接。`,
  );
}

export function isLikelyTextOnlyModel(name: string): boolean {
  const normalizedName = String(name || "").trim().toLowerCase();
  if (!normalizedName) return false;

  const visionHints = [
    "gpt-5",
    "gpt-4.1",
    "vision",
    "vl",
    "gemini",
    "llava",
    "glm-5v",
    "glm-4v",
    "qwen3-vl",
    "qwen2.5-vl",
    "claude-fable-5",
    "claude-opus-4",
    "claude-sonnet-4",
    "claude-haiku-4",
    "kimi-k2",
    "minimax-m3",
    "llama3.2-vision",
    "gemma4",
  ];
  if (visionHints.some((hint) => normalizedName.includes(hint))) {
    return false;
  }

  const textOnlyHints = [
    "deepseek-v4",
    "gpt-3.5",
    "qwen-plus",
    "qwen-flash",
    "qwen-max",
    "glm-5.2",
    "glm-5.1",
    "glm-5-turbo",
  ];
  return textOnlyHints.some((hint) => normalizedName.includes(hint));
}

function getEndpointHostLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl || "(unknown)";
  }
}

function getImageRouteMismatchMessage(language: AppSettings["language"]): string {
  if (language === "en") {
    return "This question includes an image. Current route is text-only. Switch to Auto/Vision route or a multimodal model.";
  }
  return "检测到该题包含图片，但当前是纯文本路线。请切换到“自动判断 / 视觉优先”或使用多模态模型。";
}

function getTextOnlyProviderMessage(
  language: AppSettings["language"],
  providerName: string,
): string {
  if (language === "en") {
    return `Current provider/model is text-only (${providerName}) and cannot parse image questions. Please switch to a multimodal provider/model.`;
  }
  return `当前提供商/模型为纯文本模型（${providerName}），无法解析图片题。请切换到支持视觉的多模态模型。`;
}

function getTextOnlyModelMessage(
  language: AppSettings["language"],
  modelName: string,
): string {
  if (language === "en") {
    return `Current model (${modelName}) appears text-only and cannot reliably parse image questions. Please switch to a multimodal model.`;
  }
  return `当前模型（${modelName}）疑似为纯文本模型，无法可靠解析图片题。请切换到多模态模型。`;
}

function getMissingScreenshotMessage(language: AppSettings["language"]): string {
  if (language === "en") {
    return "Image question detected but screenshot capture failed, so image was not sent to model. Please retry.";
  }
  return "检测到图片题，但截图裁剪失败，未能把图片发送给模型。请重试。";
}

/**
 * Parse Router (M5 - Multi-Provider + Timeout + Retry + Streaming)
 */

import type { AppSettings, ParseResult, QuestionBlock } from "../types";
import { detectVisualKeywords } from "./ocr";
import { logEvent } from "./analytics";
import { PROVIDERS, getProvider } from "../ai/providers";
import type { ProviderConfig, ProviderId } from "../ai/providers";
import { decideRoute, hasSufficientPreviewText } from "../ai/routeDecision";
import { callAnthropic, callGemini, callOpenAICompat } from "../ai/providerClients";
import { buildResult } from "../ai/parseResult";
import { mockParse } from "../ai/mockParse";

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
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
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

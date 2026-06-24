import type { AppSettings, ParseResult, QuestionBlock, RouteUsed } from "../types";
import { buildUserQuestionPrompt, getSystemPrompt } from "./prompts";
import { getProvider } from "./providers";
import type { ProviderConfig } from "./providers";
import { buildResult } from "./parseResult";
import { logError, logWarn } from "../utils/errorLogger";

const REQUEST_TIMEOUT_MS = 30_000;
export async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
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

export function buildApiUrl(baseUrlRaw: string, endpoint: string): string {
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
// ---- Anthropic ----

export async function callAnthropic(
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
    system: getSystemPrompt(),
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

export async function callOpenAICompat(
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
      { role: "system", content: getSystemPrompt() },
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

export async function callGemini(
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
  parts.push({ text: `${getSystemPrompt()}\n\n${buildUserQuestionPrompt(block, route, settings)}` });

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


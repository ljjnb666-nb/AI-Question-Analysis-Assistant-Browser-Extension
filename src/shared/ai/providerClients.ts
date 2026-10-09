import type { ParseResult, QuestionBlock, RouteUsed } from "../types";
import { buildUserQuestionPrompt, getSystemPrompt } from "./prompts";
import { applyRuntimeAuth, redactRequestSecret, safeRequestLabel } from "./runtimeRequest";
import type { ProviderRequestContext } from "./runtimeRequest";
import { buildResult } from "./parseResult";
import { buildPreferredQuestionText } from "./questionPromptText";
import { buildSolverRequestContent } from "./questionPackage";
import type { SolverContentPart, SolverQuestionPackage } from "./questionPackage";
import { logError, logWarn } from "../utils/errorLogger";

const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Owns the entire provider attempt, including response body consumption.
 * Fetch resolving headers does NOT complete the request lease.
 */
export async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  context: ProviderRequestContext,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const signal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal;
  let timedOut = false;
  const timer = setTimeout(() => {
    if (!signal.aborted) {
      timedOut = true;
      controller.abort();
    }
  }, REQUEST_TIMEOUT_MS);
  let rejectInterrupted!: (reason: Error) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
  const onAbort = () => rejectInterrupted(new Error("AI_REQUEST_ABORTED"));
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    // Await the rejection so an already-aborted signal cannot leave an
    // unhandled rejected promise or accidentally dispatch a request.
    if (signal.aborted) await interrupted;
    await Promise.race([context.beforeDispatch(), interrupted]);
    if (signal.aborted) throw new Error("AI_REQUEST_ABORTED");
    const response = await Promise.race([
      fetch(url, { ...init, redirect: "error", signal }),
      interrupted,
    ]);
    const result = await Promise.race([consume(response, signal), interrupted]);
    if (signal.aborted) throw new Error("AI_REQUEST_ABORTED");
    return result;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err && typeof err.code === "string" ? err.code : undefined;
    const message = code?.startsWith("AI_") ? code : timedOut ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
      : signal.aborted ? "AI_REQUEST_ABORTED"
      : redactRequestSecret(err instanceof Error ? err.message : String(err), context.credential);
    const safeError = new Error(message);
    if (code) Object.assign(safeError, { code });
    else if (signal.aborted && !timedOut) Object.assign(safeError, { code: "AI_REQUEST_ABORTED" });
    safeError.name = err instanceof Error ? redactRequestSecret(err.name, context.credential) : "Error";
    logError(timedOut ? "Request timeout" : "Fetch failed", safeError, "fetchWithTimeout", { url: redactRequestSecret(safeRequestLabel(new URL(url)), context.credential) });
    throw safeError;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function readProviderJson<T>(response: Response): Promise<T> {
  try { return await response.json() as T; }
  catch { throw new Error("AI_PROVIDER_RESPONSE_INVALID"); }
}

async function boundedResponseError(res: Response, context: ProviderRequestContext): Promise<Error> {
  const reader = res.body?.getReader();
  let text = "";
  if (reader) {
    const decoder = new TextDecoder();
    let remaining = 8192;
    try {
      while (remaining > 0) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value.subarray(0, remaining), { stream: true });
        remaining -= value.byteLength;
      }
    } finally { await reader.cancel(); }
  }
  return new Error(`${context.runtime.protocol} API ${res.status}: ${redactRequestSecret(text, context.credential)}`);
}

function requestAuth(urlString: string, context: ProviderRequestContext, extraHeaders: Record<string, string> = {}) {
  const url = new URL(urlString);
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  applyRuntimeAuth(url, headers, context);
  return { url: url.href, headers };
}

export function buildApiUrl(baseUrlRaw: string, endpoint: string): string {
  const url = new URL(baseUrlRaw);
  const path = url.pathname.replace(/\/+$/, "");
  const suffix = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (!path.endsWith(suffix)) {
    const prefix = path.endsWith("/v1") && suffix.startsWith("/v1/") ? 3
      : path.endsWith("/v1beta") && suffix.startsWith("/v1beta/") ? 7 : 0;
    url.pathname = `${path}${suffix.slice(prefix)}`;
  }
  return url.href;
}
// ---- Anthropic ----

export async function callAnthropic(
  block: QuestionBlock,
  route: RouteUsed,
  context: ProviderRequestContext,
  onStream?: (partial: string) => void,
  questionPackage?: SolverQuestionPackage,
): Promise<ParseResult> {
  const baseUrl = context.runtime.endpoint;
  const content: unknown[] = [];

  const prompt = buildUserQuestionPrompt(block, route, context);
  if ((route === "vision" || route === "hybrid") && questionPackage) {
    for (const item of buildSolverRequestContent(prompt, questionPackage.media)) {
      if (item.type === "text") content.push({ type: "text", text: item.text });
      else {
        const inline = await asInlineImage(item);
        content.push({ type: "image", source: { type: "base64", media_type: inline.mimeType, data: inline.base64 } });
      }
    }
  } else if ((route === "vision" || route === "hybrid") && block.imageDataUrl) {
    const inline = await asInlineImage({ type: "image", assetId: "legacy", role: "stem", source: { kind: "data-url", dataUrl: block.imageDataUrl } });
    content.push({ type: "image", source: { type: "base64", media_type: inline.mimeType, data: inline.base64 } });
    content.push({ type: "text", text: prompt });
  } else content.push({ type: "text", text: prompt });

  // Some custom Anthropic-compatible gateways keep SSE connections open,
  // causing UI-side hangs. Prefer non-stream mode for custom provider.
  const useStream = !!onStream && context.runtime.presetId !== "custom";
  const requestBody = JSON.stringify({
    model: context.runtime.selectedModelId,
    max_tokens: 1024,
    stream: useStream,
    system: getSystemPrompt(),
    messages: [{ role: "user", content }],
  });

  const auth = requestAuth(buildApiUrl(baseUrl, "/v1/messages"), context, { "anthropic-version": "2023-06-01" });
  return fetchWithTimeout(auth.url, { method: "POST", headers: auth.headers, body: requestBody }, context, async (res, signal) => {
    if (!res.ok) throw await boundedResponseError(res, context);
    if (useStream && res.body) {
      const text = await consumeAnthropicStream(res.body, partial => onStream!(redactRequestSecret(partial, context.credential)), signal);
      return buildResult(block, route, redactRequestSecret(text, context.credential));
    }
    const data = await readProviderJson<{ content: Array<{ type: string; text?: string }> }>(res);
    return buildResult(block, route, redactRequestSecret(data.content.find(c => c.type === "text")?.text ?? "{}", context.credential));
  });
}

/**
 * SSE framing is based on blank-line-delimited events, not on fetch chunks or
 * individual data lines. Bound both an incomplete line and an entire event.
 * Never log provider data: it may contain question text or credentials.
 */
async function* readSseData(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const MAX_SSE_FRAME = 64 * 1024;
  let pendingLine = "";
  let dataLines: string[] = [];
  let eventLength = 0;
  let exhausted = false;

  function acceptLine(rawLine: string): string | null {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length > MAX_SSE_FRAME) throw new Error("AI_SSE_FRAME_TOO_LARGE");
    if (line === "") {
      if (dataLines.length === 0) return null;
      const frame = dataLines.join("\n");
      dataLines = [];
      eventLength = 0;
      return frame;
    }
    if (line.startsWith("data:") || line === "data") {
      let data = line === "data" ? "" : line.slice(5);
      if (data.startsWith(" ")) data = data.slice(1);
      eventLength += data.length + 1;
      if (eventLength > MAX_SSE_FRAME) throw new Error("AI_SSE_FRAME_TOO_LARGE");
      dataLines.push(data);
    }
    // Ignore SSE comments, event IDs, retry fields, and event types.
    return null;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error("AI_REQUEST_ABORTED");
      pendingLine += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let newline = pendingLine.indexOf("\n");
      while (newline >= 0) {
        if (signal.aborted) throw new Error("AI_REQUEST_ABORTED");
        const line = pendingLine.slice(0, newline);
        pendingLine = pendingLine.slice(newline + 1);
        const frame = acceptLine(line);
        if (frame !== null) {
          if (frame.trim() === "[DONE]") return;
          yield frame;
        }
        newline = pendingLine.indexOf("\n");
      }
      if (pendingLine.length > MAX_SSE_FRAME) throw new Error("AI_SSE_FRAME_TOO_LARGE");

      if (done) {
        // Some providers close immediately after their final data line.
        const lastFrame = pendingLine ? acceptLine(pendingLine) : null;
        const frame = lastFrame ?? (dataLines.length ? dataLines.join("\n") : null);
        exhausted = true;
        if (frame !== null && frame.trim() !== "[DONE]") yield frame;
        return;
      }
    }
  } finally {
    // A terminal marker, abort, malformed stream, or consumer exception must
    // not leave a live reader or late callback behind.
    if (!exhausted) {
      try { await reader.cancel(); } catch { /* best-effort stream shutdown */ }
    }
    reader.releaseLock();
  }
}

async function consumeAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onStream: (partial: string) => void,
  signal: AbortSignal,
): Promise<string> {
  let fullText = "";
  for await (const data of readSseData(body, signal)) {
    let evt: { type: string; delta?: { type: string; text?: string } };
    try { evt = JSON.parse(data) as typeof evt; }
    catch { logWarn("Malformed SSE event", "consumeAnthropicStream"); continue; }
    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
      if (signal.aborted) throw new Error("AI_REQUEST_ABORTED");
      fullText += evt.delta.text ?? "";
      onStream(fullText);
    }
  }
  return fullText;
}

// ---- OpenAI-compatible ----

export async function callOpenAICompat(
  block: QuestionBlock,
  route: RouteUsed,
  context: ProviderRequestContext,
  onStream?: (partial: string) => void,
  questionPackage?: SolverQuestionPackage,
): Promise<ParseResult> {
  const useVision = (route === "vision" || route === "hybrid");
  // Custom OpenAI-compatible endpoints may not fully support SSE semantics.
  // Disable stream for custom provider to avoid indefinite pending.
  const useStream = !!onStream && context.runtime.presetId !== "custom";

  // For non-vision providers, use simple string content
  let userContent: unknown;
  if (useVision && questionPackage) {
    const contentArray: unknown[] = [];
    for (const item of buildSolverRequestContent(buildUserQuestionPrompt(block, route, context), questionPackage.media)) {
      if (item.type === "text") contentArray.push({ type: "text", text: item.text });
      else contentArray.push({ type: "image_url", image_url: { url: await asOpenAIImageUrl(item, context.runtime.transportCapabilities.remoteImageUrl.value === true), detail: "high" } });
    }
    userContent = contentArray;
  } else if (useVision && block.imageDataUrl) {
    const contentArray: unknown[] = [];
    contentArray.push({ type: "image_url", image_url: { url: block.imageDataUrl, detail: "high" } });
    contentArray.push({ type: "text", text: buildUserQuestionPrompt(block, route, context) });
    userContent = contentArray;
  } else {
    // Simple string content for text-only providers
    userContent = buildUserQuestionPrompt(block, route, context);
  }

  const auth = requestAuth(buildApiUrl(context.runtime.endpoint, "/v1/chat/completions"), context);

  const requestBody: Record<string, unknown> = {
    model: context.runtime.selectedModelId,
    stream: useStream,
    messages: [
      { role: "system", content: getSystemPrompt() },
      { role: "user", content: userContent },
    ],
  };

  if (context.runtime.presetId === "minimax") {
    if (isMiniMaxCodeProblem(block)) {
      requestBody.max_completion_tokens = 2048;
    } else {
      requestBody.max_completion_tokens = 1024;
      requestBody.thinking = { type: "adaptive" };
      requestBody.reasoning_split = true;
    }
  } else {
    requestBody.max_tokens = 1024;
  }

  return fetchWithTimeout(auth.url, {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify(requestBody),
  }, context, async (res, signal) => {
    if (!res.ok) throw await boundedResponseError(res, context);
    if (useStream && res.body) {
      const text = await consumeOpenAIStream(res.body, partial => onStream!(redactRequestSecret(partial, context.credential)), signal);
      return buildResult(block, route, redactRequestSecret(text, context.credential));
    }
    const data = await readProviderJson<{ choices: Array<{ message: { content: string } }> }>(res);
    return buildResult(block, route, redactRequestSecret(data.choices?.[0]?.message?.content ?? "{}", context.credential));
  });
}

function isMiniMaxCodeProblem(block: QuestionBlock): boolean {
  if (block.questionTypeGuess !== "short_answer") return false;
  const text = buildPreferredQuestionText(block);
  return /(函数接口定义|裁判测试程序样例|输入格式|输出格式|输入样例|输出样例|样例输入|样例输出|代码长度限制|编写程序|完成函数)/.test(text);
}

async function consumeOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onStream: (partial: string) => void,
  signal: AbortSignal,
): Promise<string> {
  let fullText = "";
  for await (const data of readSseData(body, signal)) {
    let evt: { choices?: Array<{ delta?: { content?: string } }> };
    try { evt = JSON.parse(data) as typeof evt; }
    catch { logWarn("Malformed OpenAI SSE event", "consumeOpenAIStream"); continue; }
    const delta = evt.choices?.[0]?.delta?.content;
    if (delta) {
      if (signal.aborted) throw new Error("AI_REQUEST_ABORTED");
      fullText += delta;
      onStream(fullText);
    }
  }
  return fullText;
}

// ---- Gemini ----

export async function callGemini(
  block: QuestionBlock,
  route: RouteUsed,
  context: ProviderRequestContext,
  questionPackage?: SolverQuestionPackage,
): Promise<ParseResult> {
  const model = context.runtime.selectedModelId;
  const auth = requestAuth(buildApiUrl(context.runtime.endpoint, `/v1beta/models/${encodeURIComponent(model)}:generateContent`), context);

  const parts: unknown[] = [];
  const prompt = `${getSystemPrompt()}\n\n${buildUserQuestionPrompt(block, route, context)}`;
  if ((route === "vision" || route === "hybrid") && questionPackage) {
    for (const item of buildSolverRequestContent(prompt, questionPackage.media)) {
      if (item.type === "text") parts.push({ text: item.text });
      else {
        const inline = await asInlineImage(item);
        parts.push({ inline_data: { mime_type: inline.mimeType, data: inline.base64 } });
      }
    }
  } else if ((route === "vision" || route === "hybrid") && block.imageDataUrl) {
    const inline = await asInlineImage({ type: "image", assetId: "legacy", role: "stem", source: { kind: "data-url", dataUrl: block.imageDataUrl } });
    parts.push({ inline_data: { mime_type: inline.mimeType, data: inline.base64 } });
    parts.push({ text: prompt });
  } else parts.push({ text: prompt });

  return fetchWithTimeout(auth.url, {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.1 },
    }),
  }, context, async (res) => {
    if (!res.ok) throw await boundedResponseError(res, context);
    const data = await readProviderJson<{ candidates: Array<{ content: { parts: Array<{ text: string }> } }> }>(res);
    return buildResult(block, route, redactRequestSecret(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}", context.credential));
  });
}

async function asOpenAIImageUrl(item: Extract<SolverContentPart, { type: "image" }>, supportsRemote: boolean): Promise<string> {
  if (supportsRemote && item.source.kind === "remote-url") return item.source.url;
  const inline = await asInlineImage(item);
  return `data:${inline.mimeType};base64,${inline.base64}`;
}
async function asInlineImage(item: Extract<SolverContentPart, { type: "image" }>): Promise<{ mimeType: string; base64: string }> {
  if (item.source.kind === "data-url") {
    const match = item.source.dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
    return { mimeType: match[1].toLowerCase(), base64: match[2] };
  }
  if (item.source.kind === "serialized-svg") return { mimeType: "image/svg+xml", base64: bytesToBase64(new TextEncoder().encode(item.source.svg)) };
  // Remote acquisition belongs exclusively to prepareQuestionPackageForProvider.
  if (item.source.kind === "remote-url") throw new Error("MEDIA_SOURCE_UNAVAILABLE");
  throw new Error("MEDIA_SOURCE_UNAVAILABLE");
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}


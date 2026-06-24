import type { AppSettings, ParseResult, QuestionBlock } from "@/shared/types";
import type { AnalyticsEvent } from "@/shared/utils/analytics";

type StreamCallback = (partial: string) => void;

type ParseRetryDeps = {
  logEvent: (event: AnalyticsEvent, payload?: Record<string, unknown>) => void;
  parseQuestion: (
    block: QuestionBlock,
    settings: AppSettings,
    onStream?: StreamCallback,
  ) => Promise<ParseResult>;
  setStreamingText: (text: string) => void;
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, timeoutReason: string) => Promise<T>;
};

export async function parseWithStreamingFallback(
  block: QuestionBlock,
  settings: AppSettings,
  onStream: StreamCallback,
  timeoutMs: number,
  deps: ParseRetryDeps,
): Promise<ParseResult> {
  try {
    return await deps.withTimeout(
      deps.parseQuestion(block, settings, onStream),
      timeoutMs,
      "stream_timeout",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/stream_timeout/i.test(msg)) throw err;
    deps.logEvent("parse_stream_timeout_fallback", { blockId: block.id, timeoutMs });
    deps.setStreamingText("流式响应超时，正在切换为普通请求重试...");
    return deps.withTimeout(
      deps.parseQuestion(block, settings),
      Math.max(8_000, Math.floor(timeoutMs * 0.9)),
      "non_stream_timeout",
    );
  }
}

export async function parseWithTieredRetries(
  block: QuestionBlock,
  settings: AppSettings,
  providerSupportsVision: boolean,
  onStream: StreamCallback,
  tierTimeoutsMs: readonly number[],
  deps: ParseRetryDeps,
): Promise<ParseResult> {
  const preferred = settings.preferredRoute;
  const routePlan: Array<"text" | "auto" | "vision"> = [];
  if (preferred === "text") {
    routePlan.push("text", providerSupportsVision ? "vision" : "auto", "auto");
  } else if (preferred === "vision") {
    routePlan.push("vision", "auto", "vision");
  } else {
    routePlan.push("auto", providerSupportsVision ? "vision" : "text", "auto");
  }

  let lastErr: unknown = null;
  for (let i = 0; i < tierTimeoutsMs.length; i++) {
    const timeoutMs = tierTimeoutsMs[i];
    const route = routePlan[i] ?? preferred;
    const tierSettings = { ...settings, preferredRoute: route as "auto" | "text" | "vision" };

    deps.logEvent("manual_parse_attempt_started", {
      blockId: block.id,
      attempt: i + 1,
      timeoutMs,
      route,
      hasImageDataUrl: Boolean(block.imageDataUrl),
      previewTextLen: (block.previewText || "").length,
    });
    console.info("[ManualParse] attempt start", {
      blockId: block.id,
      attempt: i + 1,
      timeoutMs,
      route,
      hasImageDataUrl: Boolean(block.imageDataUrl),
    });

    try {
      deps.setStreamingText(`第 ${i + 1} 次尝试：${route} 路由，超时 ${Math.round(timeoutMs / 1000)}s...`);
      const startedAt = Date.now();
      const result = await parseWithStreamingFallback(block, tierSettings, onStream, timeoutMs, deps);
      const elapsedMs = Date.now() - startedAt;
      deps.logEvent("manual_parse_attempt_succeeded", {
        blockId: block.id,
        attempt: i + 1,
        timeoutMs,
        route,
        elapsedMs,
        confidence: result.confidence,
        answer: result.answer,
        routeUsed: result.routeUsed,
      });
      console.info("[ManualParse] attempt success", {
        blockId: block.id,
        attempt: i + 1,
        timeoutMs,
        route,
        elapsedMs,
        answer: result.answer,
        confidence: result.confidence,
        routeUsed: result.routeUsed,
      });
      return result;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      deps.logEvent("manual_parse_attempt_failed", {
        blockId: block.id,
        attempt: i + 1,
        timeoutMs,
        route,
        error: msg.slice(0, 500),
      });
      console.warn("[ManualParse] attempt failed", {
        blockId: block.id,
        attempt: i + 1,
        timeoutMs,
        route,
        error: msg,
      });
      if (i < tierTimeoutsMs.length - 1) {
        deps.setStreamingText(
          `第 ${i + 1} 次失败：${msg.slice(0, 80)}\n正在第 ${i + 2} 次重试（${routePlan[i + 1]} / ${tierTimeoutsMs[i + 1] / 1000}s）...`,
        );
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "parse_failed"));
}

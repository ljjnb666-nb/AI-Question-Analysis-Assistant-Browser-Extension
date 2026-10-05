/**
 * Parse Router (M5 - Multi-Provider + Timeout + Retry + Streaming)
 */

import type { ParseResult, QuestionBlock } from "../types";
import { buildResult } from "../ai/parseResult";
import { callAnthropic, callGemini, callOpenAICompat } from "../ai/providerClients";
import { decideRoute, hasSufficientPreviewText } from "../ai/routeDecision";
import { mockParse } from "../ai/mockParse";
import {
  getProviderNotConfiguredMessage,
  isParseResultFillAuthoritative,
} from "../ai/parseResultAuthority";
import { classifyAnalyticsFailure, logEvent } from "./analytics";
import { ensureAIConnectionAuthorityReady } from "./aiConnectionClient";
import { resolveActiveAIConnectionRuntimeMetadata, resolveRuntimeCredential, assertRuntimeConfigCurrent } from "./aiRuntimeResolver";
import type { AIConnectionRuntimeConfig } from "../types/connection";
import type { ParsePreferences, ProviderRequestContext } from "../ai/runtimeRequest";
import { AIRequestBoundaryError, redactRequestSecret, validateRuntimeEndpoint, validateRuntimeAuth } from "../ai/runtimeRequest";
import { planWireMediaDelivery, resolveEffectiveMediaCapability } from "../ai/effectiveMediaCapability";
export type { ParsePreferences } from "../ai/runtimeRequest";
import type { SolverQuestionPackage } from "../ai/questionPackage";
import type { QuestionScreenshotFallback } from "../ai/questionPackage";
import { buildSolverQuestionPackage } from "../../content/solver/questionPackageBuilder";
import { prepareQuestionPackageForProvider } from "../ai/providerMediaPreparation";
import { ProviderNotConfiguredError, StaleQuestionRevisionError } from "./parseAttemptErrors";

export {
  decideRoute,
  hasSufficientPreviewText,
  buildResult,
  mockParse,
  isParseResultFillAuthoritative,
};
export { getParseResultAuthority, getUnfillableResultCode } from "../ai/parseResultAuthority";
export { PROVIDER_NOT_CONFIGURED, ProviderNotConfiguredError, isProviderNotConfiguredError } from "./parseAttemptErrors";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;
export type SolveAuthorityLease = Readonly<{ kind: "solve-authority" }>;
const solveRuntimes = new WeakMap<SolveAuthorityLease, AIConnectionRuntimeConfig>();

export function withSolveAuthorityLease(context?: ParseQuestionRuntimeContext): ParseQuestionRuntimeContext {
  return { ...context, authorityLease: context?.authorityLease ?? Object.freeze({ kind: "solve-authority" as const }) };
}

export type ParseQuestionRuntimeContext = {
  authorityLease?: SolveAuthorityLease;
  signal?: AbortSignal;
  screenshotFallback?: QuestionScreenshotFallback;
  isQuestionRevisionCurrent?: (identity: { questionId: string; contentFingerprint: string }) => boolean;
  /** Let the owning workflow report success only after its result commit fence. */
  deferSuccessTelemetry?: boolean;
  /**
   * UI-00A: demo/mock output requires an explicit opt-in. Normal production
   * parses (Side Panel, Batch Parse, Auto Solve, connection tests) must never
   * set this; an unconfigured required-key provider fails closed instead.
   */
  allowDemo?: boolean;
};

export async function parseQuestion(
  block: QuestionBlock,
  settings: ParsePreferences,
  onStream?: (partial: string) => void,
  runtimeContext?: ParseQuestionRuntimeContext,
): Promise<ParseResult> {
  if (isRuntimeContextStale(block, runtimeContext)) throw new StaleQuestionRevisionError();
  const runtime = await resolveSolveRuntime(settings, runtimeContext);
  // Canonical auto-detected questions must hydrate their owned media before a
  // provider call. Manual/legacy capture intentionally remains on its old path.
  if (block.source !== "manual_capture" && block.mediaAssets?.length) {
    if (block.completeness?.state !== "complete") throw new Error("QUESTION_NOT_ELIGIBLE");
    const built = await buildSolverQuestionPackage(block, { signal: runtimeContext?.signal });
    if (isRuntimeContextStale(block, runtimeContext)) throw new StaleQuestionRevisionError();
    if (!built.ok) throw new Error(built.code);
    return parseQuestionCore(block, settings, onStream, built.package, runtimeContext, runtime);
  }
  return parseQuestionCore(block, settings, onStream, undefined, runtimeContext, runtime);
}

export async function parseQuestionPackage(
  questionPackage: SolverQuestionPackage,
  block: QuestionBlock,
  settings: ParsePreferences,
  onStream?: (partial: string) => void,
  runtimeContext?: ParseQuestionRuntimeContext,
): Promise<ParseResult> {
  if (isRuntimeContextStale(block, runtimeContext, questionPackage)) throw new StaleQuestionRevisionError();
  return parseQuestionCore(block, settings, onStream, questionPackage, runtimeContext, await resolveSolveRuntime(settings, runtimeContext));
}

async function parseQuestionCore(
  block: QuestionBlock,
  settings: ParsePreferences,
  onStream: ((partial: string) => void) | undefined,
  questionPackage: SolverQuestionPackage | undefined,
  runtimeContext: ParseQuestionRuntimeContext | undefined,
  runtime: AIConnectionRuntimeConfig | null,
): Promise<ParseResult> {
  let route = await decideRoute(block, settings);
  if (isRuntimeContextStale(block, runtimeContext, questionPackage)) throw new StaleQuestionRevisionError();
  if (!runtime) {
    const result = await mockParse(block, route);
    if (isRuntimeContextStale(block, runtimeContext, questionPackage)) throw new StaleQuestionRevisionError();
    return result;
  }
  const provider = { id: runtime.presetId };
  const canonicalMedia = Boolean(questionPackage?.media.length);
  if (canonicalMedia && settings.preferredRoute === "text") throw new Error("CANONICAL_MEDIA_REQUIRES_VISION");
  if (canonicalMedia && settings.preferredRoute === "auto") route = "vision";
  if (!questionPackage && block.imageDataUrl && route !== "text") {
    questionPackage = {
      schemaVersion: 1, questionId: block.identity?.stableId ?? block.id,
      contentFingerprint: block.identity?.contentFingerprint ?? block.id,
      questionType: block.questionTypeGuess, text: block.previewText,
      media: [{ assetId: "manual-capture", role: "stem", contentFingerprint: block.identity?.contentFingerprint ?? block.id,
        source: { kind: "data-url", dataUrl: block.imageDataUrl } }],
    };
  }
  if (questionPackage?.media.length) {
    const remoteSourceCount = questionPackage.media.filter(part => part.source.kind === "remote-url").length;
    const plan = planWireMediaDelivery({ inlineSourceCount: questionPackage.media.length - remoteSourceCount, remoteSourceCount }, runtime.transportCapabilities);
    const capability = resolveEffectiveMediaCapability({ model: runtime.modelCapabilityAssessment, transport: runtime.transportCapabilities, ...plan });
    if (!capability.canProcess) throw new AIRequestBoundaryError(capability.failCode!);
    const prepared = await prepareQuestionPackageForProvider(questionPackage, plan, runtimeContext);
    if (!prepared.ok) throw new Error(prepared.code);
    questionPackage = prepared.package;
    const actualRemote = questionPackage.media.filter(part => part.source.kind === "remote-url").length;
    const actualCapability = resolveEffectiveMediaCapability({ model: runtime.modelCapabilityAssessment, transport: runtime.transportCapabilities,
      wireInlineImageCount: questionPackage.media.length - actualRemote, wireRemoteImageCount: actualRemote });
    if (!actualCapability.canProcess) throw new AIRequestBoundaryError(actualCapability.failCode!);
  } else if (settings.preferredRoute === "vision" || (route !== "text" && block.hasImage)) {
    const vision = runtime.modelCapabilityAssessment.vision;
    if (vision.value === null) throw new AIRequestBoundaryError("AI_MODEL_CAPABILITY_UNKNOWN");
    if (!vision.value) throw new AIRequestBoundaryError("AI_MODEL_VISION_UNSUPPORTED");
    if (route === "vision" && block.hasImage) throw new Error(getMissingScreenshotMessage(settings.language));
  }
  if (isRuntimeContextStale(block, runtimeContext, questionPackage)) throw new StaleQuestionRevisionError();
  logEvent(`route_used_${route}` as "route_used_text", { blockId: block.id, provider: runtime.presetId });

  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      logEvent("parse_error", { attempt, category: classifyAnalyticsFailure(lastError), provider: provider.id, route });
    }

    let providerResultAvailable = false;
    let providerDispatchStarted = false;
    try {
      if (isRuntimeContextStale(block, runtimeContext, questionPackage)) throw new Error("STALE_QUESTION_REVISION");
      let result: ParseResult;
      const context: ProviderRequestContext = {
        runtime, credential: await resolveRuntimeCredential(runtime), language: settings.language,
        signal: runtimeContext?.signal,
        beforeDispatch: async () => {
          await assertRuntimeConfigCurrent(runtime);
          if (isRuntimeContextStale(block, runtimeContext, questionPackage)) throw new StaleQuestionRevisionError();
          providerDispatchStarted = true;
        },
      };
      try {
        switch (runtime.protocol) {
          case "anthropic_messages": result = await callAnthropic(block, route, context, onStream, questionPackage); break;
          case "gemini_generate_content": result = await callGemini(block, route, context, questionPackage); break;
          case "openai_chat_completions": result = await callOpenAICompat(block, route, context, onStream, questionPackage); break;
          default: throw new AIRequestBoundaryError("AI_PROTOCOL_UNSUPPORTED");
        }
      } catch (error) {
        const safe = new Error(redactRequestSecret(error instanceof Error ? error.message : "AI_REQUEST_FAILED", context.credential));
        if (error && typeof error === "object" && "code" in error) Object.assign(safe, { code: error.code });
        throw safe;
      } finally { context.credential = null; }
      // UI-00A single provenance boundary: only a result that survived a real
      // provider execution becomes fill-authoritative. Adapters never stamp
      // this themselves.
      result = { ...result, resultSource: "provider" };
      providerResultAvailable = true;
      if (isRuntimeContextStale(block, runtimeContext, questionPackage)) {
        logEvent("provider_result_discarded_stale", { blockId: block.id, route, provider: provider.id });
        throw new StaleQuestionRevisionError();
      }

      const duration = Date.now() - startTime;
      if (!runtimeContext?.deferSuccessTelemetry) {
        logEvent("parse_success", { route, provider: provider.id, duration, attempt });
      }
      return result;
    } catch (err) {
      if (isRuntimeContextStale(block, runtimeContext, questionPackage)) {
        if ((providerResultAvailable || providerDispatchStarted) && !(err instanceof StaleQuestionRevisionError)) {
          // Aborting an already dispatched stale request also discards its
          // transport result; retain the existing diagnostic without success.
          logEvent("provider_result_discarded_stale", { blockId: block.id, route, provider: provider.id, cancelled: !providerResultAvailable });
        }
        lastError = new StaleQuestionRevisionError();
        break;
      }
      lastError = err instanceof Error ? err : new Error("AI_REQUEST_FAILED");
      if (/^AI_/.test(lastError.message) || (err && typeof err === "object" && "code" in err && String(err.code).startsWith("AI_"))) break;
      if (/^(?:MEDIA_SOURCE_UNAVAILABLE|MEDIA_BLOCKED|MEDIA_BUDGET_EXCEEDED|STALE_QUESTION_REVISION|CANONICAL_MEDIA_REQUIRES_VISION|MEDIA_REQUIRES_VISION|QUESTION_NOT_ELIGIBLE)/.test(lastError.message)) break;
      const is4xx = lastError.message.includes(" 4") && !lastError.message.includes("429");
      if (is4xx) break;
    }
  }

  if (!(lastError instanceof StaleQuestionRevisionError)) {
    logEvent("parse_error", { category: classifyAnalyticsFailure(lastError), exhausted: true });
  }
  throw lastError ?? new Error("Parse failed after retries");
}

async function resolveSolveRuntime(settings: ParsePreferences, context?: ParseQuestionRuntimeContext): Promise<AIConnectionRuntimeConfig | null> {
  try {
    await ensureAIConnectionAuthorityReady();
    const expected = context?.authorityLease && solveRuntimes.get(context.authorityLease);
    if (expected) {
      await assertRuntimeConfigCurrent(expected);
      validateRuntimeEndpoint(expected.endpoint);
      validateRuntimeAuth(expected);
      return expected;
    }
    const runtime = await resolveActiveAIConnectionRuntimeMetadata();
    validateRuntimeEndpoint(runtime.endpoint);
    validateRuntimeAuth(runtime);
    if (context?.authorityLease) solveRuntimes.set(context.authorityLease, runtime);
    return runtime;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (["AI_CREDENTIAL_REQUIRED", "AI_ACTIVE_CONNECTION_MISSING"].includes(code)) {
      if (context?.allowDemo === true) return null;
      throw new ProviderNotConfiguredError(getProviderNotConfiguredMessage(settings.language));
    }
    throw error;
  }
}

function isRuntimeContextStale(
  block: QuestionBlock,
  runtimeContext?: ParseQuestionRuntimeContext,
  questionPackage?: SolverQuestionPackage,
): boolean {
  if (runtimeContext?.signal?.aborted) return true;
  const identity = {
    questionId: questionPackage?.questionId ?? block.identity?.stableId ?? block.id,
    contentFingerprint: questionPackage?.contentFingerprint ?? block.identity?.contentFingerprint ?? block.id,
  };
  return runtimeContext?.isQuestionRevisionCurrent?.(identity) === false;
}

export function normalizeNetworkError(
  err: unknown,
  runtime: Pick<AIConnectionRuntimeConfig, "endpoint" | "presetId">,
  settings: ParsePreferences,
): Error {
  const error = err instanceof Error ? err : new Error(String(err));
  const message = String(error.message || "");
  if (!/failed to fetch/i.test(message)) {
    return error;
  }

  const language = settings.language;
  const baseUrl = runtime.endpoint.trim();
  const usingLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(baseUrl);
  const usingHttp = /^http:\/\//i.test(baseUrl);
  const host = getEndpointHostLabel(baseUrl);

  if (language === "en") {
    if (usingLocalhost) {
      return new Error(
        `Network request failed (provider: ${runtime.presetId}, endpoint: ${host}). Local service seems unreachable. Verify local API service is running and base URL is correct.`,
      );
    }
    if (usingHttp) {
      return new Error(
        `Network request failed (provider: ${runtime.presetId}, endpoint: ${host}). Insecure HTTP endpoint may be blocked. Prefer HTTPS endpoint.`,
      );
    }
    return new Error(
      `Network request failed (provider: ${runtime.presetId}, endpoint: ${host}). Check API endpoint, API key, and current network.`,
    );
  }

  if (usingLocalhost) {
    return new Error(
      `网络请求失败（提供商：${runtime.presetId}，地址：${host}）。本地服务似乎不可达，请确认本地 API 服务已启动且 Base URL 正确。`,
    );
  }
  if (usingHttp) {
    return new Error(
      `网络请求失败（提供商：${runtime.presetId}，地址：${host}）。HTTP 明文地址可能被拦截，建议改为 HTTPS。`,
    );
  }
  return new Error(
    `网络请求失败（提供商：${runtime.presetId}，地址：${host}）。请检查 API 地址、API Key 与当前网络连接。`,
  );
}


function getEndpointHostLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || "(unknown)";
  } catch {
    return "(unknown)";
  }
}

function getMissingScreenshotMessage(language: ParsePreferences["language"]): string {
  if (language === "en") {
    return "Image question detected but screenshot capture failed, so image was not sent to model. Please retry.";
  }
  return "检测到图片题，但截图裁剪失败，未能把图片发送给模型。请重试。";
}

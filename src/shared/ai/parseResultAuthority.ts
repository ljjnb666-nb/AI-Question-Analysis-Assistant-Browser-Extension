import type { AppSettings, ParseResult } from "../types";
import type { ProviderConfig } from "./providers";

/**
 * UI-00A result provenance authority.
 *
 * A ParseResult may only mutate a real page when its provenance proves a real
 * provider execution. Provenance is carried by the result itself
 * (`resultSource`), never inferred from current settings or string heuristics:
 * a mock result produced before the user configured a key must stay unfillable
 * after the key exists, and a legacy result of unknown origin must never gain
 * authority by merely re-reading storage.
 */

/** Machine-readable rejection codes — never shown to users as primary copy. */
export const DEMO_RESULT_NOT_FILLABLE = "DEMO_RESULT_NOT_FILLABLE" as const;
export const UNVERIFIED_RESULT_SOURCE = "UNVERIFIED_RESULT_SOURCE" as const;

export type UnfillableResultCode = typeof DEMO_RESULT_NOT_FILLABLE | typeof UNVERIFIED_RESULT_SOURCE;

export type ParseResultAuthority = "provider" | "mock" | "legacy-unknown";

export function getParseResultAuthority(result: Pick<ParseResult, "resultSource">): ParseResultAuthority {
  if (result.resultSource === "provider") return "provider";
  if (result.resultSource === "mock") return "mock";
  return "legacy-unknown";
}

/** Only a provable provider result may enter the existing Fill authority flow. */
export function isParseResultFillAuthoritative(result: Pick<ParseResult, "resultSource">): boolean {
  return getParseResultAuthority(result) === "provider";
}

export function getUnfillableResultCode(result: Pick<ParseResult, "resultSource">): UnfillableResultCode {
  return getParseResultAuthority(result) === "mock" ? DEMO_RESULT_NOT_FILLABLE : UNVERIFIED_RESULT_SOURCE;
}

/**
 * Shared provider runtime-configuration check (UI-00A). Provider contract owns
 * the semantics: a key-optional provider (e.g. Ollama) is always configured;
 * every other provider needs a non-empty key. Popup, Side Panel, and the parse
 * router must all ask this one question instead of copying `Boolean(apiKey)`.
 */
export function isProviderRuntimeConfigured(
  provider: Pick<ProviderConfig, "keyOptional">,
  settings: Pick<AppSettings, "apiKey">,
): boolean {
  if (provider.keyOptional === true) return true;
  return String(settings.apiKey ?? "").trim().length > 0;
}

/** Natural-language hint for an unconfigured provider, keyed by UI language. */
export function getProviderNotConfiguredMessage(language: AppSettings["language"]): string {
  if (language === "en") {
    return "Please select an AI provider and enter your API Key in Settings before parsing.";
  }
  return "请先在设置中选择 AI 提供商并填写 API Key，再进行解析。";
}

/** Natural-language hint for the Settings connection test. */
export function getConnectionTestNotConfiguredMessage(language: AppSettings["language"]): string {
  if (language === "en") {
    return "Please enter your API Key before testing the connection.";
  }
  return "请先填写 API Key，再测试连接。";
}

/** Natural-language hint for starting Auto Solve without a provider. */
export function getAutoSolveNotConfiguredMessage(language: AppSettings["language"]): string {
  if (language === "en") {
    return "Configure an AI provider in Settings before starting Solve & Fill.";
  }
  return "请先配置 AI 服务，再启动解析并填答。";
}

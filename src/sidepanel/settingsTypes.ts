import type { AppSettings } from "@/shared/types";
import type { ProviderId } from "@/shared/ai/providers";
import type { UserFeedback } from "@/shared/ui/userFeedback";

export type SetupStatus =
  | "not_configured"
  | "incomplete"
  | "saved_untested"
  | "testing"
  | "validated"
  | "error";

export interface SettingsFormValues {
  providerId: ProviderId;
  apiKey: string;
  apiModel: string;
  preferredRoute: "auto" | "text" | "vision";
  customBaseUrl: string;
  analyticsBaseUrl: string;
  enableAnalytics: boolean;
  customProviderProtocol: "openai" | "anthropic";
  language: "zh" | "en";
}

export interface ValidationFingerprintInput {
  providerId: ProviderId;
  apiKey: string;
  apiModel: string;
  customBaseUrl?: string;
  customProviderProtocol?: "openai" | "anthropic";
}

/**
 * Deterministically computes the validation fingerprint covering all provider-runtime-relevant
 * authority configuration fields: providerId, apiKey, apiModel, customBaseUrl, and customProviderProtocol.
 */
export function computeValidationFingerprint(
  input: ValidationFingerprintInput | null | undefined,
): string {
  if (!input) return "";
  return JSON.stringify({
    providerId: input.providerId ?? "",
    apiKey: (input.apiKey ?? "").trim(),
    apiModel: (input.apiModel ?? "").trim(),
    customBaseUrl: (input.customBaseUrl ?? "").trim(),
    customProviderProtocol: input.customProviderProtocol ?? "openai",
  });
}

/**
 * Derives current setup status based on runtime provider configuration,
 * dirty state, testing state, validation authority, and test feedback.
 */
export function deriveSetupStatus(params: {
  isConfigured: boolean;
  isDirty: boolean;
  testing: boolean;
  testResult: UserFeedback | null;
  savedOnce: boolean;
  isValidated?: boolean;
}): SetupStatus {
  const { isConfigured, isDirty, testing, testResult, savedOnce, isValidated = false } = params;

  if (testing) return "testing";

  if (testResult) {
    if (testResult.tone === "success") {
      if (isValidated) return "validated";
      return isDirty ? "incomplete" : "saved_untested";
    }
    return "error";
  }

  if (!isConfigured) {
    return "not_configured";
  }

  if (isDirty) {
    return "incomplete";
  }

  if (savedOnce) {
    return "saved_untested";
  }

  return "saved_untested";
}

/**
 * Checks whether form inputs differ from storage values.
 */
export function isSettingsDirty(
  current: SettingsFormValues,
  stored: Partial<AppSettings> | null,
): boolean {
  if (!stored) return false;
  if (current.providerId !== (stored.providerId ?? "anthropic")) return true;
  if (current.apiKey !== (stored.apiKey ?? "")) return true;
  if (current.apiModel !== (stored.apiModel ?? "")) return true;
  if (current.preferredRoute !== (stored.preferredRoute ?? "auto")) return true;
  if (current.customBaseUrl !== (stored.customBaseUrl ?? "")) return true;
  if (current.customProviderProtocol !== (stored.customProviderProtocol ?? "openai")) return true;
  if (current.enableAnalytics !== (stored.enableAnalytics ?? false)) return true;
  if (current.language !== (stored.language ?? "zh")) return true;
  return false;
}

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

/**
 * Non-secret authority validation receipt.
 * Binds strictly to backend single-writer authority revisions, never secret material.
 */
export interface AuthorityValidationReceipt {
  connectionId: string;
  connectionRevision: number;
  credentialRevision?: number;
  validationGeneration?: number;
}

/**
 * Deterministically computes the authority validation fingerprint covering ONLY
 * non-secret authority revisions: connectionId, connectionRevision, credentialRevision,
 * and optional validation generation. Plaintext secrets are strictly excluded.
 */
export function computeAuthorityValidationFingerprint(
  receipt: AuthorityValidationReceipt | null | undefined,
): string {
  if (!receipt) return "";
  return [
    receipt.connectionId,
    receipt.connectionRevision,
    receipt.credentialRevision ?? 0,
    receipt.validationGeneration ?? 0,
  ].join(":");
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

  if (isValidated) {
    return "validated";
  }

  if (savedOnce) {
    return "saved_untested";
  }

  return "saved_untested";
}

export type StoredSettingsLike = Partial<
  AppSettings & {
    providerId?: ProviderId;
    apiKey?: string;
    apiModel?: string;
    customBaseUrl?: string;
    customProviderProtocol?: "openai" | "anthropic";
  }
>;

/**
 * Checks whether form inputs differ from storage values.
 */
export function isSettingsDirty(
  current: SettingsFormValues,
  stored: StoredSettingsLike | null,
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

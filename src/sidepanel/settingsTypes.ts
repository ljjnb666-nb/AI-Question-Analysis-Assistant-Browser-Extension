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
 * Frontend-only coherence check: returns true only when two metadata snapshots
 * represent the exact same backend authority revision (id, connectionRevision,
 * credentialRevision, and optional validation.generation).
 *
 * Used inside the coherent-read window (metaBefore → editor → metaAfter) to
 * detect mid-refresh authority changes that the generation fence alone cannot
 * catch.
 */
export function sameAuthoritySnapshot(
  a: { id: string; connectionRevision: number; credentialRevision?: number; validation?: { generation?: number } } | null | undefined,
  b: { id: string; connectionRevision: number; credentialRevision?: number; validation?: { generation?: number } } | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.id !== b.id) return false;
  if (a.connectionRevision !== b.connectionRevision) return false;
  if ((a.credentialRevision ?? 0) !== (b.credentialRevision ?? 0)) return false;
  // If both expose validation.generation, require equality
  if (
    a.validation?.generation !== undefined &&
    b.validation?.generation !== undefined &&
    a.validation.generation !== b.validation.generation
  ) return false;
  return true;
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

/**
 * Stable error contract between auth network calls and UI feedback.
 * Raw server messages and browser errors must never reach the UI verbatim;
 * callers translate the classified kind into localized, safe copy.
 */
export type AuthFeedbackKind =
  | "timeout"
  | "rate_limited"
  | "email_service_unavailable"
  | "network"
  | "invalid_credentials"
  | "email_already_registered"
  | "invalid_verification_code"
  | "password_too_short"
  | "email_invalid"
  | "generic";

const KNOWN_SAFE_ERROR_CODES = new Set([
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_SERVICE_UNAVAILABLE",
  "AUTH_SESSION_INVALID",
  "AUTH_RATE_LIMITED",
  "AUTH_MALFORMED_RESPONSE",
  "AUTH_SEND_CODE_FAILED",
  "AUTH_REQUEST_TIMEOUT",
  "AUTH_NETWORK_ERROR",
  "EMAIL_SERVICE_UNAVAILABLE",
]);

export function classifyAuthError(error: unknown): AuthFeedbackKind {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (message === "AUTH_REQUEST_TIMEOUT") return "timeout";
  if (message === "AUTH_NETWORK_ERROR") return "network";
  if (message === "AUTH_RATE_LIMITED") return "rate_limited";
  if (message === "EMAIL_SERVICE_UNAVAILABLE") return "email_service_unavailable";
  if (message === "AUTH_INVALID_CREDENTIALS") return "invalid_credentials";
  if (message === "email already registered") return "email_already_registered";
  if (message === "invalid verification code" || message === "invalid or expired verification code") return "invalid_verification_code";
  if (message === "password must be at least 6 characters") return "password_too_short";
  if (message === "email is required" || message === "invalid email address") return "email_invalid";

  // Registration errors are deliberate, user-facing server contract strings;
  // anything else (including internal config text) collapses to generic copy.
  return "generic";
}

/**
 * True when the message is one of the stable codes this module produced or
 * forwards. Used to guarantee feedback never embeds raw server internals.
 */
export function isKnownAuthErrorCode(message: string): boolean {
  return KNOWN_SAFE_ERROR_CODES.has(message);
}

export const AUTH_REQUEST_TIMEOUT_MS = 12_000;

export type AuthRequestErrorKind = "timeout" | "network";

/**
 * Network-level auth failures carry a stable message instead of a browser
 * error string, so UI feedback can stay safe and localizable.
 */
export class AuthRequestError extends Error {
  readonly kind: AuthRequestErrorKind;

  constructor(kind: AuthRequestErrorKind) {
    super(kind === "timeout" ? "AUTH_REQUEST_TIMEOUT" : "AUTH_NETWORK_ERROR");
    this.name = "AuthRequestError";
    this.kind = kind;
  }
}

export type AuthJsonResponse = {
  status: number;
  ok: boolean;
  payload: unknown;
};

/**
 * fetch + JSON parsing with a hard client timeout. Auth requests must never
 * pend forever: a hung request resolves as AUTH_REQUEST_TIMEOUT so the UI can
 * offer a retry instead of a stuck spinner.
 */
export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = AUTH_REQUEST_TIMEOUT_MS,
): Promise<AuthJsonResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) throw new AuthRequestError("timeout");
      throw new AuthRequestError("network");
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, ok: response.ok, payload };
  } finally {
    clearTimeout(timer);
  }
}

export function readAuthErrorMessage(payload: unknown): string {
  const error = (payload as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : "";
}

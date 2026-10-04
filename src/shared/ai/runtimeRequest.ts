import type { AppSettings } from "../types";
import type { AIConnectionRuntimeConfig } from "../types/connection";

/** The only AppSettings fields with authority over a solve request. */
export type ParsePreferences = Pick<AppSettings, "preferredRoute" | "language">;

/** Attempt-local credential. Never persist or retain this context between retries. */
export interface ProviderRequestContext {
  runtime: AIConnectionRuntimeConfig;
  credential: string | null;
  language: AppSettings["language"];
  beforeDispatch: () => Promise<void>;
  signal?: AbortSignal;
}

export class AIRequestBoundaryError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AIRequestBoundaryError";
  }
}

/** Validate the actual URL hostname before any credential is resolved. */
export function validateRuntimeEndpoint(endpoint: string): URL {
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new AIRequestBoundaryError("AI_ENDPOINT_INVALID"); }
  if (url.username || url.password) throw new AIRequestBoundaryError("AI_ENDPOINT_USERINFO_FORBIDDEN");
  if (url.protocol === "https:") return url;
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "[::1]" ||
    /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host);
  if (url.protocol !== "http:" || !loopback) {
    throw new AIRequestBoundaryError("AI_ENDPOINT_INSECURE");
  }
  return url;
}

export function validateRuntimeAuth(runtime: AIConnectionRuntimeConfig): void {
  switch (runtime.authScheme.kind) {
    case "none":
    case "bearer": return;
    case "header":
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(runtime.authScheme.headerName)) {
        throw new AIRequestBoundaryError("AI_AUTH_HEADER_INVALID");
      }
      return;
    case "query":
      if (!runtime.authScheme.parameterName.trim()) throw new AIRequestBoundaryError("AI_AUTH_QUERY_INVALID");
      return;
    default: throw new AIRequestBoundaryError("AI_AUTH_SCHEME_UNSUPPORTED");
  }
}

export function applyRuntimeAuth(
  url: URL,
  headers: Record<string, string>,
  context: ProviderRequestContext,
): void {
  validateRuntimeAuth(context.runtime);
  const auth = context.runtime.authScheme;
  if (auth.kind === "none") return;
  if (!context.credential) throw new AIRequestBoundaryError("AI_CREDENTIAL_UNAVAILABLE");
  switch (auth.kind) {
    case "bearer": headers.Authorization = `Bearer ${context.credential}`; break;
    case "header":
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === auth.headerName.toLowerCase()) delete headers[name];
      }
      Object.defineProperty(headers, auth.headerName, { value: context.credential, enumerable: true, configurable: true, writable: true });
      break;
    case "query": url.searchParams.set(auth.parameterName, context.credential); break;
  }
}

/** Logging must never include query credentials, fragments, or userinfo. */
export function safeRequestLabel(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

export function redactRequestSecret(value: string, credential: string | null): string {
  if (!credential) return value;
  const variants = [credential, encodeURIComponent(credential), JSON.stringify(credential).slice(1, -1)];
  // Form query encoding differs from encodeURIComponent for spaces and punctuation.
  variants.push(new URLSearchParams({ secret: credential }).toString().slice(7));
  let safe = value;
  for (const secret of new Set(variants)) {
    if (secret) safe = safe.split(secret).join("[REDACTED]");
  }
  return safe;
}

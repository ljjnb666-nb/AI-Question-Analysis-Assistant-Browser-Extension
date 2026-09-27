/**
 * Error Logger (P0 - Error Handling)
 * Centralized error logging system with structured logging
 */

export type ErrorLevel = "error" | "warn" | "info" | "debug";

export interface ErrorLogEntry {
  level: ErrorLevel;
  message: string;
  context?: string;
  error?: Error;
  data?: Record<string, unknown>;
  timestamp: number;
  stack?: string;
}

const ERROR_LOG: ErrorLogEntry[] = [];
const MAX_LOG_SIZE = 100;
let persistQueue: Promise<void> = Promise.resolve();

const SENSITIVE_QUERY_PARAMETER_NAMES = new Set([
  "key",
  "apikey",
  "xapikey",
  "token",
  "accesstoken",
  "authtoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "secret",
  "clientsecret",
  "signature",
  "sig",
  "password",
  "credential",
  "credentials",
  "awsaccesskeyid",
  "xamzsecuritytoken",
  "googleaccessid",
]);

const SENSITIVE_LOG_FIELD_NAMES = new Set([
  "apikey",
  "xapikey",
  "token",
  "accesstoken",
  "authtoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "secret",
  "clientsecret",
  "signature",
  "password",
  "verificationcode",
  "credential",
  "credentials",
  "bearertoken",
  "sessiontoken",
  "providercredential",
  "providercredentials",
]);

const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const TRAILING_URL_PUNCTUATION = /[),.;!?]+$/;

function normalizeCredentialName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveQueryParameter(name: string): boolean {
  return SENSITIVE_QUERY_PARAMETER_NAMES.has(normalizeCredentialName(name));
}

function fragmentHasCredential(fragment: string): boolean {
  const fragmentParams = fragment.replace(/^#/, "").split(/[?&;]/);
  return fragmentParams.some((part) => {
    const equalsAt = part.indexOf("=");
    return equalsAt >= 0 && isSensitiveQueryParameter(decodeURIComponentSafe(part.slice(0, equalsAt)));
  });
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/** Return a diagnostic URL without userinfo or credential-bearing query values. */
export function redactUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";

    const safeParams = new URLSearchParams();
    url.searchParams.forEach((parameterValue, name) => {
      safeParams.append(
        name,
        isSensitiveQueryParameter(name) ? "[REDACTED]" : sanitizeLogString(parameterValue),
      );
    });
    url.search = safeParams.toString();

    if (url.hash && fragmentHasCredential(url.hash)) {
      url.hash = "#[REDACTED]";
    }

    return url.toString();
  } catch {
    // A URL-shaped value we cannot parse must not be retained verbatim.
    return "[REDACTED_URL]";
  }
}

function sanitizeLogString(value: string): string {
  return value.replace(URL_IN_TEXT_PATTERN, (rawUrl) => {
    let url = rawUrl;
    let punctuation = "";
    while (TRAILING_URL_PUNCTUATION.test(url)) {
      punctuation = `${url.slice(-1)}${punctuation}`;
      url = url.slice(0, -1);
    }
    return `${redactUrlForLog(url)}${punctuation}`;
  });
}

function sanitizeLogValue(value: unknown, seen = new WeakSet<object>(), fieldName?: string): unknown {
  if (fieldName && SENSITIVE_LOG_FIELD_NAMES.has(normalizeCredentialName(fieldName))) {
    return "[REDACTED]";
  }
  if (typeof value === "string") return sanitizeLogString(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return "[REDACTED]";
  if (value === null || typeof value !== "object") return value;

  try {
    if (value instanceof URL) return redactUrlForLog(value.toString());
    if (seen.has(value)) return "[REDACTED_CIRCULAR_DATA]";
    seen.add(value);

    if (value instanceof Error) {
      const safeError = new Error(sanitizeLogString(value.message));
      safeError.name = sanitizeLogString(value.name) || "Error";
      if (value.stack) safeError.stack = sanitizeLogString(value.stack);

      const errorWithCause = value as Error & { cause?: unknown };
      if (errorWithCause.cause !== undefined) {
        (safeError as Error & { cause?: unknown }).cause = sanitizeLogValue(errorWithCause.cause, seen, "cause");
      }
      for (const key of Object.keys(value)) {
        if (key === "name" || key === "message" || key === "stack" || key === "cause") continue;
        Object.defineProperty(safeError, key, {
          value: sanitizeLogValue((value as unknown as Record<string, unknown>)[key], seen, key),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return safeError;
    }

    if (Array.isArray(value)) {
      return value.map((item) => sanitizeLogValue(item, seen));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return "[REDACTED]";

    return Object.fromEntries(
      Object.entries(value).map(([key, propertyValue]) => [key, sanitizeLogValue(propertyValue, seen, key)]),
    );
  } catch {
    // Unexpected values must not escape the logging boundary.
    return "[REDACTED]";
  }
}

/** Sanitize structured log data while retaining ordinary diagnostic fields. */
export function sanitizeLogData(value: unknown): unknown {
  try {
    return sanitizeLogValue(value);
  } catch {
    return "[REDACTED]";
  }
}

function sanitizeLogEntry(entry: ErrorLogEntry): ErrorLogEntry {
  const sanitized = sanitizeLogData(entry);
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    return sanitized as ErrorLogEntry;
  }
  return {
    level: "error",
    message: "Log entry redacted after sanitization failure",
    timestamp: Date.now(),
  };
}

function enqueuePersist(task: () => Promise<void>): Promise<void> {
  const writeTask = persistQueue.catch(() => undefined).then(task);
  persistQueue = writeTask;
  return writeTask;
}

function isExtensionContextInvalidatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /Extension context invalidated/i.test(message);
}

/**
 * Log an error with context
 */
export function logError(
  message: string,
  error?: Error | unknown,
  context?: string,
  data?: Record<string, unknown>
): void {
  const entry = sanitizeLogEntry({
    level: "error",
    message,
    context,
    error: error instanceof Error ? error : undefined,
    data,
    timestamp: Date.now(),
    stack: error instanceof Error ? error.stack : undefined,
  });

  ERROR_LOG.push(entry);
  if (ERROR_LOG.length > MAX_LOG_SIZE) {
    ERROR_LOG.shift();
  }

  // Console output for development
  if (process.env.NODE_ENV !== "production") {
    console.error(`[${entry.context || "Error"}] ${entry.message}`, entry.error, entry.data);
  }

  // Persist to storage
  persistErrorLog(entry);
}

/**
 * Log a warning
 */
export function logWarn(
  message: string,
  context?: string,
  data?: Record<string, unknown>
): void {
  const entry = sanitizeLogEntry({
    level: "warn",
    message,
    context,
    data,
    timestamp: Date.now(),
  });

  ERROR_LOG.push(entry);
  if (ERROR_LOG.length > MAX_LOG_SIZE) {
    ERROR_LOG.shift();
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(`[${entry.context || "Warning"}] ${entry.message}`, entry.data);
  }
}

/**
 * Log info message
 */
export function logInfo(
  message: string,
  context?: string,
  data?: Record<string, unknown>
): void {
  const entry = sanitizeLogEntry({
    level: "info",
    message,
    context,
    data,
    timestamp: Date.now(),
  });

  ERROR_LOG.push(entry);
  if (ERROR_LOG.length > MAX_LOG_SIZE) {
    ERROR_LOG.shift();
  }

  if (process.env.NODE_ENV !== "production") {
    console.info(`[${entry.context || "Info"}] ${entry.message}`, entry.data);
  }
}

/**
 * Get recent error logs
 */
export function getErrorLogs(): ErrorLogEntry[] {
  return ERROR_LOG.map(sanitizeLogEntry);
}

/**
 * Clear error logs
 */
export function clearErrorLogs(): void {
  ERROR_LOG.length = 0;
  chrome.storage.local.remove("errorLog").catch((err) => {
    if (isExtensionContextInvalidatedError(err)) return;
    // Ignore storage errors
  });
}

/**
 * Persist error log to storage
 */
async function persistErrorLog(entry: ErrorLogEntry): Promise<void> {
  await enqueuePersist(async () => {
    try {
      const result = await chrome.storage.local.get("errorLog");
      const stored = result["errorLog"];
      const log = Array.isArray(stored) ? stored.map((item) => sanitizeLogEntry(item as ErrorLogEntry)) : [];
      const updated = [...log, sanitizeLogEntry(entry)].slice(-MAX_LOG_SIZE);
      await chrome.storage.local.set({ errorLog: updated });
    } catch (err) {
      if (isExtensionContextInvalidatedError(err)) return;
      console.error("[ErrorLogger] Failed to persist error log:", sanitizeLogData(err));
    }
  });
}

/**
 * Load persisted error logs
 */
export async function loadErrorLogs(): Promise<ErrorLogEntry[]> {
  try {
    let logs: ErrorLogEntry[] = [];
    await enqueuePersist(async () => {
      const result = await chrome.storage.local.get("errorLog");
      const stored = result["errorLog"];
      logs = Array.isArray(stored) ? stored.map((item) => sanitizeLogEntry(item as ErrorLogEntry)) : [];
      // This also scrubs entries written by older versions before they can be exported.
      if (logs.length > 0) await chrome.storage.local.set({ errorLog: logs });
    });
    return logs.map(sanitizeLogEntry);
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return [];
    return [];
  }
}

/**
 * Export error logs as JSON
 */
export async function exportErrorLogs(): Promise<string> {
  const logs = await loadErrorLogs();
  return JSON.stringify(logs, null, 2);
}

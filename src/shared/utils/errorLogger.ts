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
// Fail-closed budgets for current and historical error-log entries.
const MAX_LOG_STRING_CHARS = 8 * 1024;
const MAX_LOG_ENTRY_BYTES = 32 * 1024;
// Total budget applies to the actual indented JSON export, and therefore
// also bounds compact local storage and retained in-memory entries.
const MAX_LOG_TOTAL_EXPORT_BYTES = 256 * 1024;
const MAX_LOG_VALUE_DEPTH = 10;
const MAX_LOG_VALUE_NODES = 512;
const MAX_LOG_COLLECTION_ITEMS = 64;
const MAX_LOG_FIELD_NAME_CHARS = 256;
const MAX_LOG_URL_DEPTH = 6;
const OVERSIZED_LOG_VALUE = "[REDACTED_OVERSIZED_LOG_VALUE]";
const COMPLEX_LOG_VALUE = "[REDACTED_COMPLEX_LOG_VALUE]";
let persistQueue: Promise<void> = Promise.resolve();

const SENSITIVE_QUERY_PARAMETER_NAMES = new Set([
  // Names use normalizeCredentialName's lowercase alphanumeric form.
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
  "xamzsignature",
  "xamzcredential",
  "xamzsecuritytoken",
  "xgoogsignature",
  "xgoogcredential",
  "xgoogsecuritytoken",
  "password",
  "credential",
  "credentials",
  "awsaccesskeyid",
  "googleaccessid",
  "cookie",
  "setcookie",
  "sessionid",
  "sessionkey",
  "csrftoken",
  "xcsrftoken",
  "authcode",
  "proxyauthorization",
  "privatekey",
  "clientassertion",
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
  "cookie",
  "setcookie",
  "proxyauthorization",
  "sessionid",
  "sessionkey",
  "csrftoken",
  "xcsrftoken",
  "authcode",
  "privatekey",
  "clientassertion",
  "encryptionkey",
]);

const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const TRAILING_URL_PUNCTUATION = /[),.;!?]+$/;
/** Sensitive HTTP headers may appear verbatim in thrown Error messages/stacks,
 * not only in structured log fields. Consume the complete header value on
 * that line; matching only a token prefix could leak Cookie attributes. */
const CREDENTIAL_HEADER_LINE = /\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-Api-Key|Api-Key)\s*:\s*[^\r\n]*/gi;

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
export function redactUrlForLog(value: string, urlDepth = 0): string {
  // Reject the entire secret-bearing URL instead of truncating it.
  if (value.length > MAX_LOG_STRING_CHARS || urlDepth > MAX_LOG_URL_DEPTH) {
    return OVERSIZED_LOG_VALUE;
  }
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";

    const safeParams = new URLSearchParams();
    url.searchParams.forEach((parameterValue, name) => {
      safeParams.append(
        name,
        isSensitiveQueryParameter(name) ? "[REDACTED]" : sanitizeLogString(parameterValue, urlDepth + 1),
      );
    });
    url.search = safeParams.toString();

    if (url.hash && fragmentHasCredential(url.hash)) {
      url.hash = "#[REDACTED]";
    }

    const redacted = url.toString();
    return redacted.length <= MAX_LOG_STRING_CHARS ? redacted : OVERSIZED_LOG_VALUE;
  } catch {
    // A URL-shaped value we cannot parse must not be retained verbatim.
    return "[REDACTED_URL]";
  }
}

function sanitizeLogString(value: string, urlDepth = 0): string {
  // Reject whole oversized inputs BEFORE regexes or URL parsing. Truncating
  // credential-bearing text could otherwise leave only part of a token.
  if (value.length > MAX_LOG_STRING_CHARS || urlDepth > MAX_LOG_URL_DEPTH) {
    return OVERSIZED_LOG_VALUE;
  }
  const withoutHeaders = value.replace(
    CREDENTIAL_HEADER_LINE,
    (_match, name: string) => name + ": [REDACTED]",
  );
  const safeText = withoutHeaders.replace(URL_IN_TEXT_PATTERN, (rawUrl) => {
    let url = rawUrl;
    let punctuation = "";
    while (TRAILING_URL_PUNCTUATION.test(url)) {
      punctuation = url.slice(-1) + punctuation;
      url = url.slice(0, -1);
    }
    return redactUrlForLog(url, urlDepth + 1) + punctuation;
  });
  return safeText.length <= MAX_LOG_STRING_CHARS ? safeText : OVERSIZED_LOG_VALUE;
}

type LogSanitizationBudget = {
  seen: WeakSet<object>;
  nodes: number;
};

function sanitizeLogValue(
  value: unknown,
  budget: LogSanitizationBudget,
  depth = 0,
  fieldName?: string,
): unknown {
  // Bound field-key work before normalization or value inspection.
  if (fieldName && fieldName.length > MAX_LOG_FIELD_NAME_CHARS) return COMPLEX_LOG_VALUE;
  if (fieldName && SENSITIVE_LOG_FIELD_NAMES.has(normalizeCredentialName(fieldName))) {
    return "[REDACTED]";
  }
  if (depth > MAX_LOG_VALUE_DEPTH || ++budget.nodes > MAX_LOG_VALUE_NODES) {
    return COMPLEX_LOG_VALUE;
  }
  if (typeof value === "string") return sanitizeLogString(value);
  if (typeof value === "bigint") return sanitizeLogString(value.toString());
  if (typeof value === "symbol" || typeof value === "function") return "[REDACTED]";
  if (value === null || typeof value !== "object") return value;

  try {
    if (value instanceof URL) return redactUrlForLog(value.toString());
    if (budget.seen.has(value)) return "[REDACTED_CIRCULAR_DATA]";
    budget.seen.add(value);

    if (value instanceof Error) {
      const safeError = new Error(sanitizeLogString(value.message));
      safeError.name = sanitizeLogString(value.name) || "Error";
      if (value.stack) safeError.stack = sanitizeLogString(value.stack);
      const errorWithCause = value as Error & { cause?: unknown };
      if (errorWithCause.cause !== undefined) {
        (safeError as Error & { cause?: unknown }).cause =
          sanitizeLogValue(errorWithCause.cause, budget, depth + 1, "cause");
      }
      let extraFields = 0;
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (key === "name" || key === "message" || key === "stack" || key === "cause") continue;
        if (++extraFields > MAX_LOG_COLLECTION_ITEMS || key.length > MAX_LOG_FIELD_NAME_CHARS) {
          return COMPLEX_LOG_VALUE;
        }
        Object.defineProperty(safeError, key, {
          value: sanitizeLogValue(
            (value as unknown as Record<string, unknown>)[key], budget, depth + 1, key,
          ),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return safeError;
    }

    if (Array.isArray(value)) {
      if (value.length > MAX_LOG_COLLECTION_ITEMS) return COMPLEX_LOG_VALUE;
      return value.map((item) => sanitizeLogValue(item, budget, depth + 1));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return "[REDACTED]";
    const entries: Array<[string, unknown]> = [];
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (entries.length >= MAX_LOG_COLLECTION_ITEMS || key.length > MAX_LOG_FIELD_NAME_CHARS) {
        return COMPLEX_LOG_VALUE;
      }
      entries.push([
        key,
        sanitizeLogValue((value as Record<string, unknown>)[key], budget, depth + 1, key),
      ]);
    }
    return Object.fromEntries(entries);
  } catch {
    // Getters, proxies, invalid values, and unexpected types fail closed.
    return "[REDACTED]";
  }
}

/** Sanitize structured log data while retaining ordinary diagnostic fields. */
export function sanitizeLogData(value: unknown): unknown {
  try {
    return sanitizeLogValue(value, { seen: new WeakSet<object>(), nodes: 0 });
  } catch {
    return "[REDACTED]";
  }
}

function sanitizeLogEntry(entry: ErrorLogEntry): ErrorLogEntry {
  const fallback = (): ErrorLogEntry => ({
    level: "error",
    message: "Log entry redacted after exceeding resource or sanitization limit",
    timestamp: Date.now(),
  });
  const sanitized = sanitizeLogData(entry);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return fallback();
  }
  try {
    // Count compact UTF-8 JSON bytes only after bounding and sanitizing.
    const bytes = new TextEncoder().encode(JSON.stringify(sanitized)).byteLength;
    if (bytes > MAX_LOG_ENTRY_BYTES) return fallback();
    return sanitized as ErrorLogEntry;
  } catch {
    return fallback();
  }
}

/**
 * Keep a contiguous, newest-first suffix while the complete pretty-printed
 * JSON export stays within the aggregate UTF-8 byte budget. This function
 * receives only sanitized per-entry-budgeted records; legacy raw data must be
 * sanitized first. Never skip a too-large newer entry to resurrect older ones.
 */
function retainLogsWithinTotalBudget(entries: ErrorLogEntry[]): ErrorLogEntry[] {
  const newestFirst: ErrorLogEntry[] = [];
  // For a nonempty JSON array: "[\n" + item + (",\n" + item)* + "\n]".
  let exportBytes = 4;
  const encoder = new TextEncoder();
  const firstIndex = Math.max(0, entries.length - MAX_LOG_SIZE);
  for (let index = entries.length - 1; index >= firstIndex; index--) {
    const entry = entries[index];
    // Rendering a single-element array gives the exact indentation level of
    // each element in the multi-entry export. Remove "[\n" and "\n]".
    const single = JSON.stringify([entry], null, 2);
    const entryBytes = encoder.encode(single.slice(2, -2)).byteLength;
    const separatorBytes = newestFirst.length === 0 ? 0 : 2;
    if (exportBytes + separatorBytes + entryBytes > MAX_LOG_TOTAL_EXPORT_BYTES) break;
    newestFirst.push(entry);
    exportBytes += separatorBytes + entryBytes;
  }
  return newestFirst.reverse();
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
  ERROR_LOG.splice(0, ERROR_LOG.length, ...retainLogsWithinTotalBudget(ERROR_LOG));

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
  ERROR_LOG.splice(0, ERROR_LOG.length, ...retainLogsWithinTotalBudget(ERROR_LOG));

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
  ERROR_LOG.splice(0, ERROR_LOG.length, ...retainLogsWithinTotalBudget(ERROR_LOG));

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
  // Clear must be sequenced after every already-accepted persist and before
  // subsequent writes/loads. An out-of-band remove can race an in-flight set
  // and resurrect entries the user explicitly cleared.
  void enqueuePersist(async () => {
    try {
      await chrome.storage.local.remove("errorLog");
    } catch (err) {
      if (isExtensionContextInvalidatedError(err)) return;
      // Ignore storage errors, as before.
    }
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
      // Historical storage may exceed MAX_LOG_SIZE. Select the retained
      // newest entries BEFORE sanitization to bound per-entry processing.
      const log = Array.isArray(stored)
        ? stored.slice(-(MAX_LOG_SIZE - 1)).map((item) => sanitizeLogEntry(item as ErrorLogEntry))
        : [];
      const updated = retainLogsWithinTotalBudget([...log, sanitizeLogEntry(entry)]);
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
      // Apply the same retention contract as new writes before sanitizing
      // legacy entries and compact storage before exporting any of them.
      logs = retainLogsWithinTotalBudget(
        Array.isArray(stored)
          ? stored.slice(-MAX_LOG_SIZE).map((item) => sanitizeLogEntry(item as ErrorLogEntry))
          : [],
      );
      // Rewrite valid legacy arrays only when there is historical content.
      // A corrupt non-array value may still contain unsanitized diagnostics;
      // returning [] alone must not leave that raw value in persistent storage.
      if (Array.isArray(stored)) {
        if (stored.length > 0) await chrome.storage.local.set({ errorLog: logs });
      } else if (stored !== undefined) {
        await chrome.storage.local.remove("errorLog");
      }
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

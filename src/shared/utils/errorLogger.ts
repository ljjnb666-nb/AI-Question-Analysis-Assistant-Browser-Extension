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

/**
 * Log an error with context
 */
export function logError(
  message: string,
  error?: Error | unknown,
  context?: string,
  data?: Record<string, unknown>
): void {
  const entry: ErrorLogEntry = {
    level: "error",
    message,
    context,
    error: error instanceof Error ? error : undefined,
    data,
    timestamp: Date.now(),
    stack: error instanceof Error ? error.stack : undefined,
  };

  ERROR_LOG.push(entry);
  if (ERROR_LOG.length > MAX_LOG_SIZE) {
    ERROR_LOG.shift();
  }

  // Console output for development
  if (process.env.NODE_ENV !== "production") {
    console.error(`[${context || "Error"}] ${message}`, error, data);
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
  const entry: ErrorLogEntry = {
    level: "warn",
    message,
    context,
    data,
    timestamp: Date.now(),
  };

  ERROR_LOG.push(entry);
  if (ERROR_LOG.length > MAX_LOG_SIZE) {
    ERROR_LOG.shift();
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(`[${context || "Warning"}] ${message}`, data);
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
  const entry: ErrorLogEntry = {
    level: "info",
    message,
    context,
    data,
    timestamp: Date.now(),
  };

  ERROR_LOG.push(entry);
  if (ERROR_LOG.length > MAX_LOG_SIZE) {
    ERROR_LOG.shift();
  }

  if (process.env.NODE_ENV !== "production") {
    console.info(`[${context || "Info"}] ${message}`, data);
  }
}

/**
 * Get recent error logs
 */
export function getErrorLogs(): ErrorLogEntry[] {
  return [...ERROR_LOG];
}

/**
 * Clear error logs
 */
export function clearErrorLogs(): void {
  ERROR_LOG.length = 0;
  chrome.storage.local.remove("errorLog").catch(() => {
    // Ignore storage errors
  });
}

/**
 * Persist error log to storage
 */
async function persistErrorLog(entry: ErrorLogEntry): Promise<void> {
  try {
    const result = await chrome.storage.local.get("errorLog");
    const log: ErrorLogEntry[] = (result["errorLog"] as ErrorLogEntry[]) ?? [];
    const updated = [...log, entry].slice(-MAX_LOG_SIZE);
    await chrome.storage.local.set({ errorLog: updated });
  } catch (err) {
    // Can't log storage errors to storage, just console
    console.error("[ErrorLogger] Failed to persist error log:", err);
  }
}

/**
 * Load persisted error logs
 */
export async function loadErrorLogs(): Promise<ErrorLogEntry[]> {
  try {
    const result = await chrome.storage.local.get("errorLog");
    return (result["errorLog"] as ErrorLogEntry[]) ?? [];
  } catch {
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

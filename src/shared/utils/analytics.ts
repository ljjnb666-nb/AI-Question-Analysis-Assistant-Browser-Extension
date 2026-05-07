/**
 * Analytics / Event Logger (M6)
 * Tracks user interactions and parse performance.
 */

import { logError } from "./errorLogger";

export type AnalyticsEvent =
  | "session_start"
  | "popup_opened"
  | "manual_capture_started"
  | "manual_capture_completed"
  | "manual_capture_cancelled"
  | "manual_capture_submitted"
  | "auto_detect_started"
  | "auto_detect_candidates_found"
  | "auto_detect_candidate_selected"
  | "auto_detect_batch_submitted"
  | "floating_window_opened"
  | "floating_window_minimized"
  | "floating_window_closed"
  | "floating_window_resized"
  | "floating_window_moved"
  | "answer_copied"
  | "parse_success"
  | "parse_error"
  | "parse_low_confidence"
  | "manual_auto_vision_retry_started"
  | "manual_auto_vision_retry_applied"
  | "manual_auto_vision_retry_skipped"
  | "manual_second_vision_review_started"
  | "manual_second_vision_review_applied"
  | "manual_second_vision_review_skipped"
  | "route_used_text"
  | "route_used_vision"
  | "route_used_hybrid"
  | "settings_saved"
  | "api_key_set"
  | "vision_upgrade_triggered"
  | "keyboard_shortcut_used"
  | "history_exported"
  | "history_cleared";

interface EventEntry {
  event: AnalyticsEvent;
  data?: Record<string, unknown>;
  ts: number;
  host?: string;
  duration?: number;
}

const SESSION_LOG: EventEntry[] = [];
const MAX_STORED = 300;

// Fire session_start once per content script load
let sessionStarted = false;
export function initAnalytics() {
  if (sessionStarted) return;
  sessionStarted = true;
  logEvent("session_start", { host: typeof location !== "undefined" ? location.hostname : undefined });
}

export function logEvent(
  event: AnalyticsEvent,
  data?: Record<string, unknown>,
): void {
  const entry: EventEntry = {
    event,
    data,
    ts: Date.now(),
    host: typeof location !== "undefined" ? location.hostname : undefined,
    duration: data?.duration as number | undefined,
  };
  SESSION_LOG.push(entry);
  persistEvent(entry);
}

async function persistEvent(entry: EventEntry): Promise<void> {
  try {
    const r = await chrome.storage.local.get("analyticsLog");
    const log: EventEntry[] = (r["analyticsLog"] as EventEntry[]) ?? [];
    const updated = [...log, entry].slice(-MAX_STORED);
    await chrome.storage.local.set({ analyticsLog: updated });
  } catch (err) {
    logError("Failed to persist analytics event", err, "persistEvent", { event: entry.event });
  }
}

export function getSessionLog(): EventEntry[] {
  return [...SESSION_LOG];
}

export async function getStoredLog(): Promise<EventEntry[]> {
  try {
    const r = await chrome.storage.local.get("analyticsLog");
    return (r["analyticsLog"] as EventEntry[]) ?? [];
  } catch (err) {
    logError("Failed to load stored analytics log", err, "getStoredLog");
    return [];
  }
}

/** Utility: wrap an async operation and log its duration */
export async function trackDuration<T>(
  event: AnalyticsEvent,
  fn: () => Promise<T>,
  extraData?: Record<string, unknown>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logEvent(event, { ...extraData, duration: Date.now() - start, success: true });
    return result;
  } catch (err) {
    logEvent(event, { ...extraData, duration: Date.now() - start, success: false, error: String(err) });
    throw err;
  }
}

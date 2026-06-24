import type { FloatingWindowState, AppSettings, HistoryEntry, ParseResult, QuestionBlock } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { logError } from "./errorLogger";
import { encryptValue, decryptValue, isEncrypted } from "./encryption";

const KEYS = {
  floatingState: "floatingWindowState",
  settings:      "appSettings",
  history:       "parseHistory",
  analytics:     "analyticsLog",
} as const;

const MAX_HISTORY = 50;
const MAX_PREVIEW_TEXT_CHARS = 800;
const MAX_RECOGNIZED_TEXT_CHARS = 4_000;
const MAX_BRIEF_EXPLANATION_CHARS = 500;
const MAX_DETAILED_EXPLANATION_CHARS = 8_000;

function isExtensionContextInvalidatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /Extension context invalidated/i.test(message);
}

function createErrorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

// ─── Floating Window State ────────────────────────────────────────────────────

export async function saveFloatingState(state: Partial<FloatingWindowState>): Promise<void> {
  const existing = await loadFloatingState();
  await chrome.storage.local.set({ [KEYS.floatingState]: { ...existing, ...state } });
}

export async function loadFloatingState(): Promise<Partial<FloatingWindowState>> {
  const r = await chrome.storage.local.get(KEYS.floatingState);
  return (r[KEYS.floatingState] as Partial<FloatingWindowState>) ?? {};
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const existing = await loadSettings();
  const merged = { ...existing, ...settings };

  // Encrypt API key before saving (only if it's plaintext)
  if (merged.apiKey && !isEncrypted(merged.apiKey)) {
    try {
      merged.apiKey = await encryptValue(merged.apiKey);
    } catch (err) {
      logError("Failed to encrypt API key", err, "saveSettings");
      throw createErrorWithCause("Failed to save settings securely", err);
    }
  }

  await chrome.storage.local.set({ [KEYS.settings]: merged });
}

function truncateText(value: string | undefined, maxChars: number): string {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

function sanitizeQuestionImageUrl(value?: string): string | undefined {
  const url = String(value || "").trim();
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export function sanitizeBlockForHistory(block: QuestionBlock): QuestionBlock {
  return {
    ...block,
    previewText: truncateText(block.previewText, MAX_PREVIEW_TEXT_CHARS),
    displaySegments: block.displaySegments?.slice(0, 12).map((segment) =>
      segment.type === "text"
        ? { ...segment, text: truncateText(segment.text, 300) }
        : segment,
    ),
    questionImageUrl: sanitizeQuestionImageUrl(block.questionImageUrl),
    imageDataUrl: undefined,
  };
}

export function sanitizeResultForHistory(result: ParseResult): ParseResult {
  const rawAnswer = String(result.answer || "").trim();
  const normalizedAnswer =
    result.questionType === "single_choice" || result.questionType === "multi_choice" || result.questionType === "judge"
      ? rawAnswer
      : /(见分点答案|见分点作答|按分点作答|分点作答|仅供参考|参考答案见解析|详见解析|示例答案)/.test(rawAnswer)
        ? "需人工确认"
        : rawAnswer;
  const optionSelections = result.optionSelections
    ? Object.fromEntries(
        Object.entries(result.optionSelections)
          .filter(([key, value]) => /^[A-F]$/.test(key) && (value === true || value === false || value === null)),
      )
    : undefined;
  return {
    ...result,
    answer: truncateText(normalizedAnswer, 500),
    briefExplanation: truncateText(result.briefExplanation, MAX_BRIEF_EXPLANATION_CHARS),
    detailedExplanation: truncateText(result.detailedExplanation, MAX_DETAILED_EXPLANATION_CHARS),
    recognizedText: truncateText(result.recognizedText, MAX_RECOGNIZED_TEXT_CHARS),
    optionSelections,
    warning: result.warning ? truncateText(result.warning, 500) : undefined,
  };
}

export function sanitizeHistoryEntry(entry: HistoryEntry): HistoryEntry {
  return {
    ...entry,
    block: sanitizeBlockForHistory(entry.block),
    result: sanitizeResultForHistory(entry.result),
  };
}

export async function loadSettings(): Promise<AppSettings> {
  const r = await chrome.storage.local.get(KEYS.settings);
  const stored = { ...DEFAULT_SETTINGS, ...(r[KEYS.settings] as Partial<AppSettings> ?? {}) };

  // Decrypt API key if encrypted
  if (stored.apiKey && isEncrypted(stored.apiKey)) {
    try {
      stored.apiKey = await decryptValue(stored.apiKey);
    } catch (err) {
      logError("Failed to decrypt API key", err, "loadSettings");
      // Return empty key on decryption failure
      stored.apiKey = "";
    }
  }

  return stored;
}

// ─── Parse History ────────────────────────────────────────────────────────────

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  await pruneIfNeeded();
  const history = await loadHistory();
  const updated = [sanitizeHistoryEntry(entry), ...history.map(sanitizeHistoryEntry)].slice(0, MAX_HISTORY);
  try {
    await chrome.storage.local.set({ [KEYS.history]: updated });
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return;
    logError("Failed to save parse history", err, "addHistoryEntry", { count: updated.length });
    const compact = updated.slice(0, Math.max(10, Math.floor(updated.length / 2)));
    try {
      await chrome.storage.local.set({ [KEYS.history]: compact });
    } catch (compactErr) {
      if (isExtensionContextInvalidatedError(compactErr)) return;
      throw compactErr;
    }
  }
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const r = await chrome.storage.local.get(KEYS.history);
  const history = (r[KEYS.history] as HistoryEntry[]) ?? [];
  return history.map(sanitizeHistoryEntry);
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(KEYS.history);
}

/** Export history as a JSON string for download */
export async function exportHistory(): Promise<string> {
  const history = await loadHistory();
  return JSON.stringify(history, null, 2);
}

// ─── Storage Quota Check ──────────────────────────────────────────────────────

const QUOTA_WARNING_BYTES = 4 * 1024 * 1024; // warn at 4MB (local quota is ~5MB)

export async function checkStorageQuota(): Promise<{
  usedBytes: number;
  quotaBytes: number;
  nearLimit: boolean;
}> {
  try {
    const used = await new Promise<number>((resolve, reject) => {
      chrome.storage.local.getBytesInUse(null, bytes => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(bytes);
      });
    });
    return {
      usedBytes: used,
      quotaBytes: chrome.storage.local.QUOTA_BYTES,
      nearLimit: used > QUOTA_WARNING_BYTES,
    };
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) {
      return { usedBytes: 0, quotaBytes: 5_242_880, nearLimit: false };
    }
    logError("Failed to check storage quota", err, "checkStorageQuota");
    return { usedBytes: 0, quotaBytes: 5_242_880, nearLimit: false };
  }
}

/** Prune old history and analytics if near quota */
export async function pruneIfNeeded(): Promise<void> {
  const { nearLimit } = await checkStorageQuota();
  if (!nearLimit) return;

  // Cut history to half
  const history = await loadHistory();
  if (history.length > 10) {
    await chrome.storage.local.set({ [KEYS.history]: history.slice(0, Math.floor(history.length / 2)) });
  }
  // Clear analytics log
  await chrome.storage.local.remove(KEYS.analytics);
}

import type { FloatingWindowState, AppSettings, HistoryEntry, ParseResult, QuestionBlock } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { logError } from "./errorLogger";
import { decryptValue, encryptValue, isEncrypted } from "./encryption";

const KEYS = {
  floatingState: "floatingWindowState",
  settings: "appSettings",
  history: "parseHistory",
  analytics: "analyticsLog",
} as const;
const SENSITIVE_SETTINGS_KEYS = ["apiKey", "authToken"] as const;

const MAX_HISTORY = 50;
const MAX_PREVIEW_TEXT_CHARS = 800;
const MAX_RECOGNIZED_TEXT_CHARS = 4_000;
const MAX_BRIEF_EXPLANATION_CHARS = 500;
const MAX_DETAILED_EXPLANATION_CHARS = 8_000;
const MIN_HISTORY_ENTRIES = 10;
const HISTORY_SOFT_LIMIT_BYTES = 600_000;
const HISTORY_RETRY_LIMIT_BYTES = 450_000;
const HISTORY_PRUNE_LIMIT_BYTES = 300_000;
const HISTORY_PRUNE_MAX_ENTRIES = 25;
const ANALYTICS_PRUNE_RETAIN_COUNT = 120;
let cachedSettings: AppSettings | null = null;
let settingsLoadPromise: Promise<AppSettings> | null = null;
let settingsListenerRegistered = false;

function createDeviceIdValue(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeBaseUrl(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_SETTINGS.analyticsBaseUrl;
  return raw.replace(/\/+$/, "");
}

function isExtensionContextInvalidatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /Extension context invalidated/i.test(message);
}

function createErrorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

function cloneSettings(settings: AppSettings): AppSettings {
  return { ...settings };
}

function setCachedSettings(settings: AppSettings): AppSettings {
  cachedSettings = cloneSettings(settings);
  return cloneSettings(settings);
}

function invalidateSettingsCache(): void {
  cachedSettings = null;
  settingsLoadPromise = null;
}

export function __resetStorageCacheForTests(): void {
  invalidateSettingsCache();
}

function ensureSettingsCacheListener(): void {
  if (settingsListenerRegistered || !chrome.storage?.onChanged?.addListener) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[KEYS.settings]) {
      invalidateSettingsCache();
    }
  });
  settingsListenerRegistered = true;
}

async function readSettingsFromStorage(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(KEYS.settings);
  const rawStored = (result[KEYS.settings] as Partial<AppSettings> ?? {});
  const stored = { ...DEFAULT_SETTINGS, ...rawStored };

  if (!stored.deviceId) {
    stored.deviceId = createDeviceIdValue();
    await chrome.storage.local.set({
      [KEYS.settings]: {
        ...rawStored,
        deviceId: stored.deviceId,
        analyticsBaseUrl: normalizeBaseUrl(rawStored.analyticsBaseUrl),
      },
    });
  }

  stored.analyticsBaseUrl = normalizeBaseUrl(stored.analyticsBaseUrl);

  for (const key of SENSITIVE_SETTINGS_KEYS) {
    const value = stored[key];
    if (!value || !isEncrypted(value)) continue;
    try {
      stored[key] = await decryptValue(value);
    } catch (err) {
      logError(`Failed to decrypt ${key}`, err, "loadSettings");
      stored[key] = "";
    }
  }

  return setCachedSettings(stored);
}

export async function saveFloatingState(state: Partial<FloatingWindowState>): Promise<void> {
  const existing = await loadFloatingState();
  await chrome.storage.local.set({ [KEYS.floatingState]: { ...existing, ...state } });
}

export async function loadFloatingState(): Promise<Partial<FloatingWindowState>> {
  const result = await chrome.storage.local.get(KEYS.floatingState);
  return (result[KEYS.floatingState] as Partial<FloatingWindowState>) ?? {};
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  ensureSettingsCacheListener();
  const existing = await loadSettings();
  const merged = { ...existing, ...settings };
  merged.deviceId = merged.deviceId || existing.deviceId || createDeviceIdValue();
  merged.analyticsBaseUrl = normalizeBaseUrl(merged.analyticsBaseUrl);

  for (const key of SENSITIVE_SETTINGS_KEYS) {
    const value = merged[key];
    if (!value || isEncrypted(value)) continue;
    try {
      merged[key] = await encryptValue(value);
    } catch (err) {
      logError(`Failed to encrypt ${key}`, err, "saveSettings");
      throw createErrorWithCause(`Failed to save ${key} securely`, err);
    }
  }

  await chrome.storage.local.set({ [KEYS.settings]: merged });
  setCachedSettings({
    ...merged,
    apiKey: settings.apiKey ?? existing.apiKey,
    authToken: settings.authToken ?? existing.authToken,
  });
}

function truncateText(value: string | undefined, maxChars: number): string {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function estimateStorageBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function trimHistoryEntries(entries: HistoryEntry[], maxEntries: number, maxBytes: number): HistoryEntry[] {
  let trimmed = entries.slice(0, Math.min(entries.length, maxEntries));
  while (trimmed.length > MIN_HISTORY_ENTRIES && estimateStorageBytes(trimmed) > maxBytes) {
    const nextLength =
      trimmed.length > HISTORY_PRUNE_MAX_ENTRIES
        ? Math.max(HISTORY_PRUNE_MAX_ENTRIES, Math.floor(trimmed.length * 0.85))
        : trimmed.length - 1;
    if (nextLength >= trimmed.length) break;
    trimmed = trimmed.slice(0, nextLength);
  }
  return trimmed;
}

async function trimStoredAnalytics(retainCount: number): Promise<void> {
  const result = await chrome.storage.local.get(KEYS.analytics);
  const analytics = (result[KEYS.analytics] as unknown[]) ?? [];
  if (analytics.length <= retainCount) return;
  await chrome.storage.local.set({ [KEYS.analytics]: analytics.slice(-retainCount) });
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
      segment.type === "text" ? { ...segment, text: truncateText(segment.text, 300) } : segment,
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
        Object.entries(result.optionSelections).filter(
          ([key, value]) => /^[A-F]$/.test(key) && (value === true || value === false || value === null),
        ),
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
  ensureSettingsCacheListener();
  if (cachedSettings) {
    return cloneSettings(cachedSettings);
  }
  if (!settingsLoadPromise) {
    settingsLoadPromise = readSettingsFromStorage().finally(() => {
      settingsLoadPromise = null;
    });
  }
  return cloneSettings(await settingsLoadPromise);
}

export async function getOrCreateDeviceId(): Promise<string> {
  ensureSettingsCacheListener();
  if (cachedSettings?.deviceId) return cachedSettings.deviceId;
  const result = await chrome.storage.local.get(KEYS.settings);
  const rawStored = (result[KEYS.settings] as Partial<AppSettings> ?? {});
  const existingDeviceId = String(rawStored.deviceId || "").trim();
  if (existingDeviceId) return existingDeviceId;

  const deviceId = createDeviceIdValue();
  await chrome.storage.local.set({
    [KEYS.settings]: {
      ...DEFAULT_SETTINGS,
      ...rawStored,
      deviceId,
      analyticsBaseUrl: normalizeBaseUrl(rawStored.analyticsBaseUrl),
    },
  });
  if (cachedSettings) {
    setCachedSettings({
      ...cachedSettings,
      deviceId,
      analyticsBaseUrl: normalizeBaseUrl(rawStored.analyticsBaseUrl || cachedSettings.analyticsBaseUrl),
    });
  }
  return deviceId;
}

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  await pruneIfNeeded();
  const history = await loadHistory();
  const updated = trimHistoryEntries(
    [sanitizeHistoryEntry(entry), ...history.map(sanitizeHistoryEntry)],
    MAX_HISTORY,
    HISTORY_SOFT_LIMIT_BYTES,
  );
  try {
    await chrome.storage.local.set({ [KEYS.history]: updated });
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return;
    logError("Failed to save parse history", err, "addHistoryEntry", { count: updated.length });
    const compact = trimHistoryEntries(updated, updated.length, HISTORY_RETRY_LIMIT_BYTES);
    try {
      await chrome.storage.local.set({ [KEYS.history]: compact });
    } catch (compactErr) {
      if (isExtensionContextInvalidatedError(compactErr)) return;
      throw compactErr;
    }
  }
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const result = await chrome.storage.local.get(KEYS.history);
  const history = (result[KEYS.history] as HistoryEntry[]) ?? [];
  return history.map(sanitizeHistoryEntry);
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(KEYS.history);
}

export async function exportHistory(): Promise<string> {
  const history = await loadHistory();
  return JSON.stringify(history, null, 2);
}

const QUOTA_WARNING_BYTES = 4 * 1024 * 1024;

export async function checkStorageQuota(): Promise<{
  usedBytes: number;
  quotaBytes: number;
  nearLimit: boolean;
}> {
  try {
    const used = await new Promise<number>((resolve, reject) => {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
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

export async function pruneIfNeeded(): Promise<void> {
  const { nearLimit } = await checkStorageQuota();
  if (!nearLimit) return;

  const history = await loadHistory();
  const compactHistory = trimHistoryEntries(history, HISTORY_PRUNE_MAX_ENTRIES, HISTORY_PRUNE_LIMIT_BYTES);
  if (compactHistory.length < history.length) {
    await chrome.storage.local.set({ [KEYS.history]: compactHistory });
  }
  await trimStoredAnalytics(ANALYTICS_PRUNE_RETAIN_COUNT);
}

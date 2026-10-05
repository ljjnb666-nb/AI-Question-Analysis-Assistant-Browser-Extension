import { APP_SETTINGS_FIELDS, projectAppSettings } from "./appSettingsPolicy";
import { sendAppSettingsCommand } from "./appSettingsClient";
import type { AppSettingsUpdatePatch } from "../types/appSettingsMessages";
import { CURRENT_ANALYTICS_CONSENT_VERSION, normalizeAnalyticsBaseUrl as normalizeBaseUrl } from "./appSettingsPolicy";
export { CURRENT_ANALYTICS_CONSENT_VERSION } from "./appSettingsPolicy";
import type { FloatingWindowState, AppSettings, HistoryEntry, ParseResult, QuestionBlock } from "../types";
import { logError } from "./errorLogger";
import {
  decryptValue,
  isCredentialEnvelope,
  isEncrypted,
  tryDecryptLegacyValue,
  UnsupportedCredentialFormatError,
} from "./encryption";
import { sanitizeQuestionBlockForSerialization } from "./mediaSerialization";
import { flushAnalyticsWork, invalidateAnalyticsConsent } from "./analyticsState";


const KEYS = {
  floatingState: "floatingWindowState",
  settings: "appSettings",
  history: "parseHistory",
  analytics: "analyticsLog",
} as const;
const SENSITIVE_SETTINGS_KEYS = ["authToken"] as const;

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
let settingsCacheGeneration = 0;
let cachedSettings: AppSettings | null = null;
let settingsLoadPromise: Promise<AppSettings> | null = null;
let settingsListenerRegistered = false;

function isExtensionContextInvalidatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /Extension context invalidated/i.test(message);
}

function cloneSettings(settings: AppSettings): AppSettings {
  return { ...settings };
}

function setCachedSettings(settings: AppSettings): AppSettings {
  cachedSettings = cloneSettings(settings);
  return cloneSettings(settings);
}

function invalidateSettingsCache(): void {
  settingsCacheGeneration += 1;
  cachedSettings = null;
  settingsLoadPromise = null;
}

export function __resetStorageCacheForTests(): void {
  invalidateSettingsCache();
  settingsListenerRegistered = false;
}

function ensureSettingsCacheListener(): void {
  if (settingsListenerRegistered || !chrome.storage?.onChanged?.addListener) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[KEYS.settings]) {
      invalidateSettingsCache();
      const newSettings = changes[KEYS.settings].newValue as Partial<AppSettings> | undefined;
      if (newSettings?.enableAnalytics !== true || newSettings.analyticsConsentVersion !== CURRENT_ANALYTICS_CONSENT_VERSION) {
        invalidateAnalyticsConsent();
      }
    }
  });
  settingsListenerRegistered = true;
}

async function readSettingsFromStorage(): Promise<AppSettings> {
  const generation = settingsCacheGeneration;
  let result = await chrome.storage.local.get(KEYS.settings);
  let rawStored = (result[KEYS.settings] as Partial<AppSettings> ?? {});
  if (rawStored.analyticsConsentVersion !== CURRENT_ANALYTICS_CONSENT_VERSION || !rawStored.deviceId || !rawStored.analyticsBaseUrl) {
    const ack = await sendAppSettingsCommand({ type: "APP_SETTINGS_ENSURE_NORMALIZED" });
    if (ack.analyticsDisabled) invalidateAnalyticsConsent();
    result = await chrome.storage.local.get(KEYS.settings);
    rawStored = (result[KEYS.settings] as Partial<AppSettings> ?? {});
  }
  const stored = projectAppSettings(rawStored);
  stored.analyticsBaseUrl = normalizeBaseUrl(stored.analyticsBaseUrl);


  // Credential read path. `qse:v1:` envelopes decrypt and fail closed on
  // tampering; unknown `qse:*` versions fail closed as well; legacy strings
  // (no marker) are decoded leniently and never cleared. Credential persistence is background-owned; a normalization command may
  // secure an old authToken, but this reader never performs a raw write. AI migration is background-owned;
  // only account/session credentials remain on the ordinary settings path.
  for (const key of SENSITIVE_SETTINGS_KEYS) {
    const value = stored[key];
    if (!value) continue;
    if (isEncrypted(value)) {
      try {
        stored[key] = await decryptValue(value);
      } catch (err) {
        logError(`Failed to decrypt ${key}`, err, "loadSettings");
        stored[key] = "";
      }
    } else if (isCredentialEnvelope(value)) {
      logError(
        `Failed to decrypt ${key}`,
        new UnsupportedCredentialFormatError(
          `Stored ${key} uses an envelope version this build cannot decode`,
        ),
        "loadSettings",
      );
      stored[key] = "";
    } else {
      stored[key] = (await tryDecryptLegacyValue(value)).plaintext;
    }
  }

  return generation === settingsCacheGeneration ? setCachedSettings(stored) : cloneSettings(stored);
}

export async function saveFloatingState(state: Partial<FloatingWindowState>): Promise<void> {
  const existing = await loadFloatingState();
  await chrome.storage.local.set({ [KEYS.floatingState]: { ...existing, ...state } });
}

export async function loadFloatingState(): Promise<Partial<FloatingWindowState>> {
  const result = await chrome.storage.local.get(KEYS.floatingState);
  return (result[KEYS.floatingState] as Partial<FloatingWindowState>) ?? {};
}

function hasOwnSetting<K extends keyof AppSettings>(
  settings: Partial<AppSettings>,
  key: K,
): settings is Partial<AppSettings> & Record<K, AppSettings[K]> {
  return Object.prototype.hasOwnProperty.call(settings, key);
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  ensureSettingsCacheListener();
  const patch: AppSettingsUpdatePatch = {};
  for (const key of APP_SETTINGS_FIELDS) {
    if (hasOwnSetting(settings, key)) Object.assign(patch, { [key]: settings[key] });
  }
  // Undefined account fields are omitted by Chrome JSON messaging; send explicit clears.
  for (const key of ["authToken", "userId", "userEmail"] as const) {
    if (hasOwnSetting(settings, key) && settings[key] === undefined) patch[key] = null;
  }
  const ack = await sendAppSettingsCommand({ type: "APP_SETTINGS_UPDATE", patch });
  invalidateSettingsCache();
  if (ack.analyticsDisabled) {
    invalidateAnalyticsConsent();
    await flushAnalyticsWork();
    await chrome.storage.local.remove(KEYS.analytics);
  }
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
  return sanitizeQuestionBlockForSerialization({
    ...block,
    previewText: truncateText(block.previewText, MAX_PREVIEW_TEXT_CHARS),
    displaySegments: block.displaySegments?.slice(0, 12).map((segment) =>
      segment.type === "text" ? { ...segment, text: truncateText(segment.text, 300) } : segment,
    ),
    questionImageUrl: sanitizeQuestionImageUrl(block.questionImageUrl),
    imageDataUrl: undefined,
  });
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
    const pending = readSettingsFromStorage().finally(() => {
      if (settingsLoadPromise === pending) settingsLoadPromise = null;
    });
    settingsLoadPromise = pending;
  }
  return cloneSettings(await settingsLoadPromise);
}

export async function getOrCreateDeviceId(): Promise<string> {
  ensureSettingsCacheListener();
  const ack = await sendAppSettingsCommand({ type: "APP_SETTINGS_GET_OR_CREATE_DEVICE_ID" });
  return ack.deviceId;
}

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  await writeHistoryEntry(entry);
}

/**
 * Returns false when authority fails before a history write is dispatched or
 * all storage writes fail. Returns true when the final authority check passed
 * and the dispatched storage write completed. That successful dispatch is
 * the history commit point; later authority changes do not revoke the record.
 */
export async function addHistoryEntryIfCurrent(
  entry: HistoryEntry,
  isCurrent: () => boolean | Promise<boolean>,
): Promise<boolean> {
  return writeHistoryEntry(entry, isCurrent);
}

async function writeHistoryEntry(
  entry: HistoryEntry,
  isCurrent?: () => boolean | Promise<boolean>,
): Promise<boolean> {
  if (isCurrent) {
    if (!(await isCurrent())) return false;
  } else {
    await pruneIfNeeded();
  }
  const history = await loadHistory();
  const updated = trimHistoryEntries(
    [sanitizeHistoryEntry(entry), ...history.map(sanitizeHistoryEntry)],
    MAX_HISTORY,
    HISTORY_SOFT_LIMIT_BYTES,
  );
  if (isCurrent && !(await isCurrent())) return false;
  try {
    // HISTORY_COMMIT_POINT: the final authority check above authorizes this
    // write. A later revision change cannot undo a successful storage commit.
    await chrome.storage.local.set({ [KEYS.history]: updated });
    return true;
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return false;
    logError("Failed to save parse history", err, "addHistoryEntry", { count: updated.length });
    const compact = trimHistoryEntries(updated, updated.length, HISTORY_RETRY_LIMIT_BYTES);
    if (isCurrent && !(await isCurrent())) return false;
    try {
      // A compact retry is a new dispatch and needs its own final authority check.
      await chrome.storage.local.set({ [KEYS.history]: compact });
      return true;
    } catch (compactErr) {
      if (isExtensionContextInvalidatedError(compactErr)) return false;
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

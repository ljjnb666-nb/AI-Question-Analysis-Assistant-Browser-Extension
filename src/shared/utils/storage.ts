import type { FloatingWindowState, AppSettings, HistoryEntry } from "../types";
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
      throw new Error("Failed to save settings securely");
    }
  }

  await chrome.storage.local.set({ [KEYS.settings]: merged });
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
  const history = await loadHistory();
  const updated = [entry, ...history].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [KEYS.history]: updated });
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const r = await chrome.storage.local.get(KEYS.history);
  return (r[KEYS.history] as HistoryEntry[]) ?? [];
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

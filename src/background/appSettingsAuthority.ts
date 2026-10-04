/** Background-only owner of the monolithic appSettings storage value. */
import type { AppSettingsCommand, AppSettingsResponse, AppSettingsUpdatePatch } from "../shared/types/appSettingsMessages";
import { DEFAULT_SETTINGS } from "../shared/types/settings";
import { CURRENT_ANALYTICS_CONSENT_VERSION, normalizeAnalyticsBaseUrl } from "../shared/utils/appSettingsPolicy";
import { encryptValue, isCredentialEnvelope, tryDecryptLegacyValue } from "../shared/utils/encryption";

let settingsWriteTail: Promise<unknown> = Promise.resolve();
function withAppSettingsWriteLock<T>(run: () => Promise<T>): Promise<T> {
  const next = settingsWriteTail.catch(() => undefined).then(run);
  settingsWriteTail = next;
  return next;
}

const UI_PATHS = new Set(["/popup/popup.html", "/sidepanel/sidepanel.html"]);
const PATCH_KEYS = new Set(["preferredRoute", "language", "enableAnalytics", "analyticsConsentVersion", "deviceId", "analyticsBaseUrl", "userId", "userEmail", "authToken"]);
function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype);
}
function authorized(type: unknown, sender: chrome.runtime.MessageSender): boolean {
  if (!sender || typeof sender.id !== "string" || sender.id !== chrome.runtime.id) return false;
  if (type !== "APP_SETTINGS_UPDATE") return true;
  if (!sender.url) return false;
  try {
    const page = new URL(sender.url);
    const own = new URL(chrome.runtime.getURL("/"));
    // URL.origin is "null" for extension URLs in some JS engines: compare components.
    return page.protocol === own.protocol && page.host === own.host && !page.username && !page.password && UI_PATHS.has(page.pathname);
  } catch { return false; }
}
function validatePatch(patch: unknown): patch is AppSettingsUpdatePatch {
  if (!plainObject(patch) || Reflect.ownKeys(patch).some(key => typeof key !== "string" || !PATCH_KEYS.has(key))) return false;
  return Object.entries(patch).every(([key, value]) => {
    if (key === "preferredRoute") return ["auto", "text", "vision"].includes(String(value)) && typeof value === "string";
    if (key === "language") return value === "zh" || value === "en";
    if (key === "enableAnalytics") return typeof value === "boolean";
    if (key === "analyticsConsentVersion") return Number.isSafeInteger(value) && Number(value) >= 0;
    if (["userId", "userEmail", "authToken"].includes(key) && value === null) return true;
    return typeof value === "string" && value.length <= (key === "authToken" ? 65_536 : key === "analyticsBaseUrl" ? 2_048 : 512);
  });
}

async function writeAppSettingsUnderLock(command: AppSettingsCommand): Promise<Extract<AppSettingsResponse, { ok: true }>> {
  const result = await chrome.storage.local.get("appSettings");
  const raw = result.appSettings ?? {};
  if (!plainObject(raw)) throw new Error("APP_SETTINGS_WRITE_FAILED");
  // Preserve legacy fields byte-for-byte. Physical cleanup is a separate phase.
  const next = { ...raw };
  if (raw.analyticsConsentVersion !== CURRENT_ANALYTICS_CONSENT_VERSION) next.enableAnalytics = false;
  next.analyticsConsentVersion = CURRENT_ANALYTICS_CONSENT_VERSION;
  if (next.preferredRoute === undefined) next.preferredRoute = DEFAULT_SETTINGS.preferredRoute;
  if (next.language === undefined) next.language = DEFAULT_SETTINGS.language;
  if (next.enableAnalytics === undefined) next.enableAnalytics = false;
  const patch = command.type === "APP_SETTINGS_UPDATE" ? command.patch : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null && ["userId", "userEmail", "authToken"].includes(key)) delete next[key];
    else next[key] = value;
  }
  next.analyticsConsentVersion = CURRENT_ANALYTICS_CONSENT_VERSION;
  if (patch.deviceId !== undefined && !patch.deviceId.trim()) next.deviceId = raw.deviceId;
  next.deviceId = typeof next.deviceId === "string" && next.deviceId.trim() ? next.deviceId : crypto.randomUUID();
  next.analyticsBaseUrl = normalizeAnalyticsBaseUrl(typeof next.analyticsBaseUrl === "string" ? next.analyticsBaseUrl : undefined);
  if (typeof next.authToken === "string" && next.authToken) {
    if (Object.prototype.hasOwnProperty.call(patch, "authToken")) next.authToken = await encryptValue(next.authToken);
    else if (!isCredentialEnvelope(next.authToken)) {
      const decoded = await tryDecryptLegacyValue(next.authToken);
      next.authToken = decoded.plaintext ? await encryptValue(decoded.plaintext) : "";
    }
  }
  // This is the sole production appSettings persistence site and the commit point.
  if (JSON.stringify(next) !== JSON.stringify(raw)) await chrome.storage.local.set({ appSettings: next });
  const analyticsDisabled = next.enableAnalytics !== true;
  if (analyticsDisabled) await chrome.storage.local.remove("analyticsLog");
  return { ok: true, deviceId: next.deviceId as string, analyticsDisabled };
}

export async function getOrCreateAppSettingsDeviceId(): Promise<string> {
  return (await withAppSettingsWriteLock(() => writeAppSettingsUnderLock({ type: "APP_SETTINGS_GET_OR_CREATE_DEVICE_ID" }))).deviceId;
}
export async function handleAppSettingsCommand(message: unknown, sender: chrome.runtime.MessageSender): Promise<AppSettingsResponse> {
  try {
    if (!plainObject(message) || typeof message.type !== "string" || !["APP_SETTINGS_UPDATE", "APP_SETTINGS_ENSURE_NORMALIZED", "APP_SETTINGS_GET_OR_CREATE_DEVICE_ID"].includes(String(message.type))) return { ok: false, code: "APP_SETTINGS_PAYLOAD_INVALID" };
    if (!authorized(message.type, sender)) return { ok: false, code: "APP_SETTINGS_SENDER_FORBIDDEN" };
    if (Reflect.ownKeys(message).some(key => key !== "type" && !(message.type === "APP_SETTINGS_UPDATE" && key === "patch"))) return { ok: false, code: "APP_SETTINGS_PAYLOAD_INVALID" };
    if (message.type === "APP_SETTINGS_UPDATE" && !validatePatch(message.patch)) return { ok: false, code: "APP_SETTINGS_PAYLOAD_INVALID" };
    return await withAppSettingsWriteLock(() => writeAppSettingsUnderLock(message as AppSettingsCommand));
  } catch {
    // Never attach command, storage snapshot, token or underlying exception.
    return { ok: false, code: "APP_SETTINGS_WRITE_FAILED" };
  }
}

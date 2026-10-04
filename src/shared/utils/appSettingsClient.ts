import type { AppSettingsCommand, AppSettingsResponse } from "../types/appSettingsMessages";

export class AppSettingsCommandError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AppSettingsCommandError"; }
}

export async function sendAppSettingsCommand(command: AppSettingsCommand) {
  let response: AppSettingsResponse | undefined;
  try { response = await chrome.runtime.sendMessage(command) as AppSettingsResponse | undefined; }
  catch { throw new AppSettingsCommandError("APP_SETTINGS_BACKGROUND_UNAVAILABLE"); }
  if (!response || response.ok !== true) {
    throw new AppSettingsCommandError(response?.code ?? "APP_SETTINGS_BACKGROUND_UNAVAILABLE");
  }
  if (typeof response.deviceId !== "string" || !response.deviceId || typeof response.analyticsDisabled !== "boolean") {
    throw new AppSettingsCommandError("APP_SETTINGS_RESPONSE_INVALID");
  }
  return { ok: true as const, deviceId: response.deviceId, analyticsDisabled: response.analyticsDisabled };
}

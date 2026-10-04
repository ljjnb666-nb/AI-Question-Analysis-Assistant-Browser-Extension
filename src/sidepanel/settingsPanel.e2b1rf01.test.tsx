import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installMemoryStorage } from "../test/memoryStorage";
import { SettingsTab } from "./settingsPanel";
import { DEFAULT_SETTINGS } from "@/shared/types";
import { getProvider } from "@/shared/ai/providers";
import { loadAIConnectionState } from "@/shared/utils/aiConnectionState";
import {
  __resetStorageCacheForTests,
  loadSettings,
} from "@/shared/utils/storage";
import { loadLegacyRuntimeSettingsCompat } from "@/shared/utils/legacyRuntimeSettingsCompat";
import type * as SettingsSections from "./settingsSections";

vi.mock("gsap", () => ({ default: { registerPlugin: vi.fn() } }));
vi.mock("@gsap/react", () => ({ useGSAP: vi.fn() }));
vi.mock("@/shared/auth/useAuthController", () => ({
  useAuthController: () => ({}),
}));
// Account login is independent of endpoint ownership; retain the real AI form
// and save actions, storage bridge, background writer and runtime projection.
vi.mock("./settingsSections", async (importOriginal) => ({
  ...(await importOriginal<typeof SettingsSections>()),
  SettingsAccountSection: () => null,
}));

const oldEndpoint = "https://old-proxy.example";
const newKey = ["rf01", "new", "fixture", "key"].join("-");
let memory: ReturnType<typeof installMemoryStorage>;
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  __resetStorageCacheForTests();
  memory = installMemoryStorage();
  memory.store.set("appSettings", {
    ...DEFAULT_SETTINGS,
    providerId: "anthropic",
    apiModel: "fixture-original-model",
    customBaseUrl: oldEndpoint,
    apiKey: "rf01-old-fixture-key",
    deviceId: "fixture-device",
    analyticsConsentVersion: 1,
  });
  vi.resetModules();
  const { handleAIConnectionCommand } =
    await import("../background/aiConnectionAuthority");
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(
    (message) => handleAIConnectionCommand(message) as never,
  );
});

async function switchToCustom() {
  render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByDisplayValue(oldEndpoint)).toBeInTheDocument(),
  );
  expect((await loadSettings()).apiKey).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /Custom/ }));
  const endpoint = screen.getByPlaceholderText(getProvider("custom").baseUrl);
  expect(endpoint).toHaveValue("");
  return endpoint;
}
async function save() {
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "已保存" })).toBeInTheDocument(),
  );
  const state = (await loadAIConnectionState())!;
  return state.connections[state.activeConnectionId!];
}

describe("RF01 provider endpoint ownership through real Settings save", () => {
  it("E2B1-RF01-ENDPOINT-01 switching without editing Base URL cannot inherit official proxy", async () => {
    await switchToCustom();
    const connection = await save();
    expect(connection).toMatchObject({ presetId: "custom" });
    expect(connection.endpointOverride).toBeUndefined();
    expect(connection.credentialRef).toBeUndefined();
  });
  it("E2B1-RF01-ENDPOINT-02 new key never pairs with the previous endpoint", async () => {
    await switchToCustom();
    fireEvent.change(screen.getByPlaceholderText("your_api_key"), {
      target: { value: newKey },
    });
    expect((await save()).endpointOverride).toBeUndefined();
    const runtime = await loadLegacyRuntimeSettingsCompat();
    expect(runtime.apiKey).toBe(newKey);
    expect(runtime.customBaseUrl).not.toBe(oldEndpoint);
    expect(JSON.stringify(memory.store.get("aiConnectionState"))).not.toContain(
      newKey,
    );
    expect(memory.store.get("appSettings")).not.toHaveProperty("apiKey");
  });
  it("E2B1-RF01-ENDPOINT-03 explicitly entered new Custom endpoint and key remain operational", async () => {
    const endpoint = await switchToCustom();
    fireEvent.change(endpoint, {
      target: { value: "https://new-custom.example" },
    });
    fireEvent.change(screen.getByPlaceholderText("your_api_key"), {
      target: { value: newKey },
    });
    expect((await save()).endpointOverride).toBe("https://new-custom.example");
    expect(await loadLegacyRuntimeSettingsCompat()).toMatchObject({
      apiKey: newKey,
      customBaseUrl: "https://new-custom.example",
    });
  });
});

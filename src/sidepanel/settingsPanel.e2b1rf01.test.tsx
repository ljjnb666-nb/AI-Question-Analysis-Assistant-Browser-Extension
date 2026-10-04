import { installSettingsMessaging } from "../test/settingsMessaging";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installMemoryStorage } from "../test/memoryStorage";
import { SettingsTab } from "./settingsPanel";
import { DEFAULT_SETTINGS } from "@/shared/types";
import { getProvider } from "@/shared/ai/providers";
import { loadAIConnectionState } from "@/shared/utils/aiConnectionState";
import { ensureAIConnectionAuthorityReady, updateActiveAIConnection } from "@/shared/utils/aiConnectionClient";
import {
  __resetStorageCacheForTests,
  loadSettings,
} from "@/shared/utils/storage";
import { resolveActiveAIConnectionRuntimeMetadata, resolveRuntimeCredential } from "@/shared/utils/aiRuntimeResolver";
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
  installSettingsMessaging();
});

async function switchToCustom() {
  render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByDisplayValue(oldEndpoint)).toBeInTheDocument(),
  );
  expect("apiKey" in await loadSettings()).toBe(false);
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
    const runtime = await resolveActiveAIConnectionRuntimeMetadata();
    expect(await resolveRuntimeCredential(runtime)).toBe(newKey);
    expect(runtime.endpoint).not.toBe(oldEndpoint);
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
    const runtime = await resolveActiveAIConnectionRuntimeMetadata();
    expect(runtime.endpoint).toBe("https://new-custom.example");
    expect(await resolveRuntimeCredential(runtime)).toBe(newKey);
  });
});

describe("E2B2A committed Save-and-Test", () => {
  const providerReply = (protocol: "anthropic" | "openai") => new Response(JSON.stringify(protocol === "anthropic"
    ? { content: [{ type: "text", text: '{"questionType":"single_choice","answer":"B","confidence":1}' }] }
    : { choices: [{ message: { content: '{"questionType":"single_choice","answer":"B","confidence":1}' } }] }), { status: 200 });

  it("TEST-01/02 blank visible key keeps stored credential and runs a text request without React plaintext", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue(oldEndpoint)).toBeInTheDocument());
    expect(screen.getByPlaceholderText(getProvider("anthropic").keyPlaceholder)).toHaveValue("");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(JSON.stringify(document.body.innerHTML)).not.toContain("rf01-old-fixture-key");
      expect("apiKey" in await loadSettings()).toBe(false);
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("rf01-old-fixture-key");
      expect(JSON.parse(String(init?.body)).messages[0].content.every((part: { type: string }) => part.type === "text")).toBe(true);
      return providerReply("anthropic");
    });
    fireEvent.click(screen.getByRole("button", { name: /连接测试/ }));
    await waitFor(() => expect(screen.getByText(/连接成功/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(memory.store.has("history")).toBe(false);
  });
  it("TEST-03 changing provider commits B before B's request", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue(oldEndpoint)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^OpenAI/ }));
    fireEvent.change(screen.getByPlaceholderText(getProvider("openai").keyPlaceholder), { target: { value: newKey } });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const state = (await loadAIConnectionState())!;
      expect(state.connections[state.activeConnectionId!].presetId).toBe("openai");
      expect(String(url)).toContain("https://api.openai.com/");
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${newKey}`);
      return providerReply("openai");
    });
    fireEvent.click(screen.getByRole("button", { name: /连接测试/ }));
    await waitFor(() => expect(screen.getByText(/连接成功/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("TEST-04/05 provider switch with missing credential commits safely and dispatches no request", async () => {
    await switchToCustom();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fireEvent.click(screen.getByRole("button", { name: /连接测试/ }));
    await waitFor(() => expect(screen.getByText(/请先填写 API Key，再测试连接/)).toBeInTheDocument());
    const state = (await loadAIConnectionState())!;
    expect(state.connections[state.activeConnectionId!].presetId).toBe("custom");
    expect(state.connections[state.activeConnectionId!].credentialRef).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(memory.store.has("history")).toBe(false);
  });
});

describe("E2B2B RF01 Custom protocol draft semantics", () => {
  it("official Anthropic to Custom defaults to OpenAI without touching protocol", async () => {
    await ensureAIConnectionAuthorityReady();
    expect(await resolveActiveAIConnectionRuntimeMetadata()).toMatchObject({ presetId: "anthropic", protocol: "anthropic_messages" });
    await switchToCustom();
    expect(screen.getByRole("radio", { name: "OpenAI 兼容" })).toBeChecked();
    fireEvent.change(screen.getByPlaceholderText("your_api_key"), { target: { value: newKey } });
    expect(await save()).toMatchObject({ presetId: "custom", protocolOverride: "openai_chat_completions" });
    expect(await resolveActiveAIConnectionRuntimeMetadata()).toMatchObject({ protocol: "openai_chat_completions" });
  });

  it("official Anthropic to Custom connection test uses OpenAI wire and the new endpoint/key only", async () => {
    await ensureAIConnectionAuthorityReady();
    const endpoint = await switchToCustom();
    fireEvent.change(endpoint, { target: { value: "https://rf01-openai.example" } });
    fireEvent.change(screen.getByPlaceholderText("your_api_key"), { target: { value: newKey } });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://rf01-openai.example/v1/chat/completions");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${newKey}`);
      expect(headers.has("x-api-key")).toBe(false);
      expect(headers.has("anthropic-version")).toBe(false);
      const body = JSON.parse(String(init?.body));
      expect(body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "user" })]));
      expect(body).not.toHaveProperty("system");
      expect((await resolveActiveAIConnectionRuntimeMetadata()).protocol).toBe("openai_chat_completions");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"questionType":"single_choice","answer":"B","confidence":1}' } }] }), { status: 200 });
    });
    fireEvent.click(screen.getByRole("button", { name: /连接测试/ }));
    await waitFor(() => expect(screen.getByText(/连接成功/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const state = (await loadAIConnectionState())!;
    expect(state.connections[state.activeConnectionId!]).toMatchObject({ presetId: "custom", protocolOverride: "openai_chat_completions", endpointOverride: "https://rf01-openai.example" });
  });

  it("existing Custom Anthropic reloads its radio and retains protocol on unchanged save", async () => {
    await ensureAIConnectionAuthorityReady();
    await updateActiveAIConnection({ presetId: "custom", protocolOverride: "anthropic_messages", endpointOverride: oldEndpoint, credential: { action: "REPLACE", value: newKey } });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Claude 兼容" })).toBeChecked());
    expect(await save()).toMatchObject({ presetId: "custom", protocolOverride: "anthropic_messages" });
    const runtime = await resolveActiveAIConnectionRuntimeMetadata();
    expect(runtime.protocol).toBe("anthropic_messages");
    expect(await resolveRuntimeCredential(runtime)).toBe(newKey);
  });
});

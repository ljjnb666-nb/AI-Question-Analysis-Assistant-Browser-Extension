import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_ANALYTICS_BASE_URL } from "@/shared/constants/analytics";

vi.mock("gsap", () => ({
  default: {
    from: vi.fn(),
    to: vi.fn(),
    registerPlugin: vi.fn(),
    utils: {
      toArray: vi.fn(() => []),
    },
  },
}));

vi.mock("@gsap/react", () => ({
  useGSAP: vi.fn((callback?: () => void) => {
    callback?.();
  }),
}));

vi.mock("@/shared/auth/useAuthController", () => ({
  useAuthController: vi.fn(() => ({
    authBusy: null,
    codeCooldown: 0,
    codeSent: false,
    email: "",
    feedback: "",
    handleLogin: vi.fn(),
    handleLogout: vi.fn(),
    handleRegister: vi.fn(),
    handleSendCode: vi.fn(),
    isAuthenticated: false,
    password: "",
    refreshIdentity: vi.fn(),
    setEmail: vi.fn(),
    setFeedback: vi.fn(),
    setPassword: vi.fn(),
    setVerificationCode: vi.fn(),
    showPassword: false,
    switchView: vi.fn(),
    togglePasswordVisibility: vi.fn(),
    userEmail: "",
    userId: "",
    verificationCode: "",
    view: "login",
  })),
}));

vi.mock("@/shared/utils/parseRouter", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  parseQuestion: vi.fn(),
}));

import { parseQuestion } from "@/shared/utils/parseRouter";
import { SettingsTab } from "./settingsPanel";
import * as storage from "@/shared/utils/storage";

const connectionFixture = vi.hoisted(() => ({ presetId: "anthropic", hasCredential: false }));
function mockStoredSettings(providerId: string, apiKey: string) {
  connectionFixture.presetId = providerId; connectionFixture.hasCredential = Boolean(apiKey);
  vi.spyOn(storage, "saveSettings").mockResolvedValue(undefined);
  vi.spyOn(storage, "loadSettings").mockResolvedValue({
    preferredRoute: "auto",
    language: "zh",
    enableAnalytics: true,
    analyticsConsentVersion: 1,
    deviceId: "dev-1",
    analyticsBaseUrl: DEFAULT_ANALYTICS_BASE_URL,
  });
}

describe("SettingsTab connection test safety (UI-00A, UI00A-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a required-key provider without a key never reports connection success", async () => {
    mockStoredSettings("anthropic", "");
    // Even a sneaky mock-shaped success must never surface: the gate runs
    // before parseQuestion is called at all.
    vi.mocked(parseQuestion).mockResolvedValue({
      blockId: "test",
      questionType: "single_choice",
      answer: "B",
      confidence: 0.91,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "",
      routeUsed: "text",
      resultSource: "mock",
    });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /连接测试/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /连接测试/ }));

    await waitFor(() => expect(screen.getByText(/请先填写 API Key，再测试连接。/)).toBeInTheDocument());
    // No parse ran, so the old "连接成功 | 答案：B" false success cannot appear.
    expect(parseQuestion).not.toHaveBeenCalled();
    expect(screen.queryByText(/连接成功/)).toBeNull();
  });

  it("a key-optional provider (Ollama) keeps running the connection test", async () => {
    mockStoredSettings("ollama", "");
    vi.mocked(parseQuestion).mockResolvedValue({
      blockId: "test",
      questionType: "single_choice",
      answer: "C",
      confidence: 0.9,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "",
      routeUsed: "text",
      resultSource: "provider",
    });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /连接测试/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /连接测试/ }));

    await waitFor(() => expect(screen.getByText(/连接成功/)).toBeInTheDocument());
    expect(parseQuestion).toHaveBeenCalledTimes(1);
  });

  it("UI00A-RF01: a required-key provider without a key shows the config hint, never mock-fallback copy", async () => {
    mockStoredSettings("anthropic", "");

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);
    await waitFor(() => expect(screen.getByText(/此服务商需要 API Key 才能进行真实解析。/)).toBeInTheDocument());
    expect(screen.getByText(/尚未填写 API Key。配置后才能进行 AI 解析和连接测试。/)).toBeInTheDocument();

    // The removed silent-mock contract must not reappear in user copy.
    expect(screen.queryByText(/Mock 演示数据/)).toBeNull();
    expect(screen.queryByText(/回退/)).toBeNull();
    expect(screen.queryByText(/mock demo data/i)).toBeNull();
    expect(screen.queryByText(/demo or local mode/i)).toBeNull();
    expect(screen.queryByText(/演示或本地模式/)).toBeNull();
  });

  it("UI00A-RF01: a key-optional provider is described as usable without a key and shows no missing-key hint", async () => {
    mockStoredSettings("ollama", "");

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);
    await waitFor(() => expect(screen.getByText(/此服务商可以不填写 API Key。/)).toBeInTheDocument());

    expect(screen.queryByText(/尚未填写 API Key/)).toBeNull();
    expect(screen.queryByText(/Mock 演示数据/)).toBeNull();
    expect(screen.queryByText(/mock demo data/i)).toBeNull();
  });
});

vi.mock("@/shared/utils/aiConnectionClient", () => ({
  getAIConnectionActiveMetadata: vi.fn(async () => ({
    id: "conn-ui00a-test",
    presetId: connectionFixture.presetId,
    connectionRevision: 1,
    credentialRevision: connectionFixture.hasCredential ? 1 : 0,
    hasCredential: Boolean(connectionFixture.hasCredential),
    selectedModelId: "claude-opus-4.8",
  })),
  getAIConnectionEditorView: vi.fn(async () => ({ ...connectionFixture, selectedModelId: "claude-opus-4.8", endpointOverride: null, protocol: "anthropic_messages" })),
  updateActiveAIConnection: vi.fn(async () => ({
    ok: true,
    metadata: {
      id: "conn-ui00a-test",
      presetId: connectionFixture.presetId,
      connectionRevision: 1,
      credentialRevision: connectionFixture.hasCredential ? 1 : 0,
      hasCredential: Boolean(connectionFixture.hasCredential),
      selectedModelId: "claude-opus-4.8",
    },
  })),
}));
vi.mock("@/shared/utils/aiSolvePreferences", () => ({ getAIConnectionReadiness: async () => connectionFixture.presetId === "ollama" || connectionFixture.hasCredential ? { ready: true } : { ready: false, code: "AI_CREDENTIAL_REQUIRED" } }));

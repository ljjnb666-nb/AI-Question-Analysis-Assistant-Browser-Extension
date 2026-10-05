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
    setIdentity: vi.fn(),
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

import { SettingsTab } from "./settingsPanel";
import * as storage from "@/shared/utils/storage";

describe("SettingsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the newly selected provider instead of resetting from storage", async () => {
    vi.spyOn(storage, "loadSettings").mockResolvedValue({
      preferredRoute: "auto",
      language: "zh",
      enableAnalytics: true,
      analyticsConsentVersion: 1,
      deviceId: "dev-1",
      analyticsBaseUrl: DEFAULT_ANALYTICS_BASE_URL,
    });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("claude-opus-4.8")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /OpenAI \(GPT\)/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("gpt-5.5")).toBeInTheDocument();
    });
  });

  it("shows a saved bilingual analytics consent control", async () => {
    vi.spyOn(storage, "loadSettings").mockResolvedValue({
      preferredRoute: "auto", language: "zh", enableAnalytics: false, analyticsConsentVersion: 1, deviceId: "dev-1", analyticsBaseUrl: DEFAULT_ANALYTICS_BASE_URL,
    });
    const save = vi.spyOn(storage, "saveSettings").mockResolvedValue(undefined);
    const view = render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const toggle = await screen.findByRole("checkbox", { name: "开启可选使用情况统计" });
    expect(screen.getByText(/关闭统计不会影响账号登录或 AI 解析功能/)).toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ enableAnalytics: true })));

    view.rerender(<SettingsTab lang="en" onLanguageChange={vi.fn()} />);
    await screen.findByRole("checkbox", { name: "Enable optional usage analytics" });
    expect(screen.getByText(/Turning analytics off does not affect account sign-in or AI parsing/)).toBeInTheDocument();
  });
});

vi.mock("@/shared/utils/aiConnectionClient", () => ({ getAIConnectionActiveMetadata: vi.fn(async () => null), getAIConnectionEditorView: vi.fn(async () => ({ presetId: "anthropic", selectedModelId: "claude-opus-4.8", endpointOverride: null, protocol: "anthropic_messages", hasCredential: false })), updateActiveAIConnection: vi.fn(async () => ({ ok: true })) }));

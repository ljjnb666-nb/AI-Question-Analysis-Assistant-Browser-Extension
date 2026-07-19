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
      providerId: "anthropic",
      apiKey: "",
      apiModel: "claude-opus-4.8",
      preferredRoute: "auto",
      language: "zh",
      enableAnalytics: true,
      deviceId: "dev-1",
      analyticsBaseUrl: DEFAULT_ANALYTICS_BASE_URL,
      customProviderProtocol: "openai",
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
});

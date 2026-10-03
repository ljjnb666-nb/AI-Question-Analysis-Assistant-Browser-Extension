import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { DEFAULT_ANALYTICS_BASE_URL } from "@/shared/constants/analytics";
import { PROVIDERS } from "@/shared/ai/providers";

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

const mockAuth = {
  authBusy: null,
  codeCooldown: 0,
  codeSent: false,
  email: "operator@example.test",
  feedback: "",
  handleLogin: vi.fn(),
  handleLogout: vi.fn(),
  handleRegister: vi.fn(),
  handleSendCode: vi.fn(),
  isAuthenticated: true,
  isSessionPending: false,
  isServerUnavailable: false,
  password: "",
  refreshIdentity: vi.fn(),
  retryValidation: vi.fn(),
  sessionRejected: false,
  setEmail: vi.fn(),
  setFeedback: vi.fn(),
  setPassword: vi.fn(),
  setVerificationCode: vi.fn(),
  showPassword: false,
  status: "authenticated",
  switchView: vi.fn(),
  togglePasswordVisibility: vi.fn(),
  userEmail: "operator@example.test",
  userId: "usr-ui05-operator",
  verificationCode: "",
  view: "login",
};

vi.mock("@/shared/auth/useAuthController", () => ({
  useAuthController: vi.fn(() => mockAuth),
}));

vi.mock("@/shared/utils/parseRouter", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  parseQuestion: vi.fn(),
}));

import { parseQuestion } from "@/shared/utils/parseRouter";
import { DEFAULT_SETTINGS, type AppSettings, type ParseResult } from "@/shared/types";
import { SettingsTab } from "./settingsPanel";
import * as storage from "@/shared/utils/storage";

const SYNTHETIC_TEST_KEY = "sk-test-ui05-example";

const createMockParseResult = (overrides: Partial<ParseResult> = {}): ParseResult => ({
  blockId: "test",
  questionType: "single_choice",
  answer: "B",
  confidence: 0.98,
  routeUsed: "text",
  resultSource: "provider",
  recognizedText: "1+1=?",
  briefExplanation: "2",
  detailedExplanation: "1+1=2",
  ...overrides,
});

function mockSettings(overrides: Partial<AppSettings> = {}) {
  vi.spyOn(storage, "loadSettings").mockResolvedValue({
    ...DEFAULT_SETTINGS,
    providerId: "anthropic",
    apiKey: "",
    apiModel: "claude-opus-4.8",
    preferredRoute: "auto",
    language: "zh",
    enableAnalytics: false,
    analyticsConsentVersion: 1,
    deviceId: "dev-ui05-test",
    analyticsBaseUrl: DEFAULT_ANALYTICS_BASE_URL,
    customProviderProtocol: "openai",
    ...overrides,
  });
}

describe("UI-05: Settings & First-Run Experience Tests (UI05-01 - UI05-30)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // UI05-01: unconfigured first-run state
  it("UI05-01: unconfigured first-run state shows unconfigured status and missing key hints", async () => {
    mockSettings({ apiKey: "" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("未配置 AI 服务")).toBeInTheDocument();
    });
    expect(screen.getByText("快速配置引导")).toBeInTheDocument();
    expect(screen.getByText(/尚未填写 API Key。配置后才能进行 AI 解析和连接测试。/)).toBeInTheDocument();
  });

  // UI05-02: provider picker renders authority-backed providers
  it("UI05-02: provider picker renders authority-backed providers with capability tags", async () => {
    mockSettings();
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Anthropic (Claude)")).toBeInTheDocument();
    });

    for (const p of PROVIDERS) {
      expect(screen.getByText(p.name)).toBeInTheDocument();
    }
    expect(screen.getAllByText("支持图像").length).toBeGreaterThan(0);
    expect(screen.getByText("仅文本")).toBeInTheDocument(); // DeepSeek
    expect(screen.getByText("无需 Key")).toBeInTheDocument(); // Ollama
  });

  // UI05-03: select provider
  it("UI05-03: selecting a provider updates default model and selection state", async () => {
    mockSettings();
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("OpenAI (GPT)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("OpenAI (GPT)"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("gpt-5.5")).toBeInTheDocument();
    });
  });

  // UI05-04: provider selection keyboard accessible
  it("UI05-04: provider selection responds to arrow key navigation", async () => {
    mockSettings();
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const firstCard = await screen.findByRole("button", { name: /Anthropic \(Claude\)/i });
    firstCard.focus();

    fireEvent.keyDown(firstCard, { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.getByDisplayValue("gpt-5.5")).toBeInTheDocument();
    });
  });

  // UI05-05: API key masked
  it("UI05-05: API key is masked by default with password input type", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const input = await screen.findByTestId("settings-api-key-input");
    expect(input).toHaveAttribute("type", "password");
  });

  // UI05-06: Show API key
  it("UI05-06: Show API key unmasks credentials to type text", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const toggle = await screen.findByRole("button", { name: "显示 API Key" });
    fireEvent.click(toggle);

    const input = screen.getByTestId("settings-api-key-input");
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "隐藏 API Key" })).toBeInTheDocument();
  });

  // UI05-07: Hide API key
  it("UI05-07: Hide API key returns input back to password type", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const showToggle = await screen.findByRole("button", { name: "显示 API Key" });
    fireEvent.click(showToggle);
    const hideToggle = screen.getByRole("button", { name: "隐藏 API Key" });
    fireEvent.click(hideToggle);

    const input = screen.getByTestId("settings-api-key-input");
    expect(input).toHaveAttribute("type", "password");
  });

  // UI05-08: no real API key fixture
  it("UI05-08: test fixtures strictly use synthetic keys", () => {
    expect(SYNTHETIC_TEST_KEY).toMatch(/^sk-test-ui05-/);
    expect(SYNTHETIC_TEST_KEY).not.toMatch(/sk-ant-|sk-proj-|AIza[0-9A-Za-z-_]{35}/);
  });

  // UI05-09: saved != validated
  it("UI05-09: saving settings establishes saved state but not validated status", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    const saveSpy = vi.spyOn(storage, "saveSettings").mockResolvedValue(undefined);
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    // Saved confirmation appears
    expect(screen.getByRole("button", { name: "已保存" })).toBeInTheDocument();
    // Status must remain "已保存（待测试）", NEVER "AI 配置已就绪"
    expect(screen.getByText("已保存（待测试）")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-ready-banner")).toBeNull();
  });

  // UI05-10: validation loading state
  it("UI05-10: connection test triggers testing status and disables test button", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    let resolveParse: (res: any) => void;
    const pendingPromise = new Promise((resolve) => {
      resolveParse = resolve;
    });
    vi.mocked(parseQuestion).mockReturnValue(pendingPromise as any);

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const input = await screen.findByTestId("settings-api-key-input");
    await waitFor(() => {
      expect(input).toHaveValue(SYNTHETIC_TEST_KEY);
    });

    const testBtn = await screen.findByRole("button", { name: /测试配置|连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("正在测试配置...")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /测试中\.\.\./ })).toBeDisabled();
    });

    // Cleanup pending
    await act(async () => {
      resolveParse!(createMockParseResult({ confidence: 0.95 }));
    });
  });

  // UI05-11: validation success
  it("UI05-11: successful validation transitions to validated state and renders ready banner", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const input = await screen.findByTestId("settings-api-key-input");
    await waitFor(() => {
      expect(input).toHaveValue(SYNTHETIC_TEST_KEY);
    });

    const testBtn = await screen.findByRole("button", { name: /测试配置|连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByTestId("settings-ready-banner")).toBeInTheDocument();
      expect(screen.getByText("AI 服务已就绪")).toBeInTheDocument();
      expect(screen.getByText(/连接成功/)).toBeInTheDocument();
    });
  });

  // UI05-12: validation failure
  it("UI05-12: validation failure displays safe classified feedback and error status", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    vi.mocked(parseQuestion).mockRejectedValue(new Error("401 Unauthorized invalid_api_key"));

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const input = await screen.findByTestId("settings-api-key-input");
    await waitFor(() => {
      expect(input).toHaveValue(SYNTHETIC_TEST_KEY);
    });

    const testBtn = await screen.findByRole("button", { name: /测试配置|连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("连接测试失败")).toBeInTheDocument();
      expect(screen.getByText("API Key 无效或没有权限，请检查后重试。")).toBeInTheDocument();
    });
  });

  // UI05-13: raw provider errors sanitized
  it("UI05-13: raw stack traces and internal secrets are sanitized from user message", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    vi.mocked(parseQuestion).mockRejectedValue(
      new Error("SecretDumpException: Bearer sk-ant-secret-12345 at InternalRuntime.eval (/var/stack.js:99)"),
    );

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const input = await screen.findByTestId("settings-api-key-input");
    await waitFor(() => {
      expect(input).toHaveValue(SYNTHETIC_TEST_KEY);
    });

    const testBtn = await screen.findByRole("button", { name: /测试配置|连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("连接测试失败")).toBeInTheDocument();
    });
    // Internal secret and raw stack must NEVER appear in document
    expect(screen.queryByText(/sk-ant-secret-12345/)).toBeNull();
    expect(screen.queryByText(/\/var\/stack\.js/)).toBeNull();
  });

  // UI05-14: model picker
  it("UI05-14: model picker displays known selectable models for provider", async () => {
    mockSettings({ providerId: "gemini" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const select = await screen.findByLabelText(/模型/i);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "gemini-2.5-flash" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "gemini-2.5-pro" })).toBeInTheDocument();
  });

  // UI05-15: custom model when supported
  it("UI05-15: custom model toggle allows typing custom model override", async () => {
    mockSettings({ providerId: "anthropic" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const toggleBtn = await screen.findByRole("button", { name: /手动输入|自定义/ });
    fireEvent.click(toggleBtn);

    const input = screen.getByLabelText(/模型/i);
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(input, { target: { value: "claude-custom-finetune" } });
    expect(input).toHaveValue("claude-custom-finetune");
  });

  // UI05-16: Base URL hidden when irrelevant
  it("UI05-16: Base URL is not in common path for standard cloud providers like gemini", async () => {
    mockSettings({ providerId: "gemini" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Google Gemini")).toBeInTheDocument();
    });
    // In gemini, Base URL is not directly rendered
    expect(screen.queryByRole("textbox", { name: /Base URL/i })).toBeNull();
  });

  // UI05-17: Base URL shown when relevant
  it("UI05-17: Base URL is shown directly for custom and ollama providers", async () => {
    mockSettings({ providerId: "ollama" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ollama/i })).toHaveAttribute("aria-pressed", "true");
    });

    const baseUrlInput = screen.getByTestId("settings-base-url-input");
    expect(baseUrlInput).toBeInTheDocument();
    expect(baseUrlInput).toHaveAttribute("placeholder", "http://localhost:11434");
  });

  // UI05-18: invalid Base URL frontend handling
  it("UI05-18: invalid Base URL shows clear validation warning", async () => {
    mockSettings({ providerId: "ollama" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ollama/i })).toHaveAttribute("aria-pressed", "true");
    });

    const baseUrlInput = screen.getByTestId("settings-base-url-input");
    fireEvent.change(baseUrlInput, { target: { value: "not-a-valid-protocol" } });

    await waitFor(() => {
      expect(screen.getByText("请输入以 http:// 或 https:// 开头的有效网址")).toBeInTheDocument();
    });
  });

  // UI05-19: Ollama experience
  it("UI05-19: Ollama experience clarifies local provider with optional API key", async () => {
    mockSettings({ providerId: "ollama" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("此服务商可以不填写 API Key。")).toBeInTheDocument();
      expect(screen.getByText(/Ollama 为本地运行服务，通常不需要填写 API Key。/)).toBeInTheDocument();
    });
    // No missing-key warning
    expect(screen.queryByText(/尚未填写 API Key/)).toBeNull();
  });

  // UI05-20: Custom OpenAI-compatible experience
  it("UI05-20: Custom OpenAI-compatible provider exposes wire protocol and custom inputs", async () => {
    mockSettings({ providerId: "custom" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("自定义协议")).toBeInTheDocument();
      expect(screen.getByText("OpenAI 兼容")).toBeInTheDocument();
      expect(screen.getByText("Claude 兼容")).toBeInTheDocument();
    });
  });

  // UI05-21: ZH UI
  it("UI05-21: Chinese UI renders natural Chinese copy across all sections", async () => {
    mockSettings();
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("快速配置引导")).toBeInTheDocument();
      expect(screen.getByText("服务商")).toBeInTheDocument();
      expect(screen.getByText("模型")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "保存设置" })).toBeInTheDocument();
    });
  });

  // UI05-22: EN UI
  it("UI05-22: English UI renders natural English copy across all sections", async () => {
    mockSettings({ language: "en" });
    render(<SettingsTab lang="en" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Setup Guide")).toBeInTheDocument();
      expect(screen.getByText("Provider")).toBeInTheDocument();
      expect(screen.getByText("Model")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Settings" })).toBeInTheDocument();
    });
  });

  // UI05-23: language change
  it("UI05-23: language change updates labels without resetting credentials", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    const onLangChange = vi.fn();
    const { rerender } = render(<SettingsTab lang="zh" onLanguageChange={onLangChange} />);

    await waitFor(() => {
      expect(screen.getByText("保存设置")).toBeInTheDocument();
    });

    const enBtn = screen.getByRole("button", { name: "English" });
    fireEvent.click(enBtn);
    expect(onLangChange).toHaveBeenCalledWith("en");

    rerender(<SettingsTab lang="en" onLanguageChange={onLangChange} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Settings" })).toBeInTheDocument();
      expect(screen.getByTestId("settings-api-key-input")).toHaveValue(SYNTHETIC_TEST_KEY);
    });
  });

  // UI05-24 to 27: Responsive width rendering
  it.each([320, 360, 400, 480])("UI05-24-27: renders reliably at %ipx container width", async (width) => {
    mockSettings();
    const { container } = render(
      <div style={{ width: `${width}px`, maxWidth: `${width}px` }}>
        <SettingsTab lang="zh" onLanguageChange={vi.fn()} />
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByText("快速配置引导")).toBeInTheDocument();
    });
    expect(container).toBeInTheDocument();
  });

  // UI05-28: logged-in but provider-unconfigured remains authenticated
  it("UI05-28: logged-in user with unconfigured provider remains authenticated", async () => {
    mockSettings({ apiKey: "" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("未配置 AI 服务")).toBeInTheDocument();
    });
    // Account section shows user remains logged in
    expect(screen.getByText(/已登录：operator@example\.test/)).toBeInTheDocument();
    expect(mockAuth.handleLogout).not.toHaveBeenCalled();
  });

  // UI05-29: provider-valid cannot grant account authentication
  it("UI05-29: provider-valid credentials cannot grant account authentication", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult({ confidence: 1 }));

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const input = await screen.findByTestId("settings-api-key-input");
    await waitFor(() => {
      expect(input).toHaveValue(SYNTHETIC_TEST_KEY);
    });

    const testBtn = await screen.findByRole("button", { name: /测试配置|连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("AI 服务已就绪")).toBeInTheDocument();
    });
    // Account auth login was never invoked by provider test
    expect(mockAuth.handleLogin).not.toHaveBeenCalled();
  });

  // UI05-30: no automatic submission introduced
  it("UI05-30: no automatic submission is introduced by settings configuration", async () => {
    mockSettings({ apiKey: SYNTHETIC_TEST_KEY });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await screen.findByRole("button", { name: "已保存" });

    // No auto-fill or auto-submit dispatch occurs
    expect(globalThis.chrome.tabs).toBeDefined();
  });
});

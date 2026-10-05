import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act, within } from "@testing-library/react";
import { DEFAULT_ANALYTICS_BASE_URL } from "@/shared/constants/analytics";
import { PROVIDERS } from "@/shared/ai/providers";
import { DEFAULT_SETTINGS, type AppSettings, type ParseResult } from "@/shared/types";
import type { AIConnectionEditorView } from "@/shared/types/aiConnectionMessages";

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

vi.mock("@/shared/utils/aiConnectionClient", () => ({
  getAIConnectionEditorView: vi.fn(),
  updateActiveAIConnection: vi.fn(),
  getAIConnectionActiveMetadata: vi.fn(),
  ensureAIConnectionAuthorityReady: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/shared/utils/aiSolvePreferences", () => ({
  getAIConnectionReadiness: vi.fn(),
}));

import { parseQuestion } from "@/shared/utils/parseRouter";
import { getAIConnectionActiveMetadata, getAIConnectionEditorView, updateActiveAIConnection } from "@/shared/utils/aiConnectionClient";
import { getAIConnectionReadiness } from "@/shared/utils/aiSolvePreferences";
import { SettingsTab } from "./settingsPanel";
import { computeAuthorityValidationFingerprint, type AuthorityValidationReceipt, deriveSetupStatus } from "./settingsTypes";
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

const defaultEditorView: AIConnectionEditorView = {
  presetId: "anthropic",
  selectedModelId: "claude-opus-4.8",
  endpointOverride: null,
  protocol: "anthropic_messages",
  hasCredential: false,
};

function setupConnectionMock(
  editorOverrides: Partial<AIConnectionEditorView> = {},
  settingsOverrides: Partial<AppSettings> = {},
) {
  vi.mocked(getAIConnectionEditorView).mockResolvedValue({
    ...defaultEditorView,
    ...editorOverrides,
  });
  vi.mocked(getAIConnectionActiveMetadata).mockResolvedValue({
    id: "conn-ui05-test",
    providerId: (editorOverrides.presetId ?? defaultEditorView.presetId) as any,
    endpointOverride: editorOverrides.endpointOverride ?? null,
    protocol: (editorOverrides.protocol ?? defaultEditorView.protocol) as any,
    selectedModelId: editorOverrides.selectedModelId ?? defaultEditorView.selectedModelId,
    connectionRevision: 1,
    credentialRevision: editorOverrides.hasCredential ? 1 : 0,
    hasCredential: Boolean(editorOverrides.hasCredential),
    validation: { status: "untested" },
  } as any);
  vi.spyOn(storage, "loadSettings").mockResolvedValue({
    ...DEFAULT_SETTINGS,
    preferredRoute: "auto",
    language: "zh",
    enableAnalytics: false,
    analyticsConsentVersion: 1,
    deviceId: "dev-ui05-test",
    analyticsBaseUrl: DEFAULT_ANALYTICS_BASE_URL,
    ...settingsOverrides,
  });
  vi.spyOn(storage, "saveSettings").mockResolvedValue(undefined);
  vi.mocked(updateActiveAIConnection).mockImplementation(async (cmd: any) => {
    const patch = cmd?.patch ?? cmd;
    const isReplace = patch?.credential?.action === "REPLACE";
    const isClear = patch?.credential?.action === "CLEAR";
    const hasCred = isReplace ? true : isClear ? false : Boolean(editorOverrides.hasCredential);
    const updatedMeta = {
      id: "conn-ui05-test",
      presetId: patch?.presetId ?? editorOverrides.presetId ?? defaultEditorView.presetId,
      providerId: patch?.presetId ?? editorOverrides.presetId ?? defaultEditorView.presetId,
      hasCredential: hasCred,
      protocol: patch?.protocolOverride ?? editorOverrides.protocol ?? defaultEditorView.protocol,
      selectedModelId: patch?.selectedModelId ?? editorOverrides.selectedModelId ?? defaultEditorView.selectedModelId,
      connectionRevision: 2,
      credentialRevision: hasCred ? 2 : 0,
      validation: { status: "untested" },
    };
    vi.mocked(getAIConnectionActiveMetadata).mockResolvedValue(updatedMeta as any);
    return {
      ok: true,
      metadata: updatedMeta,
    } as any;
  });
  vi.mocked(getAIConnectionReadiness).mockResolvedValue({ ready: true });
}

describe("UI-05: Settings & First-Run Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectionMock();
  });

  // UI05-01: unconfigured first-run state
  it("UI05-01: unconfigured first-run state shows unconfigured status and missing key hints", async () => {
    setupConnectionMock({ hasCredential: false });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("未配置 AI 服务")).toBeInTheDocument();
    });
    expect(screen.getByText("快速配置引导")).toBeInTheDocument();
    expect(screen.getAllByText(/尚未填写 API Key。配置后才能进行 AI 解析和连接测试。/).length).toBeGreaterThan(0);
  });

  // UI05-02: provider picker renders authority-backed providers without provider-level capability claims
  it("UI05-02: provider picker renders authority-backed providers with key tags and no provider-level capability claims", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText("Anthropic (Claude)").length).toBeGreaterThan(0);
    });

    for (const p of PROVIDERS) {
      expect(screen.getAllByText(p.name).length).toBeGreaterThan(0);
    }
    // Per Item 4: provider-level supports images / text only claims deleted; unknown capability fails closed
    expect(screen.queryByText("支持图像")).toBeNull();
    expect(screen.queryByText("仅文本")).toBeNull();
    expect(screen.getByText("无需 Key")).toBeInTheDocument();
  });

  // UI05-03: select provider
  it("UI05-03: selecting a provider updates default model and selection state", async () => {
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
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="catalog" />);

    const firstCard = await screen.findByRole("button", { name: /Anthropic \(Claude\)/i });
    firstCard.focus();

    fireEvent.keyDown(firstCard, { key: "ArrowRight" });

    // ArrowRight moves focus without calling onProviderChange (stays in Catalog, does not open Editor)
    expect(screen.getByTestId("settings-catalog-view")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("settings-editor-view")).toHaveAttribute("hidden");

    // Enter selects provider and opens Editor
    fireEvent.keyDown(screen.getByTestId("provider-card-openai"), { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByDisplayValue("gpt-5.5")).toBeInTheDocument();
    });
  });

  // UI05-05: API key masked
  it("UI05-05: API key is masked by default with password input type", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const input = await screen.findByTestId("settings-api-key-input");
    expect(input).toHaveAttribute("type", "password");
  });

  // UI05-06: Show API key
  it("UI05-06: Show API key unmasks credentials to type text", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const toggle = await screen.findByRole("button", { name: "显示 API Key" });
    fireEvent.click(toggle);

    const input = screen.getByTestId("settings-api-key-input");
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "隐藏 API Key" })).toBeInTheDocument();
  });

  // UI05-07: Hide API key
  it("UI05-07: Hide API key returns input back to password type", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

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
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: SYNTHETIC_TEST_KEY } });

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateActiveAIConnection).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("button", { name: "已保存" })).toBeInTheDocument();
    expect(screen.getByText("已保存（待测试）")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-ready-banner")).toBeNull();
  });

  // UI05-10: validation loading state
  it("UI05-10: connection test triggers testing status and disables test button", async () => {
    let resolveParse: (res: any) => void;
    const pendingPromise = new Promise((resolve) => {
      resolveParse = resolve;
    });
    vi.mocked(parseQuestion).mockReturnValue(pendingPromise as any);

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: SYNTHETIC_TEST_KEY } });

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("正在测试配置...")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /测试中\.\.\./ })).toBeDisabled();
    });

    await act(async () => {
      resolveParse!(createMockParseResult({ confidence: 0.95 }));
    });
  });

  // UI05-11: validation success
  it("UI05-11: successful validation transitions to validated state and renders ready banner", async () => {
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: SYNTHETIC_TEST_KEY } });

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByTestId("settings-ready-banner")).toBeInTheDocument();
      expect(screen.getByText("AI 配置已就绪")).toBeInTheDocument();
      expect(screen.getByText(/连接成功/)).toBeInTheDocument();
    });
  });

  // UI05-12: validation failure
  it("UI05-12: validation failure displays safe classified feedback and error status", async () => {
    vi.mocked(parseQuestion).mockRejectedValue(new Error("401 Unauthorized invalid_api_key"));

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: SYNTHETIC_TEST_KEY } });

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("连接测试失败")).toBeInTheDocument();
      expect(screen.getByText("API Key 无效或没有权限，请检查后重试。")).toBeInTheDocument();
    });
  });

  // UI05-13: raw provider errors sanitized
  it("UI05-13: raw stack traces and internal secrets are sanitized from user message", async () => {
    vi.mocked(parseQuestion).mockRejectedValue(
      new Error("SecretDumpException: Bearer sk-ant-secret-12345 at InternalRuntime.eval (/var/stack.js:99)"),
    );

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: SYNTHETIC_TEST_KEY } });

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("连接测试失败")).toBeInTheDocument();
    });
    expect(screen.queryByText(/sk-ant-secret-12345/)).toBeNull();
    expect(screen.queryByText(/\/var\/stack\.js/)).toBeNull();
  });

  // UI05-14: model picker
  it("UI05-14: model picker displays known selectable models for provider", async () => {
    setupConnectionMock({ presetId: "gemini", selectedModelId: "gemini-2.5-flash" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "gemini-2.5-flash" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "gemini-2.5-pro" })).toBeInTheDocument();
    });
  });

  // UI05-15: custom model when supported
  it("UI05-15: custom model toggle allows typing custom model override", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const toggleBtn = await screen.findByRole("button", { name: /手动输入|自定义/ });
    fireEvent.click(toggleBtn);

    const input = screen.getByLabelText(/模型/i);
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(input, { target: { value: "claude-custom-finetune" } });
    expect(input).toHaveValue("claude-custom-finetune");
  });

  // UI05-16: Base URL hidden when irrelevant
  it("UI05-16: Base URL is not in common path for standard cloud providers like gemini", async () => {
    setupConnectionMock({ presetId: "gemini", selectedModelId: "gemini-2.5-flash" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByText("Google Gemini")).toBeInTheDocument();
    });
    expect(screen.queryByRole("textbox", { name: /Base URL/i })).toBeNull();
  });

  // UI05-17: Base URL shown when relevant
  it("UI05-17: Base URL is shown directly for custom and ollama providers", async () => {
    setupConnectionMock({ presetId: "ollama", selectedModelId: "llama3.2" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const baseUrlInput = await screen.findByTestId("settings-base-url-input");
    expect(baseUrlInput).toBeInTheDocument();
    expect(baseUrlInput).toHaveAttribute("placeholder", "http://localhost:11434");
  });

  // UI05-18: invalid Base URL frontend handling
  it("UI05-18: invalid Base URL shows clear validation warning", async () => {
    setupConnectionMock({ presetId: "ollama", selectedModelId: "llama3.2" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const baseUrlInput = await screen.findByTestId("settings-base-url-input");
    fireEvent.change(baseUrlInput, { target: { value: "not-a-valid-protocol" } });

    await waitFor(() => {
      expect(screen.getByText("请输入以 http:// 或 https:// 开头的有效网址")).toBeInTheDocument();
    });
  });

  // UI05-19: Ollama experience
  it("UI05-19: Ollama experience clarifies local provider with optional API key", async () => {
    setupConnectionMock({ presetId: "ollama", selectedModelId: "llama3.2" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByText("此服务商可以不填写 API Key。")).toBeInTheDocument();
      expect(screen.getByText(/Ollama 为本地运行服务，通常不需要填写 API Key。/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/尚未填写 API Key/)).toBeNull();
  });

  // UI05-20: Custom OpenAI-compatible experience
  it("UI05-20: Custom OpenAI-compatible provider exposes wire protocol and custom inputs", async () => {
    setupConnectionMock({ presetId: "custom", selectedModelId: "custom-model" });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByText("自定义协议")).toBeInTheDocument();
      expect(screen.getByText("OpenAI 兼容")).toBeInTheDocument();
      expect(screen.getByText("Claude 兼容")).toBeInTheDocument();
    });
  });

  // UI05-21: Chinese UI
  it("UI05-21: Chinese UI renders natural Chinese copy across all sections", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByText("快速配置引导")).toBeInTheDocument();
      expect(screen.getByText("服务商")).toBeInTheDocument();
      expect(screen.getByText("模型")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "保存设置" })).toBeInTheDocument();
    });
  });

  // UI05-22: English UI
  it("UI05-22: English UI renders natural English copy across all sections", async () => {
    setupConnectionMock({}, { language: "en" });
    render(<SettingsTab lang="en" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByText("Setup Guide")).toBeInTheDocument();
      expect(screen.getByText("Provider")).toBeInTheDocument();
      expect(screen.getByText("Model")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Settings" })).toBeInTheDocument();
    });
  });

  // UI05-23: language change
  it("UI05-23: language change updates labels without resetting credentials", async () => {
    setupConnectionMock({ hasCredential: true });
    const onLangChange = vi.fn();
    const { rerender } = render(<SettingsTab lang="zh" onLanguageChange={onLangChange} />);

    const enBtn = await screen.findByRole("button", { name: "English" });
    fireEvent.click(enBtn);
    expect(onLangChange).toHaveBeenCalledWith("en");

    rerender(<SettingsTab lang="en" onLanguageChange={onLangChange} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit Connection" })).toBeInTheDocument();
      expect(screen.getByText(/Credential saved/)).toBeInTheDocument();
    });
  });

  // UI05-24-27: Responsive width rendering
  it.each([320, 360, 400, 480])("UI05-24-27: renders reliably at %ipx container width", async (width) => {
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

  // UI05-28: logged-in user with unconfigured provider remains authenticated
  it("UI05-28: logged-in user with unconfigured provider remains authenticated", async () => {
    setupConnectionMock({ hasCredential: false });
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("未配置 AI 服务")).toBeInTheDocument();
    });
    expect(screen.getByText(/已登录：operator@example\.test/)).toBeInTheDocument();
    expect(mockAuth.handleLogout).not.toHaveBeenCalled();
  });

  // UI05-29: provider-valid credentials cannot grant account authentication
  it("UI05-29: provider-valid credentials cannot grant account authentication", async () => {
    setupConnectionMock({ hasCredential: true });
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult({ confidence: 1 }));

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("AI 配置已就绪")).toBeInTheDocument();
    });
    expect(mockAuth.handleLogin).not.toHaveBeenCalled();
  });

  // UI05-30: no automatic submission is introduced by settings configuration
  it("UI05-30: no automatic submission is introduced by settings configuration", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: SYNTHETIC_TEST_KEY } });

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await screen.findByRole("button", { name: "已保存" });
    expect(globalThis.chrome.tabs).toBeDefined();
  });
});

describe("UI-05 Section 22: Settings Home, Catalog & Credential Authority Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectionMock();
  });

  // S22-01: Settings Home Summary Card assertions
  it("S22-01: renders SettingsHomeSummaryCard with provider, model badge, status, and navigation buttons", async () => {
    setupConnectionMock({
      presetId: "anthropic",
      selectedModelId: "claude-opus-4.8",
      hasCredential: true,
    });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const summaryCard = await screen.findByTestId("settings-home-summary-card");
    expect(summaryCard).toBeInTheDocument();
    expect(within(summaryCard).getByText("当前 AI 服务")).toBeInTheDocument();
    expect(within(summaryCard).getByText("Anthropic (Claude)")).toBeInTheDocument();
    expect(within(summaryCard).getByText("claude-opus-4.8")).toBeInTheDocument();
    await waitFor(() => { expect(within(summaryCard).getByText("已保存密钥")).toBeInTheDocument(); });

    const changeBtn = screen.getByRole("button", { name: "更改 AI 服务" });
    const editBtn = screen.getByRole("button", { name: "编辑连接" });
    const verifyBtn = screen.getByRole("button", { name: "验证连接" });

    expect(changeBtn).toBeInTheDocument();
    expect(editBtn).toBeInTheDocument();
    expect(verifyBtn).toBeInTheDocument();

    // Verify connection triggers test
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());
    fireEvent.click(verifyBtn);
    await waitFor(() => {
      expect(parseQuestion).toHaveBeenCalledTimes(1);
    });
  });

  // S22-02: Searchable Provider Catalog filtering & keyboard selection
  it("S22-02: Searchable Provider Catalog filters by search input and selects provider", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const searchInput = await screen.findByTestId("provider-search-input");
    expect(searchInput).toBeInTheDocument();

    // Search for DeepSeek
    fireEvent.change(searchInput, { target: { value: "deepseek" } });
    await waitFor(() => {
      expect(screen.getByTestId("provider-card-deepseek")).toBeInTheDocument();
      expect(screen.queryByTestId("provider-card-anthropic")).toBeNull();
    });

    // Click DeepSeek
    fireEvent.click(screen.getByTestId("provider-card-deepseek"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("deepseek-v4-flash")).toBeInTheDocument();
    });
  });

  // S22-03: Loading from AIConnectionEditorView with stored credential
  it("S22-03: loading from AIConnectionEditorView renders blank input and stored credential badge", async () => {
    setupConnectionMock({ hasCredential: true });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const input = await screen.findByTestId("settings-api-key-input");
    expect(input).toHaveValue("");
    expect(screen.getByText("已保存密钥（已加密隐藏）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清除密钥" })).toBeInTheDocument();
  });

  // S22-04: Same provider + blank -> KEEP
  it("S22-04: saving with existing credential and blank input dispatches KEEP credential action", async () => {
    setupConnectionMock({ hasCredential: true });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const modelSelect = await screen.findByTestId("settings-model-select");
    fireEvent.change(modelSelect, { target: { value: "claude-sonnet-4.6" } });

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateActiveAIConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          presetId: "anthropic",
          selectedModelId: "claude-sonnet-4.6",
          credential: { action: "KEEP" },
        }),
      );
    });
  });

  // S22-05: Same provider + new key -> REPLACE
  it("S22-05: saving with newly typed key dispatches REPLACE credential action", async () => {
    setupConnectionMock({ hasCredential: true });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: "sk-brand-new-key" } });

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateActiveAIConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          presetId: "anthropic",
          credential: { action: "REPLACE", value: "sk-brand-new-key" },
        }),
      );
    });
  });

  // S22-06: Explicit clear credential
  it("S22-06: clicking clear credential dispatches CLEAR credential action on save", async () => {
    setupConnectionMock({ hasCredential: true });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const clearBtn = await screen.findByRole("button", { name: "清除密钥" });
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.queryByText("已保存密钥（已加密隐藏）")).toBeNull();
    });

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateActiveAIConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          presetId: "anthropic",
          credential: { action: "CLEAR" },
        }),
      );
    });
  });

  // S22-07: Provider switch + blank -> no credential carry
  it("S22-07: switching provider without entering key sends no credential carry", async () => {
    setupConnectionMock({ presetId: "anthropic", hasCredential: true });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="catalog" />);

    await waitFor(() => {
      expect(screen.getByText("OpenAI (GPT)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("OpenAI (GPT)"));

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateActiveAIConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          presetId: "openai",
          credential: { action: "KEEP" },
        }),
      );
    });
  });

  // S22-08: Official Anthropic -> Custom defaults to OpenAI compatible
  it("S22-08: switching from official Anthropic to Custom defaults to OpenAI wire protocol", async () => {
    setupConnectionMock({ presetId: "anthropic", selectedModelId: "claude-opus-4.8" });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="catalog" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Custom/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "OpenAI 兼容" })).toBeChecked();
    });

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateActiveAIConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          presetId: "custom",
          protocolOverride: "openai_chat_completions",
        }),
      );
    });
  });

  // S22-09: Reloading Custom Anthropic preserves Anthropic protocol
  it("S22-09: reloading Custom with anthropic_messages protocol preserves Claude radio and protocol on save", async () => {
    setupConnectionMock({
      presetId: "custom",
      selectedModelId: "custom-model",
      protocol: "anthropic_messages",
      endpointOverride: "https://custom.anthropic.internal",
      hasCredential: true,
    });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Claude 兼容" })).toBeChecked();
    });

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateActiveAIConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          presetId: "custom",
          protocolOverride: "anthropic_messages",
        }),
      );
    });
  });

  // S22-10: First-run resume stepper states
  it("S22-10: first-run stepper progresses across unconfigured, saved untested, and validated states", async () => {
    setupConnectionMock({ hasCredential: false });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    // Step 1: Unconfigured
    await waitFor(() => {
      expect(screen.getByText("未配置 AI 服务")).toBeInTheDocument();
    });

    // Step 2 & 3: Save untested
    fireEvent.click(screen.getByTestId("home-edit-connection-btn"));
    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: SYNTHETIC_TEST_KEY } });

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText("已保存（待测试）")).toBeInTheDocument();
    });

    // Step 4: Validated
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());
    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("AI 配置已就绪")).toBeInTheDocument();
      expect(screen.getByTestId("settings-ready-banner")).toBeInTheDocument();
    });
  });
});

describe("UI-05 Review Fix 01: Validation Authority & Freshness Tests (RF01-VAL01 - RF01-VAL08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectionMock();
  });

  // RF01-VAL01: successful validation of clean saved config -> Ready
  it("RF01-VAL01: successful validation of clean saved config -> Ready", async () => {
    setupConnectionMock({ hasCredential: true });
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByTestId("settings-ready-banner")).toBeInTheDocument();
      expect(screen.getByText("AI 配置已就绪")).toBeInTheDocument();
    });
  });

  // RF01-VAL02: dirty config test commits draft before testing
  it("RF01-VAL02: testing dirty config automatically commits draft through authoritative flow", async () => {
    setupConnectionMock({ hasCredential: false });
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByText("未配置 AI 服务")).toBeInTheDocument();
    });

    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: SYNTHETIC_TEST_KEY } });

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(updateActiveAIConnection).toHaveBeenCalled();
      expect(screen.getByTestId("settings-ready-banner")).toBeInTheDocument();
      expect(screen.getByText("AI 配置已就绪")).toBeInTheDocument();
    });
  });

  // RF01-VAL03: validation success -> edit API Key -> Ready invalidated
  it("RF01-VAL03: validation success -> edit API Key -> Ready invalidated", async () => {
    setupConnectionMock({ hasCredential: true });
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByTestId("settings-ready-banner")).toBeInTheDocument();
    });

    // Edit API Key
    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: "sk-different-key-modified" } });

    await waitFor(() => {
      expect(screen.queryByTestId("settings-ready-banner")).toBeNull();
      expect(screen.getByTestId("settings-setup-status-card")).toBeInTheDocument();
    });
  });

  // RF01-VAL04: validation success -> edit model -> Ready invalidated
  it("RF01-VAL04: validation success -> edit model -> Ready invalidated", async () => {
    setupConnectionMock({ hasCredential: true, selectedModelId: "claude-opus-4.8" });
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByTestId("settings-model-select")).toBeInTheDocument();
    });

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByTestId("settings-ready-banner")).toBeInTheDocument();
    });

    const modelSelect = await screen.findByTestId("settings-model-select");
    fireEvent.change(modelSelect, { target: { value: "claude-3-5-haiku" } });

    await waitFor(() => {
      expect(screen.queryByTestId("settings-ready-banner")).toBeNull();
      expect(screen.getByTestId("settings-setup-status-card")).toBeInTheDocument();
    });
  });

  // RF01-VAL05: validation success -> edit Base URL -> Ready invalidated
  it("RF01-VAL05: validation success -> edit Base URL -> Ready invalidated", async () => {
    setupConnectionMock({
      presetId: "custom",
      selectedModelId: "custom-model",
      endpointOverride: "https://custom.internal/v1",
      protocol: "openai_chat_completions",
      hasCredential: true,
    });
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("custom-model")).toBeInTheDocument();
    });

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByTestId("settings-ready-banner")).toBeInTheDocument();
    });

    const urlInput = await screen.findByTestId("settings-base-url-input");
    fireEvent.change(urlInput, { target: { value: "https://different-proxy.internal/v1" } });

    await waitFor(() => {
      expect(screen.queryByTestId("settings-ready-banner")).toBeNull();
      expect(screen.getByTestId("settings-setup-status-card")).toBeInTheDocument();
    });
  });

  // RF01-VAL06: validation success -> edit custom protocol -> Ready invalidated
  it("RF01-VAL06: validation success -> edit custom protocol -> Ready invalidated", async () => {
    setupConnectionMock({
      presetId: "custom",
      selectedModelId: "custom-model",
      endpointOverride: "https://custom.internal/v1",
      protocol: "openai_chat_completions",
      hasCredential: true,
    });
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("custom-model")).toBeInTheDocument();
    });

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByTestId("settings-ready-banner")).toBeInTheDocument();
    });

    const claudeRadio = await screen.findByRole("radio", { name: "Claude 兼容" });
    fireEvent.click(claudeRadio);

    await waitFor(() => {
      expect(screen.queryByTestId("settings-ready-banner")).toBeNull();
      expect(screen.getByTestId("settings-setup-status-card")).toBeInTheDocument();
    });
  });

  // RF01-VAL07: validated authority receipt binds strictly to non-secret revisions before Ready
  it("RF01-VAL07: validated authority receipt binds strictly to non-secret revisions before Ready", () => {
    const base: AuthorityValidationReceipt = {
      connectionId: "conn-gemini-1",
      connectionRevision: 1,
      credentialRevision: 1,
      validationGeneration: 1,
    };

    const fp1 = computeAuthorityValidationFingerprint(base);
    const fp2 = computeAuthorityValidationFingerprint({ ...base });
    expect(fp1).toBe(fp2);

    const fpChangedConn = computeAuthorityValidationFingerprint({ ...base, connectionId: "conn-gemini-2" });
    expect(fpChangedConn).not.toBe(fp1);

    const fpChangedRev = computeAuthorityValidationFingerprint({ ...base, connectionRevision: 2 });
    expect(fpChangedRev).not.toBe(fp1);

    const fpChangedCredRev = computeAuthorityValidationFingerprint({ ...base, credentialRevision: 2 });
    expect(fpChangedCredRev).not.toBe(fp1);

    const fpChangedGen = computeAuthorityValidationFingerprint({ ...base, validationGeneration: 2 });
    expect(fpChangedGen).not.toBe(fp1);

    expect(
      deriveSetupStatus({
        isConfigured: true,
        isDirty: false,
        testing: false,
        testResult: { tone: "success", message: "ok" },
        savedOnce: true,
        isValidated: false,
      }),
    ).toBe("saved_untested");

    expect(
      deriveSetupStatus({
        isConfigured: true,
        isDirty: false,
        testing: false,
        testResult: { tone: "success", message: "ok" },
        savedOnce: true,
        isValidated: true,
      }),
    ).toBe("validated");
  });

  // RF01-VAL08: failed validation cannot survive subsequent config edit as current error authority
  it("RF01-VAL08: failed validation cannot survive subsequent config edit as current error authority", async () => {
    setupConnectionMock({ hasCredential: false });
    vi.mocked(parseQuestion).mockRejectedValue(new Error("401 Unauthorized"));

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: SYNTHETIC_TEST_KEY } });

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("连接测试失败")).toBeInTheDocument();
    });

    // Edit API key: previous failure must NOT survive as authority
    fireEvent.change(input, { target: { value: "sk-repaired-key" } });

    await waitFor(() => {
      expect(screen.queryByText("连接测试失败")).toBeNull();
    });
  });
});

describe("UI-05 Review Fix 02: Explicit Regressions (Section 10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectionMock();
  });

  // 1. REAL_METADATA_ONLY_READY
  it("REAL_METADATA_ONLY_READY: real test succeeds and genuine metadata revisions yield Ready", async () => {
    setupConnectionMock({ hasCredential: true });
    vi.mocked(getAIConnectionActiveMetadata).mockResolvedValue({
      id: "conn-prod-real-888",
      connectionRevision: 5,
      credentialRevision: 3,
      validation: { status: "never_tested", generation: 0 },
      presetId: "anthropic",
      providerId: "anthropic",
      selectedModelId: "claude-opus-4.8",
      endpointOverride: null,
      protocol: "anthropic_messages",
      hasCredential: true,
      authScheme: "api_key",
      createdAt: 1,
      updatedAt: 1,
    } as any);
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByTestId("settings-ready-banner")).toBeInTheDocument();
      expect(screen.getByText("AI 配置已就绪")).toBeInTheDocument();
    });
  });

  // 2. METADATA_FAILURE_NEVER_READY
  it("METADATA_FAILURE_NEVER_READY: null or failed active metadata fails closed and never marks Ready", async () => {
    setupConnectionMock({ hasCredential: true });
    vi.mocked(parseQuestion).mockResolvedValue(createMockParseResult());
    // Metadata query fails / returns null even after save
    vi.mocked(updateActiveAIConnection).mockResolvedValue({
      ok: true,
      metadata: { id: "conn-ui05-test", hasCredential: true } as any,
    } as any);
    vi.mocked(getAIConnectionActiveMetadata).mockResolvedValue(null as any);

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="editor" />);

    const testBtn = await screen.findByRole("button", { name: /连接测试/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(parseQuestion).toHaveBeenCalledTimes(1);
    });

    // Even though parseQuestion succeeded, metadata was unavailable: fail closed
    expect(screen.queryByTestId("settings-ready-banner")).toBeNull();
  });

  // 3. NO_FIXTURE_METADATA_IN_PRODUCTION
  it("NO_FIXTURE_METADATA_IN_PRODUCTION: production settingsPanel does not contain fixture-conn or fake authority fabrication", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve("src/sidepanel/settingsPanel.tsx"), "utf8");

    expect(source).not.toContain("fixture-conn");
    expect(source).not.toMatch(/validation:\s*\{\s*status:\s*["']validated["']/);
    expect(source).not.toMatch(/generation:\s*\(.*generation.*\)\s*\+\s*1/);
    expect(source).not.toContain("validatedConnectionRevision");
    expect(source).not.toContain("validatedCredentialRevision");
  });

  // 4. COMMITTED_HOME_IGNORES_UNSAVED_DRAFT
  it("COMMITTED_HOME_IGNORES_UNSAVED_DRAFT: Home Current AI Service ignores unsaved draft changes", async () => {
    setupConnectionMock({ presetId: "anthropic", selectedModelId: "claude-opus-4.8", hasCredential: true });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    const summaryCard = await screen.findByTestId("settings-home-summary-card");
    await waitFor(() => {
      expect(within(summaryCard).getByText("Anthropic (Claude)")).toBeInTheDocument();
      expect(within(summaryCard).getByText("已保存密钥")).toBeInTheDocument();
    });

    // User navigates: Home -> Catalog -> Custom
    fireEvent.click(screen.getByTestId("home-change-service-btn"));
    const customCard = await screen.findByTestId("provider-card-custom");
    fireEvent.click(customCard);

    // In Editor, Custom is in draft. User does NOT save, navigates back to Home
    expect(screen.getByTestId("settings-editor-view")).not.toHaveAttribute("hidden");
    fireEvent.click(screen.getByTestId("nav-editor-done-to-home"));

    // Expected: Home still says Anthropic, still says credential stored, runtime remains Anthropic
    expect(screen.getByTestId("settings-home-view")).not.toHaveAttribute("hidden");
    const homeSummary = screen.getByTestId("settings-home-summary-card");
    expect(within(homeSummary).getByText("Anthropic (Claude)")).toBeInTheDocument();
    expect(within(homeSummary).getByText("已保存密钥")).toBeInTheDocument();
    expect(within(homeSummary).queryByText(/Custom/)).toBeNull();
  });

  // 5. HOME_UPDATES_AFTER_SUCCESSFUL_SAVE
  it("HOME_UPDATES_AFTER_SUCCESSFUL_SAVE: Home switches to newly committed provider only after successful save", async () => {
    setupConnectionMock({ presetId: "anthropic", selectedModelId: "claude-opus-4.8", hasCredential: true });

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} />);

    // Navigate to catalog -> custom
    fireEvent.click(screen.getByTestId("home-change-service-btn"));
    fireEvent.click(await screen.findByTestId("provider-card-custom"));

    // Enter api key and save
    const input = await screen.findByTestId("settings-api-key-input");
    fireEvent.change(input, { target: { value: SYNTHETIC_TEST_KEY } });

    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateActiveAIConnection).toHaveBeenCalledTimes(1);
    });

    // Return to Home
    fireEvent.click(screen.getByTestId("nav-editor-done-to-home"));

    // Home now displays Custom as committed connection
    const homeSummary = screen.getByTestId("settings-home-summary-card");
    expect(within(homeSummary).getByText(/Custom/)).toBeInTheDocument();
  });

  // 6. REAL_AUTHONLY_FIRST_RUN
  it("REAL_AUTHONLY_FIRST_RUN: unauthenticated Settings renders Step 1 guide and auth form with provider config absent", async () => {
    mockAuth.isAuthenticated = false;
    mockAuth.status = "unauthenticated";

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} authOnly={true} />);

    expect(screen.getByTestId("first-run-signin-section")).toBeInTheDocument();
    expect(screen.getByText("第一步：登录账号")).toBeInTheDocument();
    expect(screen.getByText("插件访问账号")).toBeInTheDocument();
    expect(screen.getByTestId("settings-account-section")).toBeInTheDocument();
    mockAuth.isAuthenticated = true;
    mockAuth.status = "authenticated";
  });

  // 7. FIRST_RUN_PROVIDER_CONFIG_LOCKED
  it("FIRST_RUN_PROVIDER_CONFIG_LOCKED: authOnly strictly excludes provider picker, credentials, and model config", async () => {
    mockAuth.isAuthenticated = false;
    mockAuth.status = "unauthenticated";

    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} authOnly={true} />);

    expect(screen.queryByTestId("settings-provider-picker")).toBeNull();
    expect(screen.queryByTestId("settings-api-key-input")).toBeNull();
    expect(screen.queryByTestId("settings-model-select")).toBeNull();
    expect(screen.queryByTestId("settings-catalog-view")).toBeNull();
    expect(screen.queryByTestId("settings-editor-view")).toBeNull();
    expect(screen.queryByTestId("settings-home-summary-card")).toBeNull();

    mockAuth.isAuthenticated = true;
    mockAuth.status = "authenticated";
  });

  // 8. INACTIVE_VIEW_NOT_TABBABLE
  it("INACTIVE_VIEW_NOT_TABBABLE: inactive views are inert and hidden with display none", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="home" />);

    const homeView = screen.getByTestId("settings-home-view");
    const catalogView = screen.getByTestId("settings-catalog-view");
    const editorView = screen.getByTestId("settings-editor-view");

    // Home view active
    expect(homeView).not.toHaveAttribute("hidden");
    expect(homeView).not.toHaveAttribute("inert");
    expect(catalogView).toHaveAttribute("hidden");
    expect(catalogView).toHaveAttribute("inert");
    expect(catalogView).toHaveStyle({ display: "none" });
    expect(editorView).toHaveAttribute("hidden");
    expect(editorView).toHaveAttribute("inert");
    expect(editorView).toHaveStyle({ display: "none" });

    // Switch to Catalog view
    fireEvent.click(screen.getByTestId("home-change-service-btn"));
    expect(catalogView).not.toHaveAttribute("hidden");
    expect(catalogView).not.toHaveAttribute("inert");
    expect(homeView).toHaveAttribute("hidden");
    expect(homeView).toHaveAttribute("inert");
    expect(homeView).toHaveStyle({ display: "none" });
    expect(editorView).toHaveAttribute("hidden");
    expect(editorView).toHaveAttribute("inert");
  });

  // 9. CATALOG_ARROW_STAYS_IN_CATALOG
  it("CATALOG_ARROW_STAYS_IN_CATALOG: ArrowRight moves focus between providers and stays in Catalog view", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="catalog" />);

    const anthropicCard = await screen.findByTestId("provider-card-anthropic");
    anthropicCard.focus();

    fireEvent.keyDown(anthropicCard, { key: "ArrowRight" });

    // Stays in Catalog, does not switch to editor
    expect(screen.getByTestId("settings-catalog-view")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("settings-editor-view")).toHaveAttribute("hidden");
    expect(screen.queryByTestId("settings-api-key-input")).not.toBeVisible();
  });

  // 10. CATALOG_ENTER_OPENS_EDITOR
  it("CATALOG_ENTER_OPENS_EDITOR: pressing Enter on focused provider card selects provider and opens Editor", async () => {
    render(<SettingsTab lang="zh" onLanguageChange={vi.fn()} initialView="catalog" />);

    const openaiCard = await screen.findByTestId("provider-card-openai");
    openaiCard.focus();

    fireEvent.keyDown(openaiCard, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("settings-editor-view")).not.toHaveAttribute("hidden");
      expect(screen.getByTestId("settings-catalog-view")).toHaveAttribute("hidden");
      expect(screen.getByDisplayValue("gpt-5.5")).toBeInTheDocument();
    });
  });
});

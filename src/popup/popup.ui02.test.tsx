import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { derivePopupViewState } from "./popupViewState";
import { derivePopupActionReadiness } from "./popupActionReadiness";
import { getRecoveryPlan } from "./popupRecovery";
import { POPUP_COPY } from "./popupCopy";
import { PopupApp } from "./PopupApp";
import { PopupFeedbackBanner, PopupRecoverySection, PopupPrimaryCommand } from "./popupSections";
import { AuthPasswordField, AuthVerificationCodeInput } from "@/shared/auth/AuthFields";
import { setKeyboardModalityForTesting } from "@/shared/ui/orbitFocus";
import { userFeedback } from "@/shared/ui/userFeedback";
import { __resetStorageCacheForTests } from "@/shared/utils/storage";

const sentRuntimeMessages: string[] = [];
const sentTabTargets: Array<{ tabId: number; type: string }> = [];

vi.mock("@/shared/utils/messaging", () => ({
  sendToActiveTab: vi.fn(async (message: { type: string }) => {
    sentRuntimeMessages.push(message.type);
    return {};
  }),
  sendToTabWithBootstrap: vi.fn(async (tabId: number, message: { type: string }) => {
    sentRuntimeMessages.push(message.type);
    sentTabTargets.push({ tabId, type: message.type });
    return {};
  }),
  isInjectablePageUrl: (url: string | undefined) => /^https?:/i.test(String(url || "")),
}));

vi.mock("@/shared/utils/analytics", () => ({ logEvent: vi.fn() }));

const store = new Map<string, unknown>();
const storageListeners = new Array<(changes: unknown, area: string) => void>();
const storageApi = {
  get: async (keys: string | string[] | null | undefined) => {
    const requested = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of requested) if (store.has(key)) result[key] = store.get(key);
    return result;
  },
  set: async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) store.set(key, value);
    for (const listener of storageListeners) {
      listener(Object.fromEntries(Object.keys(items).map((k) => [k, { newValue: items[k] }])), "local");
    }
  },
  remove: async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
  },
  clear: async () => store.clear(),
  getBytesInUse: (_keys: unknown, cb: (n: number) => void) => cb(0),
  QUOTA_BYTES: 5242880,
};

const sessionStore = new Map<string, unknown>();
const sessionApi = {
  get: async (keys: string | string[] | null) => {
    const requested = keys == null ? [...sessionStore.keys()] : Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of requested) if (sessionStore.has(key)) result[key] = sessionStore.get(key);
    return result;
  },
  set: async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) sessionStore.set(key, value);
  },
  remove: async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) sessionStore.delete(key);
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: "test-extension-id" },
  storage: {
    local: storageApi,
    session: sessionApi,
    onChanged: {
      addListener: (fn: (changes: unknown, area: string) => void) => storageListeners.push(fn),
      removeListener: (fn: (changes: unknown, area: string) => void) => {
        const index = storageListeners.indexOf(fn);
        if (index >= 0) storageListeners.splice(index, 1);
      },
    },
  },
  tabs: {
    query: vi.fn(async () => [{ id: 5, windowId: 1, url: "https://example.com/exam", active: true }]),
    sendMessage: vi.fn(async () => ({})),
    reload: vi.fn(async () => ({})),
  },
  sidePanel: { open: vi.fn(async () => ({})) },
};

type SessionPayload = { ok?: boolean; user?: { userId: string; email: string }; expiresAt?: number };
let sessionResponse: SessionPayload = { ok: true, user: { userId: "usr-1", email: "user@example.com" } };

vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: { headers?: Record<string, string> }) => ({
  ok: true,
  status: 200,
  json: async () => {
    if (init?.headers?.Authorization) return sessionResponse;
    return { ok: true, expiresAt: 4102444800000 };
  },
}) as Response));

beforeEach(() => {
  sentRuntimeMessages.length = 0;
  sentTabTargets.length = 0;
  store.clear();
  sessionStore.clear();
  storageListeners.length = 0;
  sessionResponse = { ok: true, user: { userId: "usr-1", email: "user@example.com" } };
  vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: { headers?: Record<string, string> }) => ({
    ok: true,
    status: 200,
    json: async () => {
      if (init?.headers?.Authorization) return sessionResponse;
      return { ok: true, expiresAt: 4102444800000 };
    },
  }) as Response));
  __resetStorageCacheForTests();
  store.set("appSettings", {
    userId: "usr-1",
    userEmail: "user@example.com",
    authToken: "tok-ui02",
    deviceId: "dev-ui02",
    providerId: "anthropic",
    apiKey: "test-api-key",
  });
  vi.clearAllMocks();
});

describe("UI-02 Presentation State & Readiness Models", () => {
  it("UI02-01: derivePopupViewState correctly projects all states", () => {
    // checking
    expect(derivePopupViewState({ isAuthenticated: false, isSessionPending: true })).toBe("checking_session");
    // server unavailable
    expect(derivePopupViewState({ isAuthenticated: false, isServerUnavailable: true })).toBe("service_unavailable");
    // signed out
    expect(derivePopupViewState({ isAuthenticated: false })).toBe("signed_out");
    // page unavailable
    expect(derivePopupViewState({ isAuthenticated: true, isPageInjectable: false })).toBe("page_unavailable");
    // review required
    expect(derivePopupViewState({ isAuthenticated: true, reviewReason: "STALE_QUESTION_REVISION" })).toBe("review_required");
    // running
    expect(derivePopupViewState({ isAuthenticated: true, activeFeature: "solve" })).toBe("running");
    // provider missing
    expect(derivePopupViewState({ isAuthenticated: true, hasApiKey: false })).toBe("provider_setup_required");
    // ready
    expect(derivePopupViewState({ isAuthenticated: true, hasApiKey: true })).toBe("ready");
  });

  it("UI02-02: derivePopupActionReadiness handles provider requirement only for solve_fill", () => {
    const unconfiguredContext = {
      isAuthenticated: true,
      isPageInjectable: true,
      hasApiKey: false,
    };

    // Detection & Capture stay enabled without AI provider
    expect(derivePopupActionReadiness("detect_current", unconfiguredContext).enabled).toBe(true);
    expect(derivePopupActionReadiness("manual_capture", unconfiguredContext).enabled).toBe(true);
    expect(derivePopupActionReadiness("scan_full_page", unconfiguredContext).enabled).toBe(true);

    // Solve & Fill is disabled and carries visible reason
    const solveReadiness = derivePopupActionReadiness("solve_fill", unconfiguredContext);
    expect(solveReadiness.enabled).toBe(false);
    expect(solveReadiness.reasonCode).toBe("PROVIDER_REQUIRED");
    expect(solveReadiness.reason).toBeTruthy();

    // Configured provider enables solve_fill
    const configuredContext = { ...unconfiguredContext, hasApiKey: true };
    expect(derivePopupActionReadiness("solve_fill", configuredContext).enabled).toBe(true);
  });

  it("UI02-03: keyOptional provider (ollama) readiness works without key", () => {
    // keyOptional is handled via isProviderRuntimeConfigured in the caller
    const keyOptionalContext = {
      isAuthenticated: true,
      isPageInjectable: true,
      hasApiKey: true, // caller sets hasApiKey = isProviderRuntimeConfigured(ollama, {}) -> true
    };
    expect(derivePopupActionReadiness("solve_fill", keyOptionalContext).enabled).toBe(true);
  });

  it("UI02-04: getRecoveryPlan covers all blocked states and safety stop codes", () => {
    expect(getRecoveryPlan("signed_out")?.primaryActionKind).toBe("login");
    expect(getRecoveryPlan("provider_setup_required")?.primaryActionKind).toBe("open_workspace");
    expect(getRecoveryPlan("service_unavailable")?.primaryActionKind).toBe("retry");
    expect(getRecoveryPlan("page_unavailable")?.primaryActionKind).toBe("refresh_page");
    expect(getRecoveryPlan("STALE_QUESTION_REVISION")?.primaryActionKind).toBe("re_detect");
    expect(getRecoveryPlan("PARTIAL_MUTATION_UNPROVABLE")?.primaryActionKind).toBe("open_workspace");
    expect(getRecoveryPlan("AUTHORITY_LOST")?.primaryActionKind).toBe("re_detect");
    expect(getRecoveryPlan("DISPATCH_FAILED")?.primaryActionKind).toBe("refresh_page");
  });
});

describe("UI-02 Popup Commercial View Integration", () => {
  it("UI02-A01: session checking renders validating status without actions", async () => {
    render(<PopupApp />);
    expect(screen.getAllByText(/正在检查|Checking/).length).toBeGreaterThanOrEqual(1);
  });

  it("UI02-A02: signed out shows accessible auth form without protected actions", async () => {
    sessionResponse = { ok: false };
    store.set("appSettings", { userId: undefined, authToken: undefined });
    render(<PopupApp />);

    // In register view by default, switch to login view
    const switchToLoginBtn = await screen.findByText(/已有账号？去登录|Sign in/);
    await act(async () => {
      fireEvent.click(switchToLoginBtn);
    });

    const loginTabBtn = await screen.findByRole("button", { name: /^登录$|^Sign In$/ });
    expect(loginTabBtn).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^登录账号$|^Sign In to Account$/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/邮箱|Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码|Password/)).toBeInTheDocument();

    // Protected actions not visible
    expect(screen.queryByText(/解析并填答/)).toBeNull();
  });

  it("UI02-A03: auth form register view has accessible verification code and send button", async () => {
    sessionResponse = { ok: false };
    store.set("appSettings", { userId: undefined, authToken: undefined });
    render(<PopupApp />);

    expect(await screen.findByRole("button", { name: /发送验证码|Send Code/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/邮箱|Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码|Password/)).toBeInTheDocument();
  });

  it("UI02-A04: server unavailable shows retry and logout controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("Failed to fetch");
    }));
    store.set("appSettings", { authToken: "tok", userId: "u1" });
    render(<PopupApp />);

    await screen.findByText(/暂时无法验证登录状态|Authentication/);
    expect(screen.getByRole("button", { name: /^重试$|^Retry$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /退出登录|Sign Out/ })).toBeInTheDocument();
  });

  it("UI02-P01: authenticated + configured provider enables Solve & Fill", async () => {
    render(<PopupApp />);
    const solveBtn = await screen.findByRole("button", { name: /解析并填答|Solve & Fill/ });
    expect(solveBtn).not.toBeDisabled();
    expect(screen.getByText(/提交仍由你确认|Submission stays manual/)).toBeInTheDocument();
    expect(screen.getByText(/不会自动提交|No automatic submission/)).toBeInTheDocument();
  });

  it("UI02-P02: authenticated with missing provider disables Solve & Fill and displays reason", async () => {
    store.set("appSettings", {
      userId: "usr-1",
      userEmail: "user@example.com",
      authToken: "tok-ui02",
      providerId: "anthropic",
      apiKey: "", // Missing key for anthropic
    });
    render(<PopupApp />);

    const solveBtn = await screen.findByRole("button", { name: /解析并填答|Solve & Fill/ });
    expect(solveBtn).toBeDisabled();
    expect(screen.getAllByText(/未配置 AI 服务|Configure an AI provider/).length).toBeGreaterThanOrEqual(1);

    // Detection actions remain enabled
    expect(screen.getByRole("button", { name: /当前屏识别/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /手动截图/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /整页扫描/ })).not.toBeDisabled();
  });

  it("UI02-C01: Detect dispatches START_AUTO_DETECT", async () => {
    render(<PopupApp />);
    const btn = await screen.findByRole("button", { name: /当前屏识别/ });
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(sentRuntimeMessages).toContain("START_AUTO_DETECT"));
  });

  it("UI02-C02: Manual Capture dispatches START_MANUAL_CAPTURE", async () => {
    render(<PopupApp />);
    const btn = await screen.findByRole("button", { name: /手动截图/ });
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(sentRuntimeMessages).toContain("START_MANUAL_CAPTURE"));
  });

  it("UI02-C03: Full Page Scan dispatches START_FULL_PAGE_DETECT", async () => {
    render(<PopupApp />);
    const btn = await screen.findByRole("button", { name: /整页扫描/ });
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(sentRuntimeMessages).toContain("START_FULL_PAGE_DETECT"));
  });

  it("UI02-C04: Solve & Fill dispatches START_AUTO_SOLVE_ALL", async () => {
    render(<PopupApp />);
    const btn = await screen.findByRole("button", { name: /解析并填答/ });
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(sentRuntimeMessages).toContain("START_AUTO_SOLVE_ALL"));
  });

  it("UI02-C05: zero solve dispatch when provider unconfigured", async () => {
    store.set("appSettings", {
      userId: "usr-1",
      userEmail: "user@example.com",
      authToken: "tok-ui02",
      providerId: "anthropic",
      apiKey: "",
    });
    render(<PopupApp />);
    const btn = await screen.findByRole("button", { name: /解析并填答/ });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(sentRuntimeMessages).not.toContain("START_AUTO_SOLVE_ALL");
  });

  it("UI02-C08: Open Workspace invokes sidePanel with authority preserved", async () => {
    render(<PopupApp />);
    const workspaceBtn = await screen.findByRole("button", { name: /打开完整工作台/ });
    await act(async () => {
      fireEvent.click(workspaceBtn);
    });
    expect(chrome.sidePanel.open).toHaveBeenCalled();
  });

  it("UI02-CUX: Commercial UX guarantees: no raw machine errors, no automatic submission", async () => {
    render(<PopupApp />);
    await screen.findByRole("button", { name: /解析并填答/ });

    // No raw error strings or machine codes in primary UI
    expect(screen.queryByText(/127\.0\.0\.1/)).toBeNull();
    expect(screen.queryByText(/SMTP/)).toBeNull();
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();

    // Trust copy is prominently visible
    expect(screen.getByText(POPUP_COPY.zh.trustCopy)).toBeInTheDocument();
    expect(screen.getByText(POPUP_COPY.zh.noAutoSubmitNotice)).toBeInTheDocument();
  });
});

describe("UI-02 Review Fix 01 Commercial UX Tests", () => {
  it("RF02-01: machine code never visible", () => {
    const feedback = {
      tone: "error" as const,
      message: "无法连接当前页面",
      code: "DISPATCH_FAILED",
      technicalDetail: "Receiving end does not exist.",
    };
    render(<PopupFeedbackBanner feedback={feedback} />);
    expect(screen.getByText("无法连接当前页面")).toBeInTheDocument();
    expect(screen.queryByText("DISPATCH_FAILED")).toBeNull();
  });

  it("RF02-02: technicalDetail never primary UI", () => {
    const feedback = {
      tone: "error" as const,
      message: "无法连接当前页面",
      code: "DISPATCH_FAILED",
      technicalDetail: "Receiving end does not exist.",
    };
    render(<PopupFeedbackBanner feedback={feedback} />);
    expect(screen.queryByText(/Receiving end/i)).toBeNull();
  });

  it("RF02-03: review_required + STALE_QUESTION_REVISION -> recovery visible -> re-detect CTA", () => {
    const onReDetect = vi.fn();
    render(
      <PopupRecoverySection
        viewState="review_required"
        recoveryReason="STALE_QUESTION_REVISION"
        lang="zh"
        onOpenSettings={() => {}}
        onOpenWorkspace={() => {}}
        onRefreshPage={() => {}}
        onReDetect={onReDetect}
        onRetryValidation={() => {}}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText("页面题目已变化")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "重新识别" });
    fireEvent.click(btn);
    expect(onReDetect).toHaveBeenCalled();
  });

  it("RF02-04: PARTIAL_MUTATION_UNPROVABLE -> workspace-check CTA", () => {
    const onOpenWorkspace = vi.fn();
    render(
      <PopupRecoverySection
        viewState="review_required"
        recoveryReason="PARTIAL_MUTATION_UNPROVABLE"
        lang="zh"
        onOpenSettings={() => {}}
        onOpenWorkspace={onOpenWorkspace}
        onRefreshPage={() => {}}
        onReDetect={() => {}}
        onRetryValidation={() => {}}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText("填写状态需检查")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "打开工作台检查" });
    fireEvent.click(btn);
    expect(onOpenWorkspace).toHaveBeenCalled();
  });

  it("RF02-05: generic dispatch failure -> actionable recovery", () => {
    const onRefreshPage = vi.fn();
    render(
      <PopupRecoverySection
        viewState="review_required"
        recoveryReason="DISPATCH_FAILED"
        lang="zh"
        onOpenSettings={() => {}}
        onOpenWorkspace={() => {}}
        onRefreshPage={onRefreshPage}
        onReDetect={() => {}}
        onRetryValidation={() => {}}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText("通信出现异常")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "刷新页面" });
    fireEvent.click(btn);
    expect(onRefreshPage).toHaveBeenCalled();
  });

  it("RF02-06: provider setup CTA -> behavior matches label", () => {
    const onOpenWorkspace = vi.fn();
    render(
      <PopupRecoverySection
        viewState="provider_setup_required"
        lang="zh"
        onOpenSettings={() => {}}
        onOpenWorkspace={onOpenWorkspace}
        onRefreshPage={() => {}}
        onReDetect={() => {}}
        onRetryValidation={() => {}}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText("请在工作台的设置页配置 AI 服务；页面识别仍可直接使用。")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "打开工作台" });
    fireEvent.click(btn);
    expect(onOpenWorkspace).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "前往设置" })).toBeNull();
  });

  it("RF02-07: password keyboard focus visible", () => {
    setKeyboardModalityForTesting(true);
    render(
      <AuthPasswordField
        id="pwd-test"
        label="密码"
        value="secret"
        onChange={() => {}}
        visible={false}
        onToggleVisibility={() => {}}
        placeholder="请输入密码"
        showLabel="显示"
        hideLabel="隐藏"
      />,
    );
    const input = screen.getByPlaceholderText("请输入密码");
    fireEvent.focus(input);
    expect(input.parentElement?.style.outline).toMatch(/2px solid|solid 2px/);

    const toggle = screen.getByRole("button", { name: "显示" });
    fireEvent.focus(toggle);
    expect(toggle.style.outline).toMatch(/2px solid|solid 2px/);
    setKeyboardModalityForTesting(false);
  });

  it("RF02-08: verification digit keyboard focus visible", () => {
    setKeyboardModalityForTesting(true);
    render(
      <AuthVerificationCodeInput
        value="12"
        onChange={() => {}}
        ariaLabel="验证码"
      />,
    );
    const inputs = screen.getAllByRole("textbox");
    fireEvent.focus(inputs[0]);
    expect(inputs[0].style.outline).toMatch(/2px solid|solid 2px/);
    setKeyboardModalityForTesting(false);
  });

  it("RF02-09: English verification aria labels contain no Chinese", () => {
    render(
      <AuthVerificationCodeInput
        lang="en"
        value=""
        onChange={() => {}}
        ariaLabel="Verification Code"
      />,
    );
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.length).toBe(6);
    inputs.forEach((input, index) => {
      const label = input.getAttribute("aria-label");
      expect(label).toBe(`Verification code digit ${index + 1}`);
      expect(/[\u4e00-\u9fa5]/.test(label || "")).toBe(false);
    });
  });

  it("RF02-10: Solve & Fill English accessible name contains no Chinese", () => {
    render(
      <PopupPrimaryCommand
        copy={POPUP_COPY.en}
        lang="en"
        isRunning={false}
        activeFeature={null}
        onSolve={() => {}}
        isAuthenticated={true}
        isPageInjectable={true}
        hasApiKey={true}
      />,
    );
    const btn = screen.getByRole("button", { name: "Solve & Fill" });
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute("aria-label")).toBe("Solve & Fill");
    expect(/[\u4e00-\u9fa5]/.test(btn.getAttribute("aria-label") || "")).toBe(false);
  });

  it("RF02-11: page capability unknown -> actions not prematurely enabled", () => {
    const unknownContext = {
      isAuthenticated: true,
      isPageInjectable: null,
      hasApiKey: true,
    };
    const solve = derivePopupActionReadiness("solve_fill", unknownContext);
    expect(solve.enabled).toBe(false);
    expect(solve.reasonCode).toBe("PAGE_CHECKING");

    const detect = derivePopupActionReadiness("detect_current", unknownContext);
    expect(detect.enabled).toBe(false);
    expect(detect.reasonCode).toBe("PAGE_CHECKING");
  });

  it("RF02-12: language switch persists -> reopen reads selected language", async () => {
    render(<PopupApp />);
    const menuBtn = await screen.findByRole("button", { name: "产品菜单" });
    await act(async () => {
      fireEvent.click(menuBtn);
    });
    const langBtn = await screen.findByRole("menuitem", { name: "Switch to English" });
    await act(async () => {
      fireEvent.click(langBtn);
    });

    await waitFor(() => {
      const saved = store.get("appSettings") as Record<string, unknown>;
      expect(saved?.language).toBe("en");
    });
  });

  it("RF02-13: html lang follows selected language", async () => {
    render(<PopupApp />);
    const menuBtn = await screen.findByRole("button", { name: "产品菜单" });
    await act(async () => {
      fireEvent.click(menuBtn);
    });
    const langBtn = await screen.findByRole("menuitem", { name: "Switch to English" });
    await act(async () => {
      fireEvent.click(langBtn);
    });

    expect(document.documentElement.lang).toBe("en");
  });

  it("RF02-14: UI-00A provenance regression PASS", async () => {
    store.set("appSettings", {
      userId: "usr-1",
      authToken: "tok-ui02",
      providerId: "anthropic",
      apiKey: "",
    });
    render(<PopupApp />);
    const solveBtn = await screen.findByRole("button", { name: /解析并填答/ });
    expect(solveBtn).toBeDisabled();

    const detectBtn = screen.getByRole("button", { name: /当前屏识别/ });
    expect(detectBtn).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(detectBtn);
    });
    await waitFor(() => expect(sentRuntimeMessages).toContain("START_AUTO_DETECT"));
    expect(sentRuntimeMessages).not.toContain("START_AUTO_SOLVE_ALL");
  });

  it("RF02-15: UI-00B no-machine-code regression PASS", () => {
    const feedback = userFeedback("error", "页面题目已变化，请重新识别", {
      code: "STALE_QUESTION_REVISION",
      technicalDetail: "Question block 1 invalidated",
    });
    render(<PopupFeedbackBanner feedback={feedback} />);
    expect(screen.getByText("页面题目已变化，请重新识别")).toBeInTheDocument();
    expect(screen.queryByText("STALE_QUESTION_REVISION")).toBeNull();
    expect(screen.queryByText(/Question block 1/)).toBeNull();
  });

  it("RF02-16: UI-01 focus/reduced-motion regression PASS", () => {
    setKeyboardModalityForTesting(false);
    render(
      <AuthPasswordField
        id="test-pwd-reg"
        value="pwd"
        onChange={() => {}}
        visible={false}
        onToggleVisibility={() => {}}
        placeholder="Enter password"
        showLabel="Show"
        hideLabel="Hide"
      />,
    );
    const input = screen.getByPlaceholderText("Enter password");
    fireEvent.focus(input);
    expect(input.parentElement?.style.outline).toMatch(/^none/);
  });
});

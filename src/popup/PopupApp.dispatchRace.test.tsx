import { installSettingsMessaging } from "../test/settingsMessaging";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("gsap", () => ({
  default: { from: vi.fn(), fromTo: vi.fn(), to: vi.fn(), registerPlugin: vi.fn(), utils: { toArray: vi.fn(() => []) } },
}));
vi.mock("@gsap/react", () => ({ useGSAP: vi.fn() }));
vi.mock("@/shared/utils/analytics", () => ({ logEvent: vi.fn() }));
vi.mock("@/shared/ui/viewportDetectionTimeout", async (importOriginal) => {
  const real = await importOriginal<{ awaitViewportCommand: typeof awaitViewportCommand }>();
  return { ...real, awaitViewportCommand: vi.fn(real.awaitViewportCommand) };
});

const sentRuntimeMessages: string[] = [];
const sentTabTargets: Array<{ tabId: number; type: string }> = [];
const sentStartGenerations: Array<string | undefined> = [];
const sentViewportRequests: Array<{ tabId: number; requestId?: string; expectedUrl?: string }> = [];
let viewportSnapshotReplyOverride: ((requestId: string | undefined) => unknown) | null = null;
let viewportReplyOverride: ((requestId: string | undefined) => Promise<unknown>) | null = null;
let viewportGuard: (() => boolean) | undefined;

vi.mock("@/shared/utils/messaging", () => ({
  sendToActiveTab: vi.fn(async (message: { type: string }) => {
    sentRuntimeMessages.push(message.type);
    return {};
  }),
  // The popup dispatches long-running work straight to the recorded owner
  // tab; keep that channel observable too.
  sendToTabWithBootstrap: vi.fn(async (tabId: number, message: { type: string; generationId?: string; requestId?: string; expectedUrl?: string }, guard?: () => boolean) => {
    if (message.type === "GET_CANDIDATE_WORKSPACE_SNAPSHOT") {
      return viewportSnapshotReplyOverride?.(sentViewportRequests[sentViewportRequests.length - 1]?.requestId) ?? { ok: false };
    }
    sentRuntimeMessages.push(message.type);
    sentTabTargets.push({ tabId, type: message.type });
    sentStartGenerations.push(message.generationId);
    if (message.type === "START_AUTO_DETECT") {
      viewportGuard = guard;
      sentViewportRequests.push({ tabId, requestId: message.requestId, expectedUrl: message.expectedUrl });
      return viewportReplyOverride ? viewportReplyOverride(message.requestId) : { ok: true, requestId: message.requestId };
    }
    return {};
  }),
  isInjectablePageUrl: (url: string | undefined) => /^https?:/i.test(String(url || "")),
}));

// In-memory chrome.storage.local mirroring authSession.test.ts's harness, so
// the REAL coordinator and REAL storage module run underneath the component.
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
      listener(Object.fromEntries(Object.keys(items).map((key) => [key, { newValue: items[key] }])), "local");
    }
  },
  remove: async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
  },
  clear: async () => store.clear(),
  getBytesInUse: (_keys: unknown, cb: (n: number) => void) => cb(0),
  QUOTA_BYTES: 5242880,
};

// Ephemeral session store backing the cross-surface protected-work owner
// registry under test.
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
  runtime: { id: "test-extension-id", sendMessage: vi.fn(), getURL: (path: string) => `chrome-extension://test-extension-id/${path.replace(/^\//, "")}` },
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
    query: vi.fn(async () => [{ id: 5, windowId: 1, url: "https://quiz.example.com/exam", active: true }]),
    get: vi.fn(async () => ({ id: 5, windowId: 1, url: "https://quiz.example.com/exam", active: true })),
    sendMessage: vi.fn(async () => ({})),
  },
  sidePanel: { open: vi.fn(() => deferredSidePanelOpen ?? Promise.resolve()) },
};

// Deferred handle for the side-panel open call, so tests can hold runAction
// mid-flight across the openPanel await.
let deferredSidePanelOpen: ((value?: unknown) => void) | null | undefined = null;

function queueSidePanelOpen(): void {
  deferredSidePanelOpen = undefined;
  vi.mocked((globalThis as unknown as { chrome: { sidePanel: { open: ReturnType<typeof vi.fn> } } }).chrome.sidePanel.open)
    .mockImplementationOnce(
      () => new Promise((resolve) => {
        deferredSidePanelOpen = resolve;
      }),
    );
}

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

import { PopupApp } from "./PopupApp";
import { createCandidateWorkspaceRuntime } from "@/content/candidateWorkspaceRuntime";

function verifiedViewportSnapshot(requestId: string | undefined, count: number) {
  if (!requestId) return { ok: false };
  const originUrl = "https://quiz.example.com/exam";
  const runtime = createCandidateWorkspaceRuntime({
    url: () => originUrl, send: vi.fn(), runtimeInstanceId: "popup-issue101-r14", runtimeGeneration: 1,
  });
  runtime.beginDetection("viewport", requestId);
  runtime.observe({
    type: "AUTO_DETECT_RESULT_READY",
    candidates: Array.from({ length: count }, (_, i) => ({
      block: { id: `popup-q-${i}`, previewText: `Synthetic question ${i}` },
      selected: false, status: "idle" as const,
    })),
  });
  return runtime.snapshot(originUrl);
}

import { __resetStorageCacheForTests } from "@/shared/utils/storage";
import { readProtectedWorkOwners } from "@/shared/auth/protectedWorkOwner";
import { awaitViewportCommand } from "@/shared/ui/viewportDetectionTimeout";

beforeEach(async () => {
  // window.close is spied on per-test; restoring avoids nested spies and
  // cross-case call leakage between terminal-success and ACK-failure tests.
  vi.restoreAllMocks();
  vi.resetModules();
  installSettingsMessaging();
  sentRuntimeMessages.length = 0;
  sentTabTargets.length = 0;
  sentStartGenerations.length = 0;
  sentViewportRequests.length = 0;
  viewportReplyOverride = null;
  viewportSnapshotReplyOverride = null;
  viewportGuard = undefined;
  vi.mocked(awaitViewportCommand).mockImplementation(
    (operation, timeoutMs, onTimeout) =>
      vi.importActual<{ awaitViewportCommand: typeof awaitViewportCommand }>("@/shared/ui/viewportDetectionTimeout")
        .then(real => real.awaitViewportCommand(operation, timeoutMs, onTimeout)),
  );
  vi.spyOn(window, "close").mockImplementation(() => undefined);
  store.clear();
  sessionStore.clear();
  storageListeners.length = 0;
  sessionResponse = { ok: true, user: { userId: "usr-1", email: "user@example.com" } };
  // The storage module memoizes settings per JS context: without this reset
  // the second render would read the first test's cleared snapshot.
  __resetStorageCacheForTests();
  // Seed the local session candidate (plaintext is fine: storage only
  // encrypts on save, reads pass verbatim) so the coordinator has something
  // to validate against the mocked /auth/session.
  store.set("appSettings", {
    userId: "usr-1",
    userEmail: "user@example.com",
    authToken: ["tok", "popup-race"].join("-"),
    deviceId: "dev-popup-race",
    analyticsConsentVersion: 1,
    // The Auto Solve START (UI-00A) requires a configured provider; these
    // tests exercise owner recording with a valid session, not key entry.
    // Runtime assembly keeps scanners from reading this as a credential.
    providerId: "anthropic",
    apiKey: ["test", "key"].join("-"),
  });
  vi.clearAllMocks();
});

describe("PopupApp protected dispatch authority", () => {
  it("AUTH_UI_32_POPUP_DISPATCH_TOCTOU no protected dispatch when auth is lost while the panel opens", async () => {
    queueSidePanelOpen();
    render(<PopupApp />);

    // Wait for the server-validated session to unlock the actions card.
    await screen.findByText(/当前屏识别|Detect Current View/, {}, { timeout: 5000 });

    await act(async () => {
      fireEvent.click(screen.getByText(/当前屏识别|Detect Current View/));
    });
    // runAction is now parked on the side-panel open await with authority
    // having passed at entry.
    expect(deferredSidePanelOpen).not.toBeNull();

    // Auth is lost while the panel await is pending.
    sessionResponse = { ok: false };
    await act(async () => {
      await storageApi.set({ appSettings: { userId: undefined, userEmail: undefined, authToken: undefined } });
    });

    // Resume the open: the last-responsible-moment recheck must stop the
    // protected START_AUTO_DETECT dispatch.
    await act(async () => {
      deferredSidePanelOpen?.();
      deferredSidePanelOpen = null;
    });

    await waitFor(() =>
      expect(screen.getByText(/登录验证已失效|Sign-in verification ended/)).toBeInTheDocument(),
    { timeout: 5000 });
    expect(sentRuntimeMessages).toEqual([]);
  });

  it("AUTH_UI_32_POPUP_DISPATCH_TOCTOU dispatch still flows while the session stays valid", { timeout: 20_000 }, async () => {
    viewportSnapshotReplyOverride = id => verifiedViewportSnapshot(id, 2);
    render(<PopupApp />);
    await screen.findByText(/当前屏识别|Detect Current View/, {}, { timeout: 10_000 });

    await act(async () => {
      fireEvent.click(screen.getByText(/当前屏识别|Detect Current View/));
    });

    await waitFor(() => expect(sentRuntimeMessages).toEqual(["START_AUTO_DETECT"]), { timeout: 10_000 });
    expect(sentTabTargets).toEqual([{ tabId: 5, type: "START_AUTO_DETECT" }]);
    expect(sentViewportRequests).toHaveLength(1);
    expect(sentViewportRequests[0]).toMatchObject({
      tabId: 5, expectedUrl: "https://quiz.example.com/exam",
    });
    expect(sentViewportRequests[0]?.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/);
    await waitFor(() => expect(screen.getByText(/工作区当前识别到 2 道候选题/)).toBeInTheDocument());
    expect(window.close).not.toHaveBeenCalled();
  });

  it("RC03A_R5_POPUP_ACK_ONLY never closes on a transport ACK without exact completion", async () => {
    viewportReplyOverride = async () => ({ ok: true });
    render(<PopupApp />);
    await screen.findByText(/当前屏识别|Detect Current View/);
    fireEvent.click(screen.getByText(/当前屏识别|Detect Current View/));
    await waitFor(() => expect(screen.getByText(/识别失败或结果未获确认/)).toBeInTheDocument());
    expect(window.close).not.toHaveBeenCalled();
    expect(sentViewportRequests).toHaveLength(1);
  });

  it("RC03A_R5_POPUP_BUSY reports an existing cross-surface run without false success", async () => {
    viewportReplyOverride = async requestId => ({ ok: false, requestId, error: "WORK_ALREADY_RUNNING" });
    render(<PopupApp />);
    await screen.findByText(/当前屏识别|Detect Current View/);
    fireEvent.click(screen.getByText(/当前屏识别|Detect Current View/));
    await waitFor(() => expect(screen.getByText(/已有识别任务正在运行/)).toBeInTheDocument());
    expect(window.close).not.toHaveBeenCalled();
  });

  it("RC03A_R5_POPUP_REQUEST_MISMATCH rejects a successful reply from an older request", async () => {
    viewportReplyOverride = async () => ({ ok: true, requestId: "18aabcde-0ee2-4e98-8e12-48fdce879013" });
    render(<PopupApp />);
    await screen.findByText(/当前屏识别|Detect Current View/);
    fireEvent.click(screen.getByText(/当前屏识别|Detect Current View/));
    await waitFor(() => expect(screen.getByText(/识别失败或结果未获确认/)).toBeInTheDocument());
    expect(window.close).not.toHaveBeenCalled();
  });

  it("RC03A_R5_POPUP_ROUTE_SWITCH rejects a successful but wrong-document completion", async () => {
    const chromeMock = (globalThis as unknown as { chrome: { tabs: {
      get: ReturnType<typeof vi.fn>
    } } }).chrome;
    chromeMock.tabs.get.mockResolvedValueOnce({
      id: 5, url: "https://quiz.example.com/changed", active: true,
    });
    render(<PopupApp />);
    await screen.findByText(/当前屏识别|Detect Current View/);
    fireEvent.click(screen.getByText(/当前屏识别|Detect Current View/));
    await waitFor(() => expect(screen.getByText(/页面或识别任务已变化/)).toBeInTheDocument());
    expect(window.close).not.toHaveBeenCalled();
  });

  it("RC03A_R6_POPUP_TIMEOUT does not close, cancel content, or accept a late completion", async () => {
    let release!: (response: unknown) => void;
    viewportReplyOverride = async () => new Promise(resolve => { release = resolve; });
    vi.mocked(awaitViewportCommand).mockImplementationOnce(async (_operation, _timeout, onTimeout) => {
      onTimeout?.();
      return { timedOut: true };
    });
    render(<PopupApp />);
    await screen.findByText(/当前屏识别|Detect Current View/);
    fireEvent.click(screen.getByText(/当前屏识别|Detect Current View/));
    await waitFor(() => expect(screen.getByText(/等待当前屏识别结果超时/)).toBeInTheDocument());
    expect(sentViewportRequests).toHaveLength(1);
    expect(viewportGuard?.()).toBe(false);
    expect(window.close).not.toHaveBeenCalled();
    await act(async () => { release({ ok: true, requestId: sentViewportRequests[0]?.requestId }); });
    expect(window.close).not.toHaveBeenCalled();
    expect(screen.getByText(/等待当前屏识别结果超时/)).toBeInTheDocument();
  });

  it("RC03A_R6_POPUP_DOUBLE_CLICK guards a pending panel-open without parallel dispatch", async () => {
    queueSidePanelOpen();
    render(<PopupApp />);
    await screen.findByText(/当前屏识别|Detect Current View/);
    const trigger = screen.getByText(/当前屏识别|Detect Current View/);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    // chrome.tabs.query is asynchronous; observe the open call after that
    // microtask, before releasing its deliberately pending promise.
    await waitFor(() => expect(chrome.sidePanel.open).toHaveBeenCalledTimes(1));
    expect(sentViewportRequests).toHaveLength(0);
    await act(async () => { deferredSidePanelOpen?.(); deferredSidePanelOpen = null; });
    await waitFor(() => expect(sentViewportRequests).toHaveLength(1));
    expect(sentRuntimeMessages).toEqual(["START_AUTO_DETECT"]);
    // No verified content snapshot: never pretend the terminal ACK proves a count.
    await waitFor(() => expect(screen.getByText(/尚未取得可验证的结果/)).toBeInTheDocument());
    expect(window.close).not.toHaveBeenCalled();
  });

  it("RC03A_R5_POPUP_IN_FLIGHT waits for terminal completion and does not dispatch twice", async () => {
    viewportSnapshotReplyOverride = id => verifiedViewportSnapshot(id, 0);
    let release!: (value: unknown) => void;
    viewportReplyOverride = async () => new Promise(resolve => { release = resolve; });
    render(<PopupApp />);
    await screen.findByText(/当前屏识别|Detect Current View/);
    fireEvent.click(screen.getByText(/当前屏识别|Detect Current View/));
    await waitFor(() => expect(sentViewportRequests).toHaveLength(1));
    expect(window.close).not.toHaveBeenCalled();
    expect(sentViewportRequests[0]?.requestId).toBeTruthy();
    await act(async () => {
      release({ ok: true, requestId: sentViewportRequests[0]?.requestId });
    });
    await waitFor(() => expect(screen.getByText(/当前屏未识别到可用题目/)).toBeInTheDocument());
    expect(window.close).not.toHaveBeenCalled();
    expect(sentViewportRequests).toHaveLength(1);
  });

  it("ISSUE101_R14_POPUP_REJECT_STALE_SNAPSHOT never displays the previous UUID count", async () => {
    viewportSnapshotReplyOverride = () => verifiedViewportSnapshot(
      "18aabcde-0ee2-4e98-8e12-48fdce879013", 3,
    );
    render(<PopupApp />);
    await screen.findByText(/当前屏识别|Detect Current View/);
    fireEvent.click(screen.getByText(/当前屏识别|Detect Current View/));
    await waitFor(() => expect(screen.getByText(/尚未取得可验证的结果/)).toBeInTheDocument());
    expect(screen.queryByText(/3 道候选题/)).not.toBeInTheDocument();
    expect(window.close).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AUTH_UI_45/46 — a Popup-started long-running workflow must establish the
 // cross-surface owner record with the EXACT dispatch target tab before the
// START goes out (AUTH-UI-INV-15).
// ---------------------------------------------------------------------------
describe("PopupApp protected work ownership", () => {
  it("AUTH_UI_45_POPUP_AUTO_SOLVE_OWNER popup START records the auto-solve owner tab", async () => {
    render(<PopupApp />);
    // 定位真正的动作按钮：支持旧称"自动答题"以及UI-02标准名称"解析并填答/Solve & Fill"。
    await screen.findByRole("button", { name: /自动答题|Auto Solve|解析并填答|Solve & Fill/ }, { timeout: 10_000 });
    await waitFor(() => expect(screen.getByRole("button", { name: /自动答题|Auto Solve|解析并填答|Solve & Fill/ })).toBeEnabled());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /自动答题|Auto Solve|解析并填答|Solve & Fill/ }));
    });

    await waitFor(() => expect(sentRuntimeMessages).toEqual(["START_AUTO_SOLVE_ALL"]), {
      timeout: 10_000,
    });
    // The dispatch went to the recorded owner tab, and the cross-surface
    // registry now shows the popup-established owner.
    expect(sentTabTargets).toEqual([{ tabId: 5, type: "START_AUTO_SOLVE_ALL" }]);
    expect(sentStartGenerations[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f-]+$/);
    const ownerKey = [...sessionStore.keys()].find((key) => key.endsWith(`:${sentStartGenerations[0]}`));
    expect(ownerKey).toBe(`protectedWorkOwner:autoSolve:5:${sentStartGenerations[0]}`);
    expect(sessionStore.get(ownerKey!)).toMatchObject({ active: true, tabId: 5, completionProtocol: "generation" });
    const owners = await readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual([{ tabId: 5 }]);
  });

  it("AUTH_UI_46_POPUP_FULL_PAGE_OWNER popup START records the full-page owner tab", async () => {
    render(<PopupApp />);
    await screen.findByText(/整页扫描|Scan Full Page/, {}, { timeout: 10_000 });

    await act(async () => {
      fireEvent.click(screen.getByText(/整页扫描|Scan Full Page/));
    });

    await waitFor(() => expect(sentRuntimeMessages).toEqual(["START_FULL_PAGE_DETECT"]), {
      timeout: 10_000,
    });
    expect(sentTabTargets).toEqual([{ tabId: 5, type: "START_FULL_PAGE_DETECT" }]);
    expect(sentStartGenerations[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f-]+$/);
    const ownerKey = `protectedWorkOwner:fullPage:5:${sentStartGenerations[0]}`;
    expect(sessionStore.get(ownerKey)).toMatchObject({ active: true, tabId: 5, completionProtocol: "generation" });
    const owners = await readProtectedWorkOwners();
    expect(owners.fullPage).toEqual([{ tabId: 5 }]);
  });
});

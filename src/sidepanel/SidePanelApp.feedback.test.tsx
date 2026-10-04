import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  CandidateWorkspaceSnapshot,
  ParseResult,
  QuestionBlock,
} from "@/shared/types";
import type * as ParseRouter from "@/shared/utils/parseRouter";
import { loadSettings } from "@/shared/utils/storage";
import { getAIConnectionReadiness } from "@/shared/utils/legacyRuntimeSettingsCompat";
import { readProtectedWorkOwners } from "@/shared/auth/protectedWorkOwner";
import { SidePanelApp } from "./SidePanelApp";

vi.mock("gsap", () => ({
  default: {
    registerPlugin: vi.fn(),
    from: vi.fn(),
    fromTo: vi.fn(),
    to: vi.fn(),
    utils: { toArray: () => [] },
  },
}));
vi.mock("@gsap/react", () => ({ useGSAP: vi.fn() }));
vi.mock("@/shared/utils/storage", () => ({
  loadSettings: vi.fn(async () => ({
    language: "en",
    providerId: "anthropic",
    apiKey: ["fixture", "key"].join("-"),
  })),
  saveSettings: vi.fn(),
  addHistoryEntryIfCurrent: vi.fn(async () => true),
}));
vi.mock("@/shared/utils/analytics", () => ({ logEvent: vi.fn() }));
vi.mock("@/shared/utils/parseRouter", async (importOriginal) => ({
  ...(await importOriginal<typeof ParseRouter>()),
  parseQuestion: vi.fn(
    async (b: QuestionBlock): Promise<ParseResult> => ({
      blockId: b.id,
      questionType: "single_choice",
      answer: "B",
      confidence: 0.99,
      briefExplanation: "2 + 2 = 4",
      detailedExplanation: "",
      recognizedText: b.previewText,
      resultSource: "provider",
      routeUsed: "text",
      optionSelections: { B: true },
    }),
  ),
}));
vi.mock("./tabActions", () => ({
  getBestActionTab: vi.fn(async () => ({ id: 7, url })),
  sendTabMessageWithBootstrap: vi.fn(async () => ({})),
  sendProtectedTabMessageWithBootstrap: vi.fn(async () => ({})),
  isCandidateResultAuthorityCurrent: vi.fn(async () => true),
  requestBlockImage: vi.fn(),
  sendFillMessageWithVerify: vi.fn(async () => fillResponse),
}));
vi.mock("./workspaceTarget", () => ({
  resolveWorkspaceOrigin: async () => ({ tabId: 7, url }),
  readWorkspaceOrigin: async () => ({ tabId: 7, url }),
  requestWorkspaceSnapshot: async () => ({
    ok: true,
    snapshot: snapshot(0, [{ block, selected: true, status: "idle" }]),
  }),
}));
vi.mock("@/shared/auth/useAuthSession", () => ({
  useAuthSession: () => session,
}));
const url = "https://quiz.example/exam";
const sessionListeners = new Set<() => void>();
const session = {
  getState: () => ({
    status: "authenticated",
    userEmail: "",
    sessionRejected: false,
  }),
  subscribe: (fn: () => void) => {
    sessionListeners.add(fn);
    return () => sessionListeners.delete(fn);
  },
  start: vi.fn(),
  dispose: vi.fn(),
  retryValidation: vi.fn(),
  applyLoggedOut: vi.fn(),
  handleStorageChanged: vi.fn(),
};
type Listener = (
  msg: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
) => void;
const listeners = new Set<Listener>();
const store = new Map<string, unknown>();
const event = { addListener: vi.fn(), removeListener: vi.fn() };
Object.assign(globalThis, {
  chrome: {
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => listeners.add(fn),
        removeListener: (fn: Listener) => listeners.delete(fn),
      },
    },
    tabs: { get: async (id: number) => ({ id, url }), onUpdated: event },
    storage: {
      onChanged: event,
      session: {
        get: async () => Object.fromEntries(store),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items))
            store.set(key, value);
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys])
            store.delete(key);
        },
      },
    },
  },
});
const block: QuestionBlock = {
  id: "q1",
  previewText:
    "Which of the following numbers is the correct result when adding two and two together? Choose one answer.\nA. 3\nB. 4\nC. 5\nD. 6",
  runtimeQuestionHandle: "feedback-runtime:q1",
  identity: {
    stableId: "q1",
    contentFingerprint: "q1-content",
    identityVersion: 1,
    strategy: "native-id",
    signals: {
      nativeId: true,
      content: true,
      options: true,
      media: false,
      structure: false,
    },
  },
  hasImage: false,
  questionTypeGuess: "single_choice",
  source: "auto_dom",
  confidence: 0.95,
  bbox: { x: 0, y: 0, width: 100, height: 40 },
};
function snapshot(
  seq: number,
  candidates: CandidateWorkspaceSnapshot["candidates"],
) {
  return {
    protocolVersion: 1,
    runtimeInstanceId: "feedback-runtime",
    runtimeGeneration: 1,
    routeEpoch: 0,
    seq,
    originUrl: url,
    disposed: false,
    detection: { phase: "completed", mode: "viewport" },
    candidates,
    autoSolve: { running: false, progress: null },
    fullPage: { running: false, progress: null },
  };
}
let fillResponse: {
  ok: boolean;
  filledCount?: number;
  message?: string;
  code?: string;
};
beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  store.clear();
  sessionListeners.clear();
  fillResponse = { ok: true, filledCount: 1 };
});
afterEach(cleanup);
async function mount(solve = false) {
  render(<SidePanelApp />);
  await screen.findByRole("button", { name: "Solve selected" });
  if (solve) {
    fireEvent.click(screen.getByRole("button", { name: "Solve selected" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Fill answer" })).toBeEnabled(),
    );
  }
}
async function message(msg: Record<string, unknown>, id = 7, senderUrl = url) {
  await act(async () => {
    for (const fn of listeners)
      fn(msg, { tab: { id, url: senderUrl } as chrome.tabs.Tab, frameId: 0 });
  });
}
const feedback = () => screen.queryByTestId("workspace-user-feedback");
describe("UI-04 real App/actions/bridge/hydration feedback wiring", () => {
  it("RF01-FB01 single Fill success", async () => {
    await mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Fill answer" }));
    await waitFor(() => expect(feedback()).toHaveTextContent("Fill completed"));
  });
  it("RF01-FB02 single Fill failure", async () => {
    fillResponse = {
      ok: false,
      message: "network request failed SECRET_DETAIL",
    };
    await mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Fill answer" }));
    await waitFor(() => expect(feedback()).not.toBeNull());
    expect(feedback()).not.toHaveTextContent("SECRET_DETAIL");
  });
  it("RF01-FB03 Batch Fill success", async () => {
    await mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Fill selected" }));
    await waitFor(() =>
      expect(feedback()).toHaveTextContent("Filled 1 fields across 1 question"),
    );
  });
  it("RF01-FB04 Batch Fill failure", async () => {
    fillResponse = {
      ok: false,
      message: "network request failed SECRET_DETAIL",
    };
    await mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Fill selected" }));
    await waitFor(() => expect(feedback()).not.toBeNull());
    expect(feedback()).not.toHaveTextContent("SECRET_DETAIL");
  });
  it("RF01-FB04 Batch Fill partial warning", async () => {
    await mount(true);
    const other = {
      ...block,
      id: "q2",
      runtimeQuestionHandle: "feedback-runtime:q2",
      identity: {
        ...block.identity!,
        stableId: "q2",
        contentFingerprint: "q2-content",
      },
    };
    await message({
      type: "CANDIDATE_WORKSPACE_UPDATED",
      snapshot: snapshot(1, [
        { block, selected: true, status: "idle" },
        { block: other, selected: true, status: "idle" },
      ]),
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill selected" }));
    await waitFor(() =>
      expect(feedback()).toHaveTextContent("1 more need to be re-parsed"),
    );
  });
  it("RF01-FB05 PROVIDER_NOT_CONFIGURED", async () => {
    await mount();
    vi.mocked(getAIConnectionReadiness).mockResolvedValueOnce({ ready: false, code: "AI_CREDENTIAL_REQUIRED" });
    vi.mocked(loadSettings).mockResolvedValueOnce({
      language: "en",
      providerId: "anthropic",
      apiKey: "",
    } as Awaited<ReturnType<typeof loadSettings>>);
    fireEvent.click(screen.getByRole("button", { name: "Solve & Fill" }));
    await waitFor(() => expect(feedback()).not.toBeNull());
    expect(feedback()).toHaveTextContent(/configur/i);
  });
  it.each([
    ["RF01-FB06", { ok: true, solved: 2, filled: 1 }, /finished/],
    ["RF01-FB07", { ok: false, stopped: true }, /stopped/],
    ["RF01-FB08", { ok: false, message: "SECRET_DETAIL" }, /problem/],
  ])("%s bound completion", async (_id, data, copy) => {
    await mount();
    await message({ type: "AUTO_SOLVE_DONE", ...data });
    await waitFor(() => expect(feedback()).toHaveTextContent(copy));
    expect(feedback()).not.toHaveTextContent("SECRET_DETAIL");
  });
  it("RF01-FB09 cross-tab and cross-URL completions ignored", async () => {
    await mount();
    await message({ type: "AUTO_SOLVE_DONE", ok: true }, 8);
    await message({ type: "AUTO_SOLVE_DONE", ok: true }, 7, url + "/other");
    await act(async () => {
      for (const fn of listeners) fn({ type: "AUTO_SOLVE_DONE", ok: true }, {});
    });
    expect(feedback()).toBeNull();
  });
  it("RF01-FB10 review feedback not duplicated", async () => {
    fillResponse = { ok: false, code: "FILL_VERIFICATION_FAILED" };
    await mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Fill answer" }));
    await waitFor(() =>
      expect(screen.getByTestId("workspace-activity-strip")).toBeVisible(),
    );
    expect(feedback()).toBeNull();
  });
  it("RF01-FB11 legacy messages cannot render candidates or progress", async () => {
    await mount();
    await message({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    await message({ type: "FULL_PAGE_DETECT_DONE", candidates: [] });
    await message({
      type: "AUTO_SOLVE_PROGRESS",
      running: true,
      current: 99,
      total: 99,
    });
    await message({ type: "AUTO_SOLVE_DONE", ok: true });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByTestId("workspace-activity-strip")).toBeNull();
  });
  it("RF01-FB12 valid snapshot replaces candidates; stale snapshots and legacy events do not", async () => {
    await mount();
    await message({
      type: "CANDIDATE_WORKSPACE_UPDATED",
      snapshot: snapshot(1, []),
    });
    await waitFor(() =>
      expect(screen.queryAllByRole("article")).toHaveLength(0),
    );
    await message({
      type: "AUTO_DETECT_RESULT_READY",
      candidates: [{ block, selected: true, status: "idle" }],
    });
    await message({
      type: "CANDIDATE_WORKSPACE_UPDATED",
      snapshot: snapshot(0, [{ block, selected: true, status: "idle" }]),
    });
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });
  it("ordinary completion feedback does not hide behind snapshot-owned running progress", async () => {
    await mount();
    await message({
      type: "CANDIDATE_WORKSPACE_UPDATED",
      snapshot: {
        ...snapshot(1, [{ block, selected: true, status: "idle" }]),
        autoSolve: {
          running: true,
          progress: {
            running: true,
            current: 1,
            total: 2,
            solved: 0,
            filled: 0,
            statusText: "",
          },
        },
      },
    });
    await message({ type: "AUTO_SOLVE_DONE", ok: true, solved: 1, filled: 1 });
    expect(feedback()).toHaveTextContent("finished");
    expect(screen.getByTestId("workspace-activity-strip")).toHaveTextContent(
      "Question 1 / 2",
    );
  });
  it("owner reconciliation remains global even when cross-tab feedback is rejected", async () => {
    await mount();
    await message({ type: "AUTO_SOLVE_PROGRESS", running: true }, 8);
    await waitFor(async () =>
      expect((await readProtectedWorkOwners()).autoSolve).toEqual([
        { tabId: 8 },
      ]),
    );
    await message({ type: "AUTO_SOLVE_DONE", ok: true }, 8);
    await waitFor(async () =>
      expect((await readProtectedWorkOwners()).autoSolve).toEqual([]),
    );
    expect(feedback()).toBeNull();
  });
  it("completion delayed by language loading is discarded after workspace invalidation", async () => {
    await mount();
    let resolve!: (settings: Awaited<ReturnType<typeof loadSettings>>) => void;
    vi.mocked(loadSettings).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await message({ type: "AUTO_SOLVE_DONE", ok: true });
    await message({
      type: "CANDIDATE_WORKSPACE_UPDATED",
      snapshot: { ...snapshot(1, []), disposed: true },
    });
    await act(async () =>
      resolve({ language: "en" } as Awaited<ReturnType<typeof loadSettings>>),
    );
    expect(feedback()).toBeNull();
  });
});

vi.mock("@/shared/utils/legacyRuntimeSettingsCompat", async () => {
  const storage = await import("@/shared/utils/storage");
  const { getProvider } = await import("@/shared/ai/providers");
  return {
    loadLegacyRuntimeSettingsCompat: () => storage.loadSettings(),
    getAIConnectionReadiness: vi.fn(async () => {
      const fixture = await storage.loadSettings();
      return { ready: getProvider(fixture.providerId).keyOptional === true || Boolean(fixture.apiKey?.trim()) };
    }),
  };
});

vi.mock("@/shared/utils/aiConnectionClient", () => ({ ensureAIConnectionAuthorityReady: vi.fn(async () => ({ ok: true })) }));

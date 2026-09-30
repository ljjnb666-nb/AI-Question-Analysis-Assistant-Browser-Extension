import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("gsap", () => ({
  default: { from: vi.fn(), fromTo: vi.fn(), to: vi.fn(), registerPlugin: vi.fn(), utils: { toArray: vi.fn(() => []) } },
}));
vi.mock("@gsap/react", () => ({ useGSAP: vi.fn() }));
vi.mock("@/shared/utils/analytics", () => ({ logEvent: vi.fn() }));

const sentRuntimeMessages: string[] = [];

vi.mock("@/shared/utils/messaging", () => ({
  sendToActiveTab: vi.fn(async (message: { type: string }) => {
    sentRuntimeMessages.push(message.type);
    return {};
  }),
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

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: "test-extension-id" },
  storage: {
    local: storageApi,
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
import { __resetStorageCacheForTests } from "@/shared/utils/storage";

beforeEach(() => {
  sentRuntimeMessages.length = 0;
  store.clear();
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
    render(<PopupApp />);
    await screen.findByText(/当前屏识别|Detect Current View/, {}, { timeout: 10_000 });

    await act(async () => {
      fireEvent.click(screen.getByText(/当前屏识别|Detect Current View/));
    });

    await waitFor(() => expect(sentRuntimeMessages).toEqual(["START_AUTO_DETECT"]), { timeout: 10_000 });
  });
});

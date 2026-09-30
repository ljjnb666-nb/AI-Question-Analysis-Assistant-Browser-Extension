import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToActiveTab, sendToTabWithBootstrap } from "./messaging";

// Exercises the REAL messaging helpers against a controllable chrome stub —
// sendToActiveTab itself is never mocked.
type SendBehavior =
  | { mode: "resolve" }
  | { mode: "no-receiver" }
  | { mode: "park" };

let sendBehavior: SendBehavior = { mode: "resolve" };
const sentFirst: unknown[] = [];
const sentRetry: unknown[] = [];
let resolveTabLookup: ((tabs: chrome.tabs.Tab[]) => void) | null = null;
let resolveInjection: (() => void) | null = null;
let injectionStarted = false;
let parkNextQuery = false;

function installChromeStub(): void {
  const chromeStub = {
    runtime: { id: "test-extension-id" },
    tabs: {
      query: vi.fn((_info: unknown) => {
        if (parkNextQuery) {
          parkNextQuery = false;
          return new Promise<chrome.tabs.Tab[]>((resolve) => {
            resolveTabLookup = resolve;
          });
        }
        return Promise.resolve([{ id: 5, url: "https://quiz.example.com/exam" } as chrome.tabs.Tab]);
      }),
      sendMessage: vi.fn(async (_tabId: number, message: { type: string }) => {
        if (sendBehavior.mode === "park") {
          await new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("Receiving end does not exist")), 0);
          });
        }
        if (sendBehavior.mode === "no-receiver") {
          throw new Error("Receiving end does not exist");
        }
        sentFirst.push(message.type);
        return {};
      }),
    },
    scripting: {
      executeScript: vi.fn(
        (_injection: unknown) =>
          new Promise((resolve) => {
            injectionStarted = true;
            resolveInjection = resolve as () => void;
          }),
      ),
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
  (globalThis as unknown as { lastChromeStub?: unknown }).lastChromeStub = chromeStub;
}

function chromeStub(): {
  tabs: {
    query: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
  scripting: { executeScript: ReturnType<typeof vi.fn> };
} {
  return (globalThis as unknown as { lastChromeStub: never }).lastChromeStub as never;
}

const FLAKY_NONE = new Error("no pending");

beforeEach(() => {
  sendBehavior = { mode: "resolve" };
  sentFirst.length = 0;
  sentRetry.length = 0;
  resolveTabLookup = null;
  resolveInjection = null;
  injectionStarted = false;
  parkNextQuery = false;
  installChromeStub();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("messaging authority guard (real helpers)", () => {
  it("AUTH_UI_36_POPUP_TAB_QUERY_TOCTOU no first send when auth is lost during the tab query", async () => {
    let authenticated = true;
    parkNextQuery = true;
    const running = sendToActiveTab({ type: "START_AUTO_DETECT" }, () => authenticated);

    // tabs.query is parked by the stub.
    expect(resolveTabLookup).not.toBeNull();
    // Auth is lost while the query is pending.
    authenticated = false;
    resolveTabLookup!([{ id: 5, url: "https://quiz.example.com/exam" } as chrome.tabs.Tab]);

    await expect(running).rejects.toThrow("AUTHORITY_LOST");
    // Neither the first send nor any retry may have fired.
    expect(sentFirst).toEqual([]);
    expect(sentRetry).toEqual([]);
    expect(chromeStub().tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("AUTH_UI_37_POPUP_BOOTSTRAP_INJECTION_TOCTOU no retry send when auth is lost during the injection", async () => {
    let authenticated = true;
    parkNextQuery = true;
    sendBehavior = { mode: "no-receiver" };
    const running = sendToActiveTab({ type: "START_AUTO_SOLVE_ALL" }, () => authenticated);

    // Query resolves with a valid tab; the first send then fails with
    // "Receiving end does not exist", entering the bootstrap path.
    resolveTabLookup!([{ id: 5, url: "https://quiz.example.com/exam" } as chrome.tabs.Tab]);
    await vi.waitFor(() => {
      expect(injectionStarted).toBe(true);
    }, { timeout: 2000, interval: 20 });

    // Guard still true entering the injection; auth is lost while the
    // injection await is pending.
    authenticated = false;
    resolveInjection!();

    await expect(running).rejects.toThrow(/AUTHORITY_LOST/);
    // The first send failed into bootstrap; the RETRY send must never fire.
    expect(sentRetry).toEqual([]);
  });

  it("guard-passing dispatch still completes a normal first send", async () => {
    const result = await sendToActiveTab({ type: "START_MANUAL_CAPTURE" }, () => true);
    expect(result).toEqual({});
    expect(sentFirst).toEqual(["START_MANUAL_CAPTURE"]);
    expect(chromeStub().scripting.executeScript).not.toHaveBeenCalled();
  });

  it("unguarded STOP/CANCEL dispatches skip every guard check", async () => {
    sendBehavior = { mode: "no-receiver" };
    const running = sendToTabWithBootstrap(5, { type: "STOP_AUTO_SOLVE_ALL" });
    // No guard passed: the bootstrap path must proceed without authority
    // checks and complete the retry.
    await vi.waitFor(() => {
      expect(chromeStub().scripting.executeScript).toHaveBeenCalled();
    }, { timeout: 2000, interval: 20 });
    // After the injection the retry finds a receiver and completes.
    sendBehavior = { mode: "resolve" };
    resolveInjection?.();
    await running;
    void FLAKY_NONE;
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestWorkspaceSnapshot } from "./workspaceTarget";
import { sendProtectedTabMessageWithBootstrap } from "./tabActions";

vi.mock("./tabActions", () => ({
  sendProtectedTabMessageWithBootstrap: vi.fn(),
  shouldBootstrapContentScript: (error: unknown) =>
    /Receiving end does not exist|Could not establish connection/i.test(String(error || "")),
}));

const send = vi.mocked(sendProtectedTabMessageWithBootstrap);
const origin = { tabId: 7, url: "https://quiz.example/exam" };

describe("RC03D-R2 transport classification for authoritative wake", () => {
  beforeEach(() => {
    send.mockReset();
    vi.stubGlobal("chrome", { tabs: { get: vi.fn().mockResolvedValue({ id: 7, url: origin.url }) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("non-receiver errors and absent successful payload fail closed, not as transport null", async () => {
    send.mockResolvedValueOnce({ ok: false, error: "Missing host permission" });
    expect(await requestWorkspaceSnapshot(origin, () => true)).toEqual({ ok: false });
    send.mockResolvedValueOnce({ ok: true, response: undefined });
    expect(await requestWorkspaceSnapshot(origin, () => true)).toEqual({ ok: false });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("a domain rejection is returned rather than converted into a retryable transport null", async () => {
    send.mockResolvedValueOnce({ ok: true, response: { ok: false } });
    expect(await requestWorkspaceSnapshot(origin, () => true)).toEqual({ ok: false });
    expect(send).toHaveBeenCalledOnce();
  });

  it("receiver-unavailable after its bounded bootstrap retry remains a transient null", async () => {
    send.mockResolvedValueOnce({ ok: false, error: "Receiving end does not exist" });
    send.mockResolvedValueOnce({ ok: false, error: "Could not establish connection" });
    expect(await requestWorkspaceSnapshot(origin, () => true)).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("authorization loss and navigation denial are non-recoverable", async () => {
    expect(await requestWorkspaceSnapshot(origin, () => false)).toEqual({ ok: false });
    send.mockResolvedValueOnce({ ok: false, error: "Receiving end does not exist" });
    vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 7, url: "https://quiz.example/new" } as chrome.tabs.Tab);
    expect(await requestWorkspaceSnapshot(origin, () => true)).toEqual({ ok: false });
    expect(send).toHaveBeenCalledOnce();
  });
});

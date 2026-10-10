import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendProtectedTabMessageWithBootstrap } from "./tabActions";
import { requestWorkspaceSnapshot } from "./workspaceTarget";

vi.mock("./tabActions", () => ({
  sendProtectedTabMessageWithBootstrap: vi.fn(),
}));

const origin = { tabId: 7, url: "https://quiz.example/exam" };
const sent = vi.mocked(sendProtectedTabMessageWithBootstrap);

describe("RC-PILOT-03D bounded workspace hydration transport retry", () => {
  let authenticated: boolean;
  let tabUrl: string;
  const auth = () => authenticated;

  beforeEach(() => {
    vi.clearAllMocks();
    authenticated = true;
    tabUrl = origin.url;
    vi.stubGlobal("chrome", {
      tabs: { get: vi.fn(async () => ({ id: origin.tabId, url: tabUrl })) },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("recovers a quick content receiver wake failure with ONE bounded retry", async () => {
    const verifiedResponse = { ok: true, snapshot: { protocolVersion: 1 } };
    sent.mockResolvedValueOnce({ ok: false, error: "Receiving end does not exist" })
      .mockResolvedValueOnce({ ok: true, response: verifiedResponse } as never);
    await expect(requestWorkspaceSnapshot(origin, auth)).resolves.toEqual(verifiedResponse);
    expect(sent).toHaveBeenCalledTimes(2);
    expect(sent).toHaveBeenNthCalledWith(1, origin.tabId, {
      type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl: origin.url,
    }, auth);
    expect(sent).toHaveBeenNthCalledWith(2, origin.tabId, {
      type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl: origin.url,
    }, auth);
  });

  it("fails closed after the second transport error, with no unbounded retries", async () => {
    sent.mockResolvedValue({ ok: false, error: "Could not establish connection" });
    expect(await requestWorkspaceSnapshot(origin, auth)).toBeNull();
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it("does not retry when authorization vanishes after the first attempt", async () => {
    sent.mockImplementationOnce(async () => {
      authenticated = false;
      return { ok: false, error: "AUTHORITY_LOST" };
    });
    expect(await requestWorkspaceSnapshot(origin, auth)).toBeNull();
    expect(sent).toHaveBeenCalledOnce();
  });

  it("does not retry into a new tab URL", async () => {
    sent.mockImplementationOnce(async () => {
      tabUrl = "https://quiz.example/other";
      return { ok: false, error: "Receiving end does not exist" };
    });
    expect(await requestWorkspaceSnapshot(origin, auth)).toBeNull();
    expect(sent).toHaveBeenCalledOnce();
  });

  it("does not retry invalid or unsuccessful domain payloads after successful transport", async () => {
    sent.mockResolvedValueOnce({ ok: true, response: { ok: false } } as never);
    await expect(requestWorkspaceSnapshot(origin, auth)).resolves.toEqual({ ok: false });
    expect(sent).toHaveBeenCalledOnce();
  });

  it("never dispatches to a content tab without a validated session", async () => {
    authenticated = false;
    expect(await requestWorkspaceSnapshot(origin, auth)).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });
});

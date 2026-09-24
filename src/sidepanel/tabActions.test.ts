import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestBlockImage, sendFillMessageWithVerify } from "./tabActions";

describe("sidepanel source tab screenshot authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not capture the active tab when it is different from the candidate origin", async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 42 }] as never);

    const result = await requestBlockImage(41, { x: 0, y: 0, width: 120, height: 60 });

    expect(result).toBeNull();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("does not retry a committed fill when fresh sidepanel verification fails", async () => {
    const messages: Array<{ type?: string }> = [];
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(((
      _tabId: number,
      message: { type?: string },
      callback: (response: unknown) => void,
    ) => {
      messages.push(message);
      callback(message.type === "FILL_PARSED_ANSWER"
        ? { ok: true, filledCount: 1, message: "FILLED_VERIFIED" }
        : { ok: false, message: "fresh state differed" });
    }) as never);

    const result = await sendFillMessageWithVerify(41, {} as never, {} as never, () => true);

    expect(messages.map((message) => message.type)).toEqual(["FILL_PARSED_ANSWER", "VERIFY_PARSED_ANSWER"]);
    expect(result).toMatchObject({ ok: false, filledCount: 0, code: "PARTIAL_MUTATION_UNPROVABLE", stopAutomation: true });
  });
});

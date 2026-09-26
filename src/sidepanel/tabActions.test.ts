import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
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

  it("does not repeat a failed fill transaction", async () => {
    const sendMessage = chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessage.mockImplementation((_tabId: number, _message: unknown, callback: (response: unknown) => void) => {
      callback({ ok: false, filledCount: 0, code: "FILL_VERIFICATION_FAILED", message: "write did not verify" });
    });

    const response = await sendFillMessageWithVerify(41, {} as QuestionBlock, {} as ParseResult, () => true);

    expect(response).toMatchObject({ ok: false, filledCount: 0, code: "FILL_VERIFICATION_FAILED" });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0]?.[1]).toMatchObject({ type: "FILL_PARSED_ANSWER" });
  });

  it("performs only a read-only verification after a successful fill", async () => {
    const sendMessage = chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>;
    const responses = [
      { ok: true, filledCount: 1 },
      { ok: false, message: "readback unavailable" },
    ];
    sendMessage.mockImplementation((_tabId: number, _message: unknown, callback: (response: unknown) => void) => {
      callback(responses.shift());
    });

    const response = await sendFillMessageWithVerify(41, {} as QuestionBlock, {} as ParseResult, () => true);

    expect(response).toMatchObject({ ok: false, filledCount: 0, code: "PARTIAL_MUTATION_UNPROVABLE" });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls.map((call: unknown[]) => (call[1] as { type: string }).type)).toEqual([
      "FILL_PARSED_ANSWER",
      "VERIFY_PARSED_ANSWER",
    ]);
  });
});

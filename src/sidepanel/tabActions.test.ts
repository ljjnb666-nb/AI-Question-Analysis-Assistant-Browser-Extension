import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestBlockImage } from "./tabActions";

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
});

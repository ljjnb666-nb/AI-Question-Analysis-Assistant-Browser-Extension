import { describe, expect, it, vi } from "vitest";
import { createViewportDetectionSingleFlight } from "./viewportDetectionSingleFlight";

describe("RC-PILOT-03A-03 cross-Surface viewport single-flight", () => {
  it("rejects concurrent Popup and Alt+W while Side Panel detection is pending", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const detect = vi.fn(() => pending);
    const start = createViewportDetectionSingleFlight(detect, () => true);
    const first = start("sidepanel-run");
    expect(first).not.toBe(false);
    expect(start("popup-run")).toBe(false);
    expect(start()).toBe(false);
    expect(detect).toHaveBeenCalledTimes(1);
    finish();
    await first;
    const next = start("popup-run");
    expect(next).not.toBe(false);
    await next;
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("releases single-flight after synchronous and asynchronous failures", async () => {
    const detect = vi.fn()
      .mockImplementationOnce(() => { throw new Error("sync"); })
      .mockRejectedValueOnce(new Error("async"))
      .mockResolvedValue(undefined);
    const start = createViewportDetectionSingleFlight(detect, () => true);
    await expect(start()).rejects.toThrow("sync");
    await expect(start()).rejects.toThrow("async");
    await expect(start()).resolves.toBeUndefined();
    expect(detect).toHaveBeenCalledTimes(3);
  });

  it("rejects starts after its owning runtime is retired", () => {
    const detect = vi.fn();
    const start = createViewportDetectionSingleFlight(detect, () => false);
    expect(start("old")).toBe(false);
    expect(detect).not.toHaveBeenCalled();
  });
});

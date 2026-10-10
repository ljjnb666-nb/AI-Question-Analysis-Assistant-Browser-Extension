import { afterEach, describe, expect, it, vi } from "vitest";
import { awaitViewportCommand } from "./viewportDetectionTimeout";

afterEach(() => vi.useRealTimers());

describe("RC-PILOT-03A-03 bounded viewport UI wait", () => {
  it("reports timeout once and does not convert a late success into a result", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { finish = resolve; });
    const expired = vi.fn();
    const awaiting = awaitViewportCommand(pending, 12_000, expired);
    await vi.advanceTimersByTimeAsync(11_999);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await awaiting).toEqual({ timedOut: true });
    expect(expired).toHaveBeenCalledTimes(1);
    finish("late-success");
    await Promise.resolve();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("accepts a prompt response without retaining an active timeout", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    expect(await awaitViewportCommand(Promise.resolve("ok"), 12_000, expired))
      .toEqual({ timedOut: false, value: "ok" });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(expired).not.toHaveBeenCalled();
  });

  it("propagates transport errors without relabeling them as timeouts", async () => {
    vi.useFakeTimers();
    await expect(awaitViewportCommand(Promise.reject(new Error("transport")), 12_000))
      .rejects.toThrow("transport");
  });
});

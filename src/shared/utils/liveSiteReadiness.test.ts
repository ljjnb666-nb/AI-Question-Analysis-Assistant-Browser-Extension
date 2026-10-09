import { describe, expect, it, vi } from "vitest";
import { visitLiveTargetUntilReady } from "./liveSiteReadiness";

type MockResponse = { status: () => number };
const http = (status: number): MockResponse => ({ status: () => status });

describe("Phase13A unowned public SPA content-ready retry gate", () => {
  it("PHASE13A_RETRY_01 repeats a successful HTTP 200 document whose real problem never rendered", async () => {
    const navigate = vi.fn().mockResolvedValue(http(200));
    const ready = vi.fn()
      .mockRejectedValueOnce(new Error("shell only"))
      .mockResolvedValueOnce(undefined);
    const delay = vi.fn(async () => undefined);

    const result = await visitLiveTargetUntilReady(navigate, ready, {
      maxAttempts: 3,
      betweenAttempts: delay,
    });

    expect(result).toMatchObject({ ready: true, attemptsUsed: 2, statusCodes: [200, 200] });
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("PHASE13A_RETRY_02 three HTTP 200 empty shells remain FAIL CLOSED", async () => {
    const navigate = vi.fn().mockResolvedValue(http(200));
    const ready = vi.fn().mockRejectedValue(new Error("title not rendered"));
    const delay = vi.fn(async () => undefined);

    const result = await visitLiveTargetUntilReady(navigate, ready, {
      maxAttempts: 3,
      betweenAttempts: delay,
    });

    expect(result).toMatchObject({ ready: false, attemptsUsed: 3, statusCodes: [200, 200, 200] });
    expect(ready).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("PHASE13A_RETRY_03 failed navigation and 503 cannot authorize content detection", async () => {
    const navigate = vi.fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(http(503))
      .mockResolvedValueOnce(http(200));
    const ready = vi.fn().mockResolvedValue(undefined);
    const delay = vi.fn(async () => undefined);

    const result = await visitLiveTargetUntilReady(navigate, ready, {
      maxAttempts: 3,
      betweenAttempts: delay,
    });

    expect(result).toMatchObject({ ready: true, attemptsUsed: 3, statusCodes: [0, 503, 200] });
    expect(ready).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("PHASE13A_RETRY_04 valid first visit does not retry", async () => {
    const navigate = vi.fn().mockResolvedValue(http(200));
    const ready = vi.fn().mockResolvedValue(undefined);
    const delay = vi.fn(async () => undefined);

    const result = await visitLiveTargetUntilReady(navigate, ready, {
      maxAttempts: 3,
      betweenAttempts: delay,
    });

    expect(result).toMatchObject({ ready: true, attemptsUsed: 1, statusCodes: [200] });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("PHASE13A_RETRY_05 redirects and HTTP 4xx are not mistaken for a hydrated public question", async () => {
    const navigate = vi.fn().mockResolvedValue(http(403));
    const ready = vi.fn().mockResolvedValue(undefined);
    const delay = vi.fn(async () => undefined);

    const result = await visitLiveTargetUntilReady(navigate, ready, {
      maxAttempts: 2,
      betweenAttempts: delay,
    });

    expect(result.ready).toBe(false);
    expect(result.statusCodes).toEqual([403, 403]);
    expect(ready).not.toHaveBeenCalled();
  });

  it("PHASE13A_RETRY_06 rejects unbounded retries", async () => {
    const navigate = vi.fn();
    const ready = vi.fn();
    const delay = vi.fn();
    await expect(visitLiveTargetUntilReady(navigate, ready, {
      maxAttempts: 100,
      betweenAttempts: delay,
    })).rejects.toThrow("LIVE_TARGET_ATTEMPTS_INVALID");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("ISSUE83_RETRY_07 a pending script must stop destructive revisits and fail closed", async () => {
    const navigate = vi.fn().mockResolvedValue(http(200));
    const ready = vi.fn().mockRejectedValue(new Error("blocked SPA script"));
    const delay = vi.fn(async () => undefined);
    const stopIfContentPending = vi.fn(() => true);
    const result = await visitLiveTargetUntilReady(navigate, ready, {
      maxAttempts: 3, betweenAttempts: delay, stopIfContentPending,
    });
    expect(result).toMatchObject({ ready: false, attemptsUsed: 1, statusCodes: [200] });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(stopIfContentPending).toHaveBeenCalledTimes(1);
  });

  it("ISSUE83_RETRY_08 a settled shell still retries normally with no fabricated PASS", async () => {
    const navigate = vi.fn().mockResolvedValue(http(200));
    const ready = vi.fn().mockRejectedValue(new Error("page did not hydrate"));
    const delay = vi.fn(async () => undefined);
    const stopIfContentPending = vi.fn(() => false);
    const result = await visitLiveTargetUntilReady(navigate, ready, {
      maxAttempts: 3, betweenAttempts: delay, stopIfContentPending,
    });
    expect(result).toMatchObject({ ready: false, attemptsUsed: 3, statusCodes: [200, 200, 200] });
    expect(navigate).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(stopIfContentPending).toHaveBeenCalledTimes(3);
  });
});

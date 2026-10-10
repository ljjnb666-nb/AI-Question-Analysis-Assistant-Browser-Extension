import { describe, expect, it, vi } from "vitest";
import { createCandidateWorkspaceRuntime } from "./candidateWorkspaceRuntime";
import { createContentRuntimeMessageListener } from "./contentRuntimeMessages";

const url = "https://quiz.example/exam";
const requestId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
const nextId = "18aabcde-0ee2-4e98-8e12-48fdce879013";

function fixture() {
  let page = url;
  let alive = true;
  const workspace = createCandidateWorkspaceRuntime({
    url: () => page, send: vi.fn(), runtimeInstanceId: "viewport-runtime", runtimeGeneration: 1,
  });
  const detect = vi.fn(async (id?: string) => {
    workspace.beginDetection("viewport", id);
    workspace.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
  });
  const options = {
    isRuntimeCurrent: () => alive,
    getWorkspaceSnapshot: workspace.snapshot,
    handleAutoDetect: detect,
    onViewportDetectError: workspace.failViewportDetection,
  } as unknown as Parameters<typeof createContentRuntimeMessageListener>[0];
  const listener = createContentRuntimeMessageListener(options);
  const call = async (id = requestId, expectedUrl = url) => {
    let finish!: (value: unknown) => void;
    const response = new Promise<unknown>((resolve) => { finish = resolve; });
    const keepalive = listener({ type: "START_AUTO_DETECT", requestId: id, expectedUrl }, {}, finish);
    const value = await response;
    return { keepalive, value };
  };
  return { workspace, detect, options, call, listener,
    move: () => { page = url + "/next"; workspace.resetRoute(); },
    dispose: () => { alive = false; workspace.dispose(); } };
}

describe("RC-PILOT-03A-02 current-screen request authority", () => {
  it("accepts only a completed result bound to this exact UUID", async () => {
    const f = fixture();
    const result = await f.call();
    expect(result).toEqual({ keepalive: true, value: { ok: true, requestId } });
    expect(f.detect).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(f.workspace.snapshot(url).snapshot?.detection).toEqual({
      phase: "completed", mode: "viewport", requestId,
    });
  });

  it("rejects invalid IDs and stale URL before any detection is invoked", async () => {
    const f = fixture();
    const invalid = await f.call("not-a-uuid");
    expect(invalid).toEqual({ keepalive: false, value: { ok: false, error: "INVALID_VIEWPORT_REQUEST" } });
    const stale = await f.call(requestId, "https://quiz.example/another");
    expect(stale).toEqual({ keepalive: false, value: { ok: false, error: "STALE_VIEWPORT_ORIGIN" } });
    expect(f.detect).not.toHaveBeenCalled();
  });

  it("rejects runtime route changes while a request is running", async () => {
    const f = fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    f.options.handleAutoDetect = vi.fn(async (id?: string) => {
      f.workspace.beginDetection("viewport", id);
      await pending;
    });
    const running = f.call();
    f.move();
    release();
    expect((await running).value).toEqual({ ok: false, requestId, error: "VIEWPORT_RESULT_NOT_CURRENT" });
    expect(f.workspace.snapshot(url).ok).toBe(false);
  });

  it("maps thrown detection errors to a stable code and clears its own running phase", async () => {
    const f = fixture();
    f.options.handleAutoDetect = vi.fn(async (id?: string) => {
      f.workspace.beginDetection("viewport", id);
      throw new Error("sensitive selector failure");
    });
    expect((await f.call()).value).toEqual({ ok: false, requestId, error: "VIEWPORT_DETECT_FAILED" });
    expect(f.workspace.snapshot(url).snapshot?.detection.phase).toBe("never_started");
  });

  it("rolls back an already emitted candidate snapshot when a downstream render step fails", async () => {
    const f = fixture();
    f.options.handleAutoDetect = vi.fn(async (id?: string) => {
      f.workspace.beginDetection("viewport", id);
      // The detector emitted a candidate result, then rendering failed.
      f.workspace.observe({ type: "AUTO_DETECT_RESULT_READY",
        candidates: [{ block: { id: "q1", previewText: "Question 1" }, status: "idle", selected: false }] });
      throw new Error("highlight rendering failed");
    });
    expect((await f.call()).value).toEqual({ ok: false, requestId, error: "VIEWPORT_DETECT_FAILED" });
    expect(f.workspace.snapshot(url).snapshot?.detection.phase).toBe("never_started");
    expect(f.workspace.snapshot(url).snapshot?.candidates).toEqual([]);
  });

  it("a failed older completion cannot clear an already completed newer request", async () => {
    const f = fixture();
    let rejectOld!: (error: unknown) => void;
    const pendingOld = new Promise<void>((_, reject) => { rejectOld = reject; });
    f.options.handleAutoDetect = vi.fn((id?: string) => {
      f.workspace.beginDetection("viewport", id);
      if (id === requestId) return pendingOld;
      f.workspace.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
      return Promise.resolve();
    });
    const older = f.call(requestId);
    expect((await f.call(nextId)).value).toEqual({ ok: true, requestId: nextId });
    rejectOld(new Error("older run failed late"));
    expect((await older).value).toEqual({ ok: false, requestId, error: "VIEWPORT_DETECT_FAILED" });
    expect(f.workspace.snapshot(url).snapshot?.detection)
      .toEqual({ mode: "viewport", phase: "completed", requestId: nextId });
  });

  it("a failed older request never clears a newer viewport generation", async () => {
    const f = fixture();
    let rejectOld!: (error: unknown) => void;
    const pendingOld = new Promise<void>((_, reject) => { rejectOld = reject; });
    f.options.handleAutoDetect = vi.fn((id?: string) => {
      if (id === requestId) {
        f.workspace.beginDetection("viewport", requestId);
        return pendingOld;
      }
      f.workspace.beginDetection("viewport", nextId);
      return Promise.resolve();
    });
    const first = f.call(requestId);
    const second = f.call(nextId);
    expect((await second).value).toEqual({ ok: false, requestId: nextId, error: "VIEWPORT_RESULT_NOT_CURRENT" });
    rejectOld(new Error("old generation failed"));
    expect((await first).value).toEqual({ ok: false, requestId, error: "VIEWPORT_DETECT_FAILED" });
    expect(f.workspace.snapshot(url).snapshot?.detection.requestId).toBe(nextId);
    expect(f.workspace.snapshot(url).snapshot?.detection.phase).toBe("detecting");
  });

  it("runtime disposal before completion never returns a successful count", async () => {
    const f = fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    f.options.handleAutoDetect = vi.fn(async (id?: string) => {
      f.workspace.beginDetection("viewport", id);
      await pending;
      f.workspace.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    });
    const running = f.call();
    f.dispose();
    release();
    expect((await running).value).toEqual({ ok: false, requestId, error: "VIEWPORT_RESULT_NOT_CURRENT" });
  });
});

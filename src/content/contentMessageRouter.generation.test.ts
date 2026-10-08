import { describe, expect, it, vi } from "vitest";
import { handleContentMessage } from "./contentMessageRouter";

describe("Phase14B-02C START generation protocol guard", () => {
  const generationId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
  function dispatch(message: Record<string, unknown>) {
    const startAutoSolveAll = vi.fn();
    const respond = vi.fn();
    handleContentMessage(message as Parameters<typeof handleContentMessage>[0], respond, {
      startAutoSolveAll,
    } as unknown as Parameters<typeof handleContentMessage>[2]);
    return { startAutoSolveAll, respond };
  }

  it("P14B02C_ROUTER_01 sends the unchanged valid generation into runtime execution", () => {
    const r = dispatch({ type: "START_AUTO_SOLVE_ALL", generationId });
    expect(r.startAutoSolveAll).toHaveBeenCalledTimes(1);
    expect(r.startAutoSolveAll).toHaveBeenCalledWith(generationId);
    expect(r.respond).toHaveBeenCalledWith({ ok: true });
  });
  it("P14B02C_ROUTER_02 rejects a malformed token rather than downgrading to legacy", () => {
    for (const bad of [null, "not-a-uuid", 7, ""]) {
      const r = dispatch({ type: "START_AUTO_SOLVE_ALL", generationId: bad });
      expect(r.startAutoSolveAll).not.toHaveBeenCalled();
      expect(r.respond).toHaveBeenCalledWith({ ok: false, error: "INVALID_WORK_GENERATION" });
    }
  });
  it("P14B02C_ROUTER_03 preserves untagged compatibility", () => {
    const r = dispatch({ type: "START_AUTO_SOLVE_ALL" });
    expect(r.startAutoSolveAll).toHaveBeenCalledTimes(1);
    expect(r.startAutoSolveAll).toHaveBeenCalledWith(undefined);
    expect(r.respond).toHaveBeenCalledWith({ ok: true });
  });
});

describe("Phase14B-02C-B Full Page START generation contract", () => {
  it("P14B02C_FULLPAGE_01 forwards a valid tagged START", () => {
    const generationId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
    const handleFullPageDetect = vi.fn();
    const respond = vi.fn();
    handleContentMessage({ type: "START_FULL_PAGE_DETECT", generationId }, respond, {
      handleFullPageDetect,
    } as unknown as Parameters<typeof handleContentMessage>[2]);
    expect(handleFullPageDetect).toHaveBeenCalledWith(generationId);
    expect(respond).toHaveBeenCalledWith({ ok: true });
  });
  it("P14B02C_FULLPAGE_02 rejects malformed tagged START without dispatch", () => {
    const handleFullPageDetect = vi.fn();
    const respond = vi.fn();
    handleContentMessage({ type: "START_FULL_PAGE_DETECT", generationId: null } as unknown as Parameters<typeof handleContentMessage>[0], respond, {
      handleFullPageDetect,
    } as unknown as Parameters<typeof handleContentMessage>[2]);
    expect(handleFullPageDetect).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({ ok: false, error: "INVALID_WORK_GENERATION" });
  });
  it("P14B02C_FULLPAGE_03 retains untagged legacy START", () => {
    const handleFullPageDetect = vi.fn();
    const respond = vi.fn();
    handleContentMessage({ type: "START_FULL_PAGE_DETECT" }, respond, {
      handleFullPageDetect,
    } as unknown as Parameters<typeof handleContentMessage>[2]);
    expect(handleFullPageDetect).toHaveBeenCalledWith(undefined);
    expect(respond).toHaveBeenCalledWith({ ok: true });
  });
});

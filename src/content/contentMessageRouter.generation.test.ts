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
    expect(r.startAutoSolveAll).toHaveBeenCalledExactlyOnceWith(generationId);
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
    expect(r.startAutoSolveAll).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(r.respond).toHaveBeenCalledWith({ ok: true });
  });
});

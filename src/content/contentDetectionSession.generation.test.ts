import { describe, expect, it, vi } from "vitest";
import { bindFullPageGeneration } from "./contentDetectionSession";

describe("Phase14B-02C-B immutable Full Page generation propagation", () => {
  const generationId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
  it("P14B02C_FULLPAGE_04 sends tagged PROGRESS and success/failure DONE", () => {
    const emit = vi.fn();
    const run = bindFullPageGeneration(emit, generationId);
    run({ type: "FULL_PAGE_DETECT_PROGRESS", progress: 20 });
    run({ type: "FULL_PAGE_DETECT_DONE", candidates: [], totalFound: 0 });
    expect(emit).toHaveBeenNthCalledWith(1, { type: "FULL_PAGE_DETECT_PROGRESS", progress: 20, generationId });
    expect(emit).toHaveBeenNthCalledWith(2, { type: "FULL_PAGE_DETECT_DONE", candidates: [], totalFound: 0, generationId });
  });
  it("P14B02C_FULLPAGE_05 two overlapping run senders never steal each other's identity", () => {
    const emit = vi.fn();
    const old = bindFullPageGeneration(emit, generationId);
    const newId = "18aabcde-0ee2-4e98-8e12-48fdce879013";
    const latest = bindFullPageGeneration(emit, newId);
    latest({ type: "FULL_PAGE_DETECT_PROGRESS", progress: 50 });
    old({ type: "FULL_PAGE_DETECT_DONE", candidates: [], totalFound: 0 });
    expect(emit.mock.calls[0]?.[0]).toMatchObject({ generationId: newId });
    expect(emit.mock.calls[1]?.[0]).toMatchObject({ generationId });
  });
  it("P14B02C_FULLPAGE_06 legacy and unrelated messages remain unchanged", () => {
    const emit = vi.fn();
    bindFullPageGeneration(emit)({ type: "FULL_PAGE_DETECT_DONE", totalFound: 0 });
    bindFullPageGeneration(emit, generationId)({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    expect(emit.mock.calls.map(c => c[0])).toEqual([
      { type: "FULL_PAGE_DETECT_DONE", totalFound: 0 },
      { type: "AUTO_DETECT_RESULT_READY", candidates: [] },
    ]);
  });
});

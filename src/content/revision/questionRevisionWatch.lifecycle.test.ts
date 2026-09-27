import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { beginContentRuntimeGeneration, type ContentRuntimeGeneration } from "../contentRuntimeLifecycle";
import { activeQuestionRevisionAttempt, beginQuestionRevisionAttempt, disposeQuestionRevisionRuntime } from "./questionRevisionRuntime";
import { startQuestionRevisionWatch } from "./questionRevisionWatch";

const block: QuestionBlock = {
  id: "route-q1",
  identity: {
    stableId: "route-q1",
    contentFingerprint: "route-q1-fingerprint",
    identityVersion: 1,
    strategy: "content-only",
    signals: { nativeId: false, content: true, options: true, media: false, structure: true },
  },
  bbox: { x: 0, y: 0, width: 240, height: 100 },
  previewText: "A question owned by route A",
  questionTypeGuess: "short_answer",
  confidence: 1,
  hasImage: false,
  source: "auto_dom",
};

describe("SPA route soft reset", () => {
  let lifecycle: ContentRuntimeGeneration | null = null;

  afterEach(() => {
    vi.useRealTimers();
    disposeQuestionRevisionRuntime();
    lifecycle?.invalidate();
    lifecycle = null;
    history.replaceState(null, "", "/");
  });

  it("P10B-ROUTE-SOFT-RESET-01 invalidates route A state while keeping the runtime owner live", () => {
    vi.useFakeTimers();
    lifecycle = beginContentRuntimeGeneration();
    const controller = new AbortController();
    beginQuestionRevisionAttempt(block, controller);
    let routeOwnedCandidates: QuestionBlock[] = [block];
    let stop: () => void = () => {};
    const onCandidates = vi.fn((next: QuestionBlock[]) => { routeOwnedCandidates = next; });
    const onRouteChange = vi.fn(() => {
      routeOwnedCandidates = [];
      stop();
    });

    stop = startQuestionRevisionWatch({
      detectCandidates: () => [block],
      onCandidates,
      onRouteChange,
    });
    history.pushState(null, "", "/route-b");
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(50);

    expect(onRouteChange).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    expect(activeQuestionRevisionAttempt()?.controller.signal.aborted).toBe(true);
    expect(routeOwnedCandidates).toEqual([]);
    expect(onCandidates).not.toHaveBeenCalled();
    expect(lifecycle.isCurrent()).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { beginQuestionRevisionAttempt, clearQuestionRevisionAttempt } from "./questionRevisionRuntime";
import { startQuestionRevisionWatch } from "./questionRevisionWatch";

const block = (fingerprint: string) => ({
  id: `q12-${fingerprint}`,
  bbox: { x: 0, y: 0, width: 10, height: 10 },
  previewText: fingerprint === "cf-a" ? "12. 2 + 2 = ? A. 3 B. 4" : "12. 3 + 3 = ? A. 5 B. 6",
  hasImage: false,
  questionTypeGuess: "single_choice" as const,
  confidence: 1,
  source: "auto_dom" as const,
  identity: { stableId: "q12", contentFingerprint: fingerprint, identityVersion: 1 as const, strategy: "native-id" as const, nativeQuestionId: "12", signals: { nativeId: true, content: true, options: true, media: false, structure: true } },
});

describe("Phase 6 SPA semantic watcher", () => {
  it("coalesces a pending semantic change and aborts the existing provider attempt", async () => {
    let current = block("cf-a");
    const controller = new AbortController();
    beginQuestionRevisionAttempt(current, controller);
    const onCandidates = vi.fn();
    const stop = startQuestionRevisionWatch({ detectCandidates: () => [current], onCandidates });
    current = block("cf-b");
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(controller.signal.aborted).toBe(true);
    expect(onCandidates).toHaveBeenCalledTimes(1);
    stop();
    clearQuestionRevisionAttempt(controller);
  });

  it("ignores answer-state and extension UI noise without aborting a pending attempt", async () => {
    const current = block("cf-a");
    const controller = new AbortController();
    beginQuestionRevisionAttempt(current, controller);
    const onCandidates = vi.fn();
    const answer = document.createElement("input");
    document.body.append(answer);
    const extensionUi = document.createElement("div");
    extensionUi.id = "qs-phase6-test";
    document.body.append(extensionUi);
    const stop = startQuestionRevisionWatch({ detectCandidates: () => [current], onCandidates });
    answer.setAttribute("aria-checked", "true");
    extensionUi.append(document.createElement("span"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(controller.signal.aborted).toBe(false);
    expect(onCandidates).not.toHaveBeenCalled();
    stop();
    clearQuestionRevisionAttempt(controller);
  });

  it("SPA-REMOVE1 aborts when the active canonical question disappears", async () => {
    let current: ReturnType<typeof block>[] = [block("cf-a")];
    const controller = new AbortController();
    beginQuestionRevisionAttempt(current[0], controller);
    const events: string[] = [];
    const stop = startQuestionRevisionWatch({ detectCandidates: () => current, onCandidates: () => {}, onEvent: (event) => events.push(event) });
    current = [];
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(controller.signal.aborted).toBe(true);
    expect(events).toContain("REMOVED");
    stop(); clearQuestionRevisionAttempt(controller);
  });

  it("SPA-REPLACE1 aborts when a slot now resolves to a different question", async () => {
    let current = [block("cf-a")];
    const controller = new AbortController();
    beginQuestionRevisionAttempt(current[0], controller);
    const events: string[] = [];
    const stop = startQuestionRevisionWatch({ detectCandidates: () => current, onCandidates: () => {}, onEvent: (event) => events.push(event) });
    current = [{ ...block("cf-b"), id: "q13", identity: { ...block("cf-b").identity, stableId: "q13", nativeQuestionId: "13" } }];
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(controller.signal.aborted).toBe(true);
    expect(events).toContain("REPLACED");
    stop(); clearQuestionRevisionAttempt(controller);
  });

  it("SPA-ROUTE1 rejects a late pending result after pushState even before a DOM replacement", async () => {
    const current = block("cf-a");
    const controller = new AbortController();
    beginQuestionRevisionAttempt(current, controller);
    const stop = startQuestionRevisionWatch({ detectCandidates: () => [current], onCandidates: () => {} });
    const before = location.href;
    history.pushState({}, "", "#phase6-route");
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(controller.signal.aborted).toBe(true);
    history.replaceState({}, "", before);
    stop(); clearQuestionRevisionAttempt(controller);
  });

  it("SPA-LIFE1/2 cleanup disconnects the old observer and cancels its queued reconciliation", async () => {
    const current = block("cf-a");
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = startQuestionRevisionWatch({ detectCandidates: () => [current], onCandidates: first });
    document.body.append(document.createElement("div"));
    stopFirst();
    const stopSecond = startQuestionRevisionWatch({ detectCandidates: () => [current], onCandidates: second });
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    stopSecond();
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("SPA-BIND2 keeps a pending provider alive through an equivalent render-only rebind", async () => {
    const current = block("cf-a");
    const controller = new AbortController();
    beginQuestionRevisionAttempt(current, controller);
    const events: string[] = [];
    const stop = startQuestionRevisionWatch({ detectCandidates: () => [{ ...current, id: "rerendered-q12" }], onCandidates: () => {}, onEvent: (event) => events.push(event) });
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(controller.signal.aborted).toBe(false);
    expect(events).not.toContain("REVISION_CHANGED");
    stop(); clearQuestionRevisionAttempt(controller);
  });

  it("SPA-FORM2 and SPA-SEM2 fail closed when the canonical fingerprint changes", async () => {
    let current = block("cf-formula-x2-options-abcd");
    const controller = new AbortController();
    beginQuestionRevisionAttempt(current, controller);
    const stop = startQuestionRevisionWatch({ detectCandidates: () => [current], onCandidates: () => {} });
    current = block("cf-formula-x3-options-abce");
    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(controller.signal.aborted).toBe(true);
    stop(); clearQuestionRevisionAttempt(controller);
  });
});

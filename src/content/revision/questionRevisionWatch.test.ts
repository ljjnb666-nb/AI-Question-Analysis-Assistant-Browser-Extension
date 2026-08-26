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
});

import { describe, expect, it } from "vitest";
import {
  autoSolveStatusLabel,
  autoSolveStatusFeedback,
  mapAutoSolveDoneFeedback,
  sanitizeLegacyAutoSolveStatusText,
} from "./autoSolveStatus";

describe("autoSolveStatus contract (UI-00B PART F/G)", () => {
  it("UI00B-13: an incomplete question surfaces the localized skipped copy, never the machine state", () => {
    expect(sanitizeLegacyAutoSolveStatusText("SKIPPED_WITHHOLD-INCOMPLETE", "zh"))
      .toBe("题目尚未完整加载，本次已跳过。");
    expect(sanitizeLegacyAutoSolveStatusText("SKIPPED_WITHHOLD-INCOMPLETE", "en"))
      .toBe("This question has not fully loaded and was skipped.");
    expect(sanitizeLegacyAutoSolveStatusText("SKIPPED_WITHHOLD-INCOMPLETE", "zh"))
      .not.toContain("SKIPPED");
    expect(autoSolveStatusLabel("SKIPPED_INCOMPLETE", "zh")).toBe("题目尚未完整加载，本次已跳过。");
  });

  it("UI00B-14: unknown completeness also localizes without raw machine codes", () => {
    expect(sanitizeLegacyAutoSolveStatusText("SKIPPED_WITHHOLD-UNKNOWN", "zh"))
      .toBe("暂时无法确认题目是否完整，本次已跳过。");
    expect(autoSolveStatusLabel("SKIPPED_UNKNOWN", "en"))
      .toBe("Could not confirm this question is complete, so it was skipped.");
    // Any future SKIPPED_* machine state fails closed to the safe copy.
    expect(sanitizeLegacyAutoSolveStatusText("SKIPPED_SOMETHING_NEW", "en"))
      .toBe("Could not confirm this question is complete, so it was skipped.");
  });

  it("UI00B-15: English UI never renders the hardcoded Chinese runtime statuses", () => {
    for (const code of [
      "STARTING",
      "WAITING_FOR_QUESTIONS",
      "PARSING",
      "RETRYING_PARSE",
      "ANSWERED_SKIP",
      "ANSWERED_KEEP",
      "REVIEWING_ANSWERED",
      "REVIEWING_HISTORY",
      "REUSING_HISTORY",
      "REUSED_HISTORY",
      "SKIPPED_INCOMPLETE",
      "SKIPPED_UNKNOWN",
      "SKIPPED_UNSTABLE",
      "FILL_STOPPED_SAFETY",
      "ADVANCING",
    ]) {
      const label = autoSolveStatusLabel(code, "en", { current: 3 });
      expect(label, code).not.toMatch(/[\u4e00-\u9fff]/);
    }
    expect(autoSolveStatusLabel("PARSING", "en", { current: 3 })).toBe("Parsing question 3...");
    expect(autoSolveStatusLabel("PARSING", "zh", { current: 3 })).toBe("正在解析第 3 题...");
  });

  it("UI00B-16: a failed DONE becomes stable localized error feedback with the raw text demoted", () => {
    const feedback = mapAutoSolveDoneFeedback(
      { ok: false, solved: 1, filled: 0, total: 5, message: "TypeError: boom at content.js:42" },
      "zh",
    );
    expect(feedback.tone).toBe("error");
    expect(feedback.message).toBe("自动解析遇到问题已停止，请检查页面后重试。");
    expect(feedback.message).not.toContain("TypeError");
    expect(feedback.technicalDetail).toContain("TypeError");

    const stopped = mapAutoSolveDoneFeedback({ ok: true, stopped: true, solved: 2, filled: 1, total: 5, message: "已停止自动答题" }, "zh");
    expect(stopped.tone).toBe("info");

    const success = mapAutoSolveDoneFeedback({ ok: true, solved: 5, filled: 4, total: 5, message: "" }, "en");
    expect(success.tone).toBe("success");
    expect(success.message).toContain("processed 5");
  });

  it("maps a safety-stop status through the shared fill-code mapper", () => {
    const { label, detail } = autoSolveStatusFeedback("FILL_STOPPED_SAFETY", "zh", { detail: "STALE_QUESTION_REVISION" });
    expect(label).toBe("为安全起见已停止填写本题");
    expect(detail?.message).toBe("页面中的题目已经发生变化，请重新识别后再填写。");
  });
});

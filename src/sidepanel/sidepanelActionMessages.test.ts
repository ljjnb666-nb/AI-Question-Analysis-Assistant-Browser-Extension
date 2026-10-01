import { describe, expect, it } from "vitest";
import { getBatchFillFeedback, getFillActionFeedback } from "./sidepanelActionMessages";

describe("sidepanelActionMessages (UI-00B typed feedback)", () => {
  it("UI00B-06: a successful fill surfaces success tone with the machine code demoted", () => {
    const feedback = getFillActionFeedback("zh", { ok: true, message: "FILLED_VERIFIED", code: "FILLED_VERIFIED" });
    expect(feedback.tone).toBe("success");
    expect(feedback.message).toBe("填写完成");
    expect(feedback.message).not.toContain("FILLED_VERIFIED");
    expect(feedback.code).toBe("FILLED_VERIFIED");
  });

  it("UI00B-07: a failed fill surfaces error tone and never the raw message", () => {
    const feedback = getFillActionFeedback("zh", { ok: false, message: "CONTROL_MAPPING_AMBIGUOUS", code: "CONTROL_MAPPING_AMBIGUOUS" });
    expect(feedback.tone).toBe("error");
    expect(feedback.message).not.toContain("CONTROL_MAPPING_AMBIGUOUS");
    expect(feedback.technicalDetail).toContain("CONTROL_MAPPING_AMBIGUOUS");
  });

  it("maps known fill codes through the central contract", () => {
    expect(getFillActionFeedback("zh", { ok: false, code: "DEMO_RESULT_NOT_FILLABLE" }).message)
      .toBe("演示结果不能填入真实页面，请先配置 AI 服务并重新解析。");
    expect(getFillActionFeedback("en", { ok: false, code: "PARTIAL_MUTATION_UNPROVABLE" }).tone).toBe("error");
  });

  it("builds typed batch feedback with an explicit skipped count", () => {
    const clean = getBatchFillFeedback("zh", 3, 2);
    expect(clean.tone).toBe("success");
    expect(clean.message).toBe("已填写 3 题（2 个控件）。");

    const partial = getBatchFillFeedback("en", 2, 1, 1);
    expect(partial.tone).toBe("warning");
    expect(partial.message).toContain("1 more need to be re-parsed");
  });
});

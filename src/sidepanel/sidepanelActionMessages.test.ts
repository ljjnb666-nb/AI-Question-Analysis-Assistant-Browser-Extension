import { describe, expect, it } from "vitest";
import { getBatchFillFeedback, getSingleFillFeedback } from "./sidepanelActionMessages";

describe("sidepanelActionMessages", () => {
  it("prefers explicit backend messages for single fill feedback", () => {
    expect(getSingleFillFeedback("zh", true, "自定义消息")).toBe("自定义消息");
    expect(getSingleFillFeedback("en", false, "Custom message")).toBe("Custom message");
  });

  it("falls back to localized single fill feedback", () => {
    expect(getSingleFillFeedback("zh", true)).toBe("填写完成");
    expect(getSingleFillFeedback("zh", false)).toBe("填写失败");
    expect(getSingleFillFeedback("en", true)).toBe("Fill completed");
    expect(getSingleFillFeedback("en", false)).toBe("Fill failed");
  });

  it("builds localized batch fill feedback", () => {
    expect(getBatchFillFeedback("zh", 3, 2)).toBe("已在 2 题中填写 3 个控件");
    expect(getBatchFillFeedback("en", 3, 2)).toBe("Filled 3 fields across 2 question(s)");
  });
});

import { describe, expect, it } from "vitest";
import {
  mapUserFacingError,
  userFeedback,
} from "./userFeedback";

describe("userFeedback error mapping (UI-00B PART B)", () => {
  it("UI00B-01: STALE_QUESTION_REVISION surfaces natural copy, not the machine code", () => {
    const feedback = mapUserFacingError(Object.assign(new Error("STALE_QUESTION_REVISION"), { code: "STALE_QUESTION_REVISION" }), "zh");
    expect(feedback.tone).toBe("warning");
    expect(feedback.message).toBe("页面中的题目已经发生变化，请重新识别后再填写。");
    expect(feedback.message).not.toContain("STALE_QUESTION_REVISION");
    expect(feedback.code).toBe("STALE_QUESTION_REVISION");
  });

  it("UI00B-02: PARTIAL_MUTATION_UNPROVABLE maps to an error-toned safety message", () => {
    const feedback = mapUserFacingError(new Error("PARTIAL_MUTATION_UNPROVABLE"), "zh", { code: "PARTIAL_MUTATION_UNPROVABLE" });
    expect(feedback.tone === "error" || feedback.tone === "warning").toBe(true);
    expect(feedback.tone).not.toBe("success");
    expect(feedback.message).toContain("无法确认填写结果");
    expect(feedback.message).not.toContain("PARTIAL_MUTATION");
  });

  it("UI00B-03: AUTHORITY_LOST maps to the localized auth-expired message", () => {
    expect(mapUserFacingError(new Error("AUTHORITY_LOST"), "zh", { code: "AUTHORITY_LOST" }).message)
      .toBe("登录状态已经失效，本次操作没有执行。请重新登录后再试。");
    expect(mapUserFacingError(new Error("AUTHORITY_LOST"), "en", { code: "AUTHORITY_LOST" }).message)
      .toContain("session has expired");
  });

  it("UI00B-04: an unknown raw exception never becomes the primary copy", () => {
    const feedback = mapUserFacingError(new Error("TypeError: cannot read properties of undefined (reading 'foo') at contentscript.js:1"), "zh");
    expect(feedback.tone).toBe("error");
    expect(feedback.message).toBe("操作失败，请稍后重试。");
    expect(feedback.message).not.toContain("TypeError");
    expect(feedback.technicalDetail).toContain("TypeError");
  });

  it("UI00B-05: transport errors map to the safe page-connection message", () => {
    for (const raw of [
      "Receiving end does not exist",
      "Could not establish connection. Receiving end does not exist.",
      "unknown tabs.sendMessage error",
    ]) {
      const feedback = mapUserFacingError(new Error(raw), "zh");
      expect(feedback.message).toBe("当前页面暂时无法连接插件，请刷新页面后重试。");
      expect(feedback.message).not.toContain("Receiving end");
    }
  });

  it("UI00B-17: connection test failures are classified with safe copy", () => {
    expect(mapUserFacingError(new Error("HTTP 401 Unauthorized"), "zh", { context: "connection-test" }).message)
      .toBe("API Key 无效或没有权限，请检查后重试。");
    expect(mapUserFacingError(new Error("404 model_not_found: gpt-nope"), "zh", { context: "connection-test" }).message)
      .toBe("模型或服务地址不可用，请检查配置。");
    expect(mapUserFacingError(new Error("request timed out after 30000ms"), "zh", { context: "connection-test" }).message)
      .toBe("暂时无法连接 AI 服务，请检查网络和服务地址。");
    const unknown = mapUserFacingError(new Error("weird provider glitch 0x13"), "zh", { context: "connection-test" });
    expect(unknown.message).toBe("连接测试失败，请检查服务地址、模型和 API Key 后重试。");
    expect(unknown.technicalDetail).toContain("weird provider glitch");
  });

  it("keeps the structured feedback contract intact", () => {
    const feedback = userFeedback("warning", "提示", { code: "X", technicalDetail: "raw" });
    expect(feedback).toEqual({ tone: "warning", message: "提示", code: "X", technicalDetail: "raw" });
  });
});

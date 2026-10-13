import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HistoryEntry, QuestionBlock } from "@/shared/types";
import { buildResult } from "@/shared/ai/parseResult";
import { readManualChoiceStructureForDisplay } from "@/shared/ai/manualChoiceStructure";
import { CandidateQuestionContent } from "./candidateWorkspaceContent";
import { HistoryRecordCard } from "./historyTabSections";

const visionText = "根据实验室规定，面对异常设备应该采取哪项措施？\nA. 核查安全装置\nB. 无视故障提示\nC. 继续强行操作\nD. 删除异常记录";
const screenshotBlock: QuestionBlock = {
  id: "issue105-r1",
  source: "manual_capture",
  bbox: { x: 0, y: 0, width: 640, height: 400 },
  previewText: "根据实验室规定，面对异常设备应该采取哪项措施？ 截图尚未拆分选项",
  hasImage: true,
  imageDataUrl: "data:image/png;base64,AAAA",
  questionTypeGuess: "single_choice",
  confidence: 0.9,
};
function visionResult(recognizedText = visionText, block: QuestionBlock = screenshotBlock) {
  return buildResult(block, "vision", JSON.stringify({
    questionType: "single_choice", answer: "A", confidence: 0.92,
    recognizedText, briefExplanation: "设备异常时应核查安全装置",
    detailedExplanation: "先检查、报告并按规定处理。",
    optionSelections: { A: true, B: false, C: false, D: false },
  }));
}
function history(result: ReturnType<typeof visionResult>): HistoryEntry {
  return { id: "h-issue105", timestamp: 1, host: "quiz.example", block: screenshotBlock, result };
}

describe("Issue #105 R1: canonical screenshot-choice structure and consistent display", () => {
  it("105-R1-01 projects only explicit original A/B/C/D labels into serializable semantic structure", () => {
    const r = visionResult();
    expect(r.structuredChoice).toEqual({
      version: 1, evidence: "vision_text_labels_unverified",
      stem: "根据实验室规定，面对异常设备应该采取哪项措施？",
      options: [
        { key: "A", text: "核查安全装置" },
        { key: "B", text: "无视故障提示" },
        { key: "C", text: "继续强行操作" },
        { key: "D", text: "删除异常记录" },
      ],
    });
    expect(JSON.parse(JSON.stringify(r)).structuredChoice).toEqual(r.structuredChoice);
  });

  it("105-R1-02 displays the same structured evidence in the candidate workspace even if original preview is unstructured", () => {
    const r = visionResult();
    render(<CandidateQuestionContent block={screenshotBlock} result={r} lang="zh" />);
    expect(screen.getByText("根据实验室规定，面对异常设备应该采取哪项措施？")).toBeInTheDocument();
    for (const text of ["核查安全装置", "无视故障提示", "继续强行操作", "删除异常记录"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByText(/截图尚未拆分选项/)).not.toBeInTheDocument();
  });

  it("105-R1-03 reproduces the same four labeled options from persisted history without rescanning the screenshot", () => {
    render(<HistoryRecordCard entry={history(visionResult())} lang="zh" onToggleDetails={() => undefined} showDetails={false} />);
    for (const text of ["核查安全装置", "无视故障提示", "继续强行操作", "删除异常记录"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText("根据实验室规定，面对异常设备应该采取哪项措施？")).toBeInTheDocument();
  });

  it("105-R1-04 never fabricates A/B/C/D for four unlabeled OCR fragments", () => {
    const r = visionResult("根据实验室规定，面对异常设备应该采取哪项措施？ 核查安全装置 无视故障提示 继续强行操作 删除异常记录");
    expect(r.structuredChoice).toBeUndefined();
    expect(r.answer).toBe("需人工确认");
    expect(r.optionSelections).toBeUndefined();
    expect(r.confidence).toBeLessThan(0.5);
    render(<HistoryRecordCard entry={history(r)} lang="zh" onToggleDetails={() => undefined} showDetails={false} />);
    expect(screen.getByText("未提取到标准选项结构")).toBeInTheDocument();
  });

  it("105-R1-05 rejects missing/duplicate/reordered or blank option labels", () => {
    for (const observed of [
      "实验室操作哪项正确？ A.检查 B.不检查 C.忽视",
      "实验室操作哪项正确？ B.不检查 A.检查 C.忽视 D.报告",
      "实验室操作哪项正确？ A.检查 B.不检查 B.忽视 D.报告",
      "实验室操作哪项正确？ A.检查 B.不检查 C.忽视 D.",
    ]) {
      const r = visionResult(observed);
      expect(r.structuredChoice).toBeUndefined();
      expect(r.answer).toBe("需人工确认");
    }
  });

  it("105-R1-06 never turns a non-vision or non-screenshot parse into image evidence", () => {
    const raw = JSON.stringify({ questionType: "single_choice", answer: "A", confidence: 0.9,
      recognizedText: visionText, briefExplanation: "答案为 A", detailedExplanation: "选择 A" });
    expect(buildResult(screenshotBlock, "text", raw).structuredChoice).toBeUndefined();
    expect(buildResult({ ...screenshotBlock, imageDataUrl: undefined }, "vision", raw).structuredChoice).toBeUndefined();
    expect(buildResult({ ...screenshotBlock, source: "auto_dom" }, "vision", raw).structuredChoice).toBeUndefined();
  });

  it("105-R1-07 preserves multiline option content without inventing extra labels", () => {
    const r = visionResult("以下哪项正确？\nA. 阅读说明\n并检查电源状态\nB. 忽略告警\nC. 不登记\nD. 继续错误操作");
    expect(r.structuredChoice?.options[0]).toEqual({ key: "A", text: "阅读说明\n并检查电源状态" });
    expect(r.structuredChoice?.options).toHaveLength(4);
  });
  it("105-R1-08 prefers final parsed choice over an incorrect initial fill-blank guess in both surfaces", () => {
    const block: QuestionBlock = {
      ...screenshotBlock,
      questionTypeGuess: "fill_blank",
      previewText: "截图被误猜为填空题：____",
    };
    const result = visionResult(visionText, block);
    expect(result.questionType).toBe("single_choice");
    expect(result.structuredChoice?.options).toHaveLength(4);

    const candidateView = render(<CandidateQuestionContent block={block} result={result} lang="zh" />);
    expect(screen.getByText("根据实验室规定，面对异常设备应该采取哪项措施？")).toBeInTheDocument();
    expect(screen.getByText("核查安全装置")).toBeInTheDocument();
    expect(screen.queryByText(/截图被误猜为填空题/)).not.toBeInTheDocument();
    candidateView.unmount();

    render(<HistoryRecordCard entry={{ ...history(result), block }} lang="zh" onToggleDetails={() => undefined} showDetails={false} />);
    expect(screen.getByText("根据实验室规定，面对异常设备应该采取哪项措施？")).toBeInTheDocument();
    expect(screen.getByText("核查安全装置")).toBeInTheDocument();
  });

  it("105-R1-09 rejects stale block ownership, non-vision route, and non-choice result at both display gates", () => {
    const valid = visionResult();
    expect(readManualChoiceStructureForDisplay(screenshotBlock, valid)).toEqual(valid.structuredChoice);
    for (const invalid of [
      { ...valid, blockId: "another-question" },
      { ...valid, routeUsed: "text" as const },
      { ...valid, questionType: "fill_blank" as const },
    ]) {
      expect(readManualChoiceStructureForDisplay(screenshotBlock, invalid)).toBeUndefined();
    }
    expect(readManualChoiceStructureForDisplay({ ...screenshotBlock, source: "auto_dom" }, valid)).toBeUndefined();

    render(<CandidateQuestionContent block={screenshotBlock} result={{ ...valid, blockId: "stale" }} lang="zh" />);
    expect(screen.queryByText("核查安全装置")).not.toBeInTheDocument();
  });

});

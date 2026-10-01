import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateErrorPanel } from "./candidateViewParts";
import { CandidateAutoSolveCard, type CandidateAutoSolveProgress } from "./candidatesTabSections";

describe("CandidateErrorPanel safe copy (review fix P1-01)", () => {
  it("a stable machine code maps to natural zh copy and never shows the raw code", () => {
    render(<CandidateErrorPanel error="HISTORY_COMMIT_REJECTED" lang="zh" onRetryVision={() => {}} />);
    const body = screen.getByText(/解析结果未能安全保存/);
    expect(body.textContent).not.toContain("HISTORY_COMMIT_REJECTED");
  });

  it("a raw exception collapses to the generic safe copy without leaking details", () => {
    render(<CandidateErrorPanel error="TypeError: boom at provider.ts:123" lang="zh" onRetryVision={() => {}} />);
    const body = screen.getByText("操作失败，请稍后重试。");
    expect(body.textContent).not.toContain("TypeError");
    expect(body.textContent).not.toContain("provider.ts");
  });

  it("an English UI shows the English safe copy", () => {
    render(<CandidateErrorPanel error="HISTORY_COMMIT_REJECTED" lang="en" onRetryVision={() => {}} />);
    expect(screen.getByText(/could not be saved safely/i)).toBeInTheDocument();
    const body = screen.getByText(/could not be saved safely/i);
    expect(body.textContent).not.toContain("HISTORY_COMMIT_REJECTED");
  });
});

describe("CandidateAutoSolveCard semantic tones (review fix P1-03/P1-04)", () => {
  const base: Exclude<CandidateAutoSolveProgress, null> = {
    solved: 3,
    filled: 2,
    total: 5,
    current: 3,
    statusText: "",
  };

  it("a safety-stop status renders the error tone, never the success visual", () => {
    render(
      <CandidateAutoSolveCard
        lang="zh"
        autoSolveProgress={{
          ...base,
          statusCode: "FILL_STOPPED_SAFETY",
          statusDetail: "PARTIAL_MUTATION_UNPROVABLE",
          statusText: "Fill stopped for safety: PARTIAL_MUTATION_UNPROVABLE",
        }}
      />,
    );
    const card = screen.getByText(/自动答题/).closest("[data-status-tone]")!;
    expect(card.getAttribute("data-status-tone")).toBe("error");
    // The fill-code detail is localized, not shown raw.
    expect(card.textContent).toContain("无法确认填写结果");
    expect(card.textContent!.replace(/\s/g, "")).not.toContain("PARTIAL_MUTATION_UNPROVABLE");
  });

  it("a running status keeps the neutral/info semantics", () => {
    render(
      <CandidateAutoSolveCard
        lang="en"
        autoSolveProgress={{ ...base, statusCode: "PARSING", statusText: "正在解析第 3 题..." }}
      />,
    );
    const card = screen.getByText(/Auto Solve/).closest("[data-status-tone]")!;
    expect(card.getAttribute("data-status-tone")).toBe("info");
    expect(card.textContent).toContain("Parsing question 3...");
    expect(card.textContent).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("a legacy payload without statusCode never leaks its raw statusText", () => {
    render(
      <CandidateAutoSolveCard
        lang="en"
        autoSolveProgress={{ ...base, statusText: "正在重新解析本题..." }}
      />,
    );
    const card = screen.getByText(/Auto Solve/).closest("[data-status-tone]")!;
    expect(card.getAttribute("data-status-tone")).toBe("info");
    expect(card.textContent).toContain("Working...");
    expect(card.textContent).not.toMatch(/[\u4e00-\u9fff]/);
    expect(card.textContent).not.toContain("重新解析");
  });

  it("a legacy raw exception in statusText never reaches the UI", () => {
    render(
      <CandidateAutoSolveCard
        lang="zh"
        autoSolveProgress={{ ...base, statusText: "TypeError: boom at content.js:9" }}
      />,
    );
    const card = screen.getByText(/自动答题/).closest("[data-status-tone]")!;
    expect(card.textContent).toContain("正在处理...");
    expect(card.textContent).not.toContain("TypeError");
  });
});

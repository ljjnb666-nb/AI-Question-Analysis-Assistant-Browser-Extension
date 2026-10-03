import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DetectedCandidate, ParseResult } from "@/shared/types";
import { CandidatesTab } from "./CandidatesTab";
import { CandidateWorkspaceCard } from "./CandidateWorkspaceCard";
import { computeCandidateMetrics, type CandidateViewFilter } from "./sidepanelCandidateMetrics";
import { isRiskyCandidate } from "./batchParseHeuristics";
import { deriveCandidatePresentation } from "./candidatePresentation";
import { CandidateEmptyState } from "./candidateWorkspaceSections";
import { setKeyboardModalityForTesting } from "@/shared/ui/orbitFocus";
import { orbitFocus } from "@/shared/ui/orbitTokens";
import { deriveWorkspaceActivity } from "./sidePanelWorkspaceState";
import { SidePanelActivityStrip } from "./sidePanelShell";

const origin = { tabId: 7, url: "https://quiz.example.test/questions" };
const result: ParseResult = { blockId: "solved", questionType: "single_choice", answer: "B", confidence: 0.96,
  briefExplanation: "Two plus two is four.", detailedExplanation: "Add two equal quantities.", recognizedText: "",
  routeUsed: "text", resultSource: "provider", optionSelections: { B: true } };
function candidate(id: string, extra: Partial<DetectedCandidate> = {}): DetectedCandidate {
  return { block: { id, previewText: "Which value equals 2 + 2?\nA. 3\nB. 4\nC. 5", hasImage: false,
    questionTypeGuess: "single_choice", confidence: 0.9, source: "auto_dom", bbox: { x: 0, y: 0, width: 100, height: 40 } },
  origin, selected: false, status: "idle", ...extra };
}
const items = () => [candidate("idle"), candidate("solved", { selected: true, status: "success", result }),
  candidate("review", { status: "success", result: { ...result, blockId: "review", confidence: 0.61 } }),
  candidate("failed", { status: "error", error: "provider threw SECRET_TOKEN stack trace" })];

function Workspace({ initial = items(), lang = "en", running = false }: { initial?: DetectedCandidate[]; lang?: "zh" | "en"; running?: boolean }) {
  const [candidates, setCandidates] = useState(initial);
  const [filter, setFilter] = useState<CandidateViewFilter>("all");
  const metrics = computeCandidateMetrics(candidates, filter, isRiskyCandidate);
  const noop = () => {};
  return <CandidatesTab {...metrics} candidates={candidates} candidateViewFilter={filter} expandedIds={{}} fillFeedback={null}
    isAutoSolving={running} isBatchFilling={false} isBatchParsing={false} isDetecting={false} isFullPageScan={false} isRetryingRisky={false}
    autoSolveProgress={null} scanProgress={null} detectionPhase="never_started" lang={lang}
    onCandidateFilterChange={setFilter} onToggleCandidate={id => setCandidates(previous => previous.map(item => item.block.id === id ? { ...item, selected: !item.selected } : item))}
    onClearSelection={() => setCandidates(previous => previous.map(item => ({ ...item, selected: false })))}
    onBatchFill={noop} onBatchParse={noop} onCancelFullPage={noop} onDetect={noop} onFillCandidate={noop} onFlashCandidate={noop} onFullPageDetect={noop}
    onRetryRisky={noop} onRetryVision={noop} onSelectAll={noop} onSelectRisky={noop} onStartAutoSolve={noop} onStopAutoSolve={noop} onToggleDetails={noop} />;
}
function card(cand: DetectedCandidate, extra = {}) {
  const callbacks = { onToggle: vi.fn(), onFlash: vi.fn(), onFill: vi.fn(), onRetryVision: vi.fn(), onToggleDetails: vi.fn() };
  render(<CandidateWorkspaceCard cand={cand} index={2} isExpanded={false} lang="en" {...callbacks} {...extra} />);
  return callbacks;
}
const articles = () => screen.queryAllByRole("article");

describe("UI-04 candidate workspace behavior", () => {
  it("UI04-01: no detection, completed-empty, and filter-empty are distinct", () => {
    const { rerender } = render(<CandidateEmptyState lang="en" phase="never_started" />);
    expect(screen.getByRole("status")).toHaveTextContent('Use "Current View"');
    rerender(<CandidateEmptyState lang="en" phase="completed" />);
    expect(screen.getByRole("status")).toHaveTextContent("Detection finished");
    rerender(<CandidateEmptyState lang="en" phase="completed" filteredEmpty />);
    expect(screen.getByRole("status")).toHaveTextContent("No questions match");
  });
  it("UI04-02: cards render exactly the supplied authoritative candidates", () => {
    render(<Workspace />);
    expect(articles().map(item => item.getAttribute("data-candidate-id"))).toEqual(["idle", "solved", "review", "failed"]);
  });
  it("UI04-03: selected state comes from candidate.selected", () => {
    card(candidate("selected", { selected: true }));
    expect(screen.getByRole("checkbox", { name: "Select question 2" })).toBeChecked();
  });
  it("UI04-04: checkbox dispatches selection without selecting on card actions", () => {
    const callbacks = card(candidate("idle"));
    fireEvent.click(screen.getByRole("button", { name: "Locate" }));
    expect(callbacks.onFlash).toHaveBeenCalledOnce();
    expect(callbacks.onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(callbacks.onToggle).toHaveBeenCalledOnce();
  });
  it("UI04-05: All returns the complete list after another filter", () => {
    render(<Workspace />); fireEvent.click(screen.getByRole("button", { name: "Selected" }));
    fireEvent.click(screen.getByRole("button", { name: "All" })); expect(articles()).toHaveLength(4);
  });
  it("UI04-06: Selected shows authoritative selections and preserves original numbering", () => {
    render(<Workspace />); fireEvent.click(screen.getByRole("button", { name: "Selected" }));
    expect(articles()).toHaveLength(1); expect(articles()[0]).toHaveAccessibleName("Question 2");
  });
  it("UI04-07: Unsolved includes idle and failed, excludes success", () => {
    render(<Workspace />); fireEvent.click(screen.getByRole("button", { name: "Unsolved" }));
    expect(articles().map(item => item.dataset.candidateId)).toEqual(["idle", "failed"]);
  });
  it("UI04-08: Solved follows existing success lifecycle including review results", () => {
    render(<Workspace />); fireEvent.click(screen.getByRole("button", { name: "Solved" }));
    expect(articles().map(item => item.dataset.candidateId)).toEqual(["solved", "review"]);
  });
  it("UI04-09: Review follows the existing risk predicate including failures", () => {
    render(<Workspace />); fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(articles().map(item => item.dataset.candidateId)).toEqual(["review", "failed"]);
  });
  it("UI04-10: filtering and rerenders never mutate selection", () => {
    render(<Workspace />); fireEvent.click(screen.getByRole("checkbox", { name: "Select question 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("checkbox", { name: "Select question 1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select question 2" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getAllByRole("checkbox").every(input => !(input as HTMLInputElement).checked)).toBe(true);
  });
  it("UI04-11: solved answer uses the established option mapping and provider fill gate", () => {
    card(candidate("solved", { status: "success", result }));
    expect(within(screen.getByRole("region", { name: "Answer" })).getByText("B", { exact: true })).toBeVisible();
    expect(within(articles()[0]).getByText("4", { exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Fill answer" })).toBeEnabled();
  });
  it("UI04-12: review shows grounded low-confidence and incomplete reasons", () => {
    card(candidate("review", { status: "success", result: { ...result, confidence: 0.61, warning: "missing options" } }));
    expect(screen.getByText("Review", { exact: true })).toBeVisible();
    expect(screen.getByText(/Low answer confidence/)).toBeVisible();
    expect(screen.getByText(/incomplete-question hints/)).toBeVisible();
  });
  it("UI04-13: local errors use safe copy and do not expose raw exceptions", () => {
    const { container } = render(<Workspace />);
    expect(within(articles()[3]).getByText("Failed", { exact: true })).toBeVisible();
    expect(container).not.toHaveTextContent("SECRET_TOKEN");
  });
  it("UI04-14: full long question text remains available with wrapping", () => {
    const text = "complete question ".repeat(100);
    const item = candidate("long"); item.block.previewText = text; item.block.questionTypeGuess = "short_answer";
    card(item);
    fireEvent.click(screen.getByRole("button", { name: "Show full question" }));
    expect(articles()[0]).toHaveTextContent(text.trim());
    expect(screen.getByText(text.trim()).parentElement).toHaveStyle({ overflowWrap: "anywhere" });
  });
  it("UI04-15: long answers remain complete and explanations expand independently", () => {
    const answer = "complete answer ".repeat(100);
    card(candidate("long", { status: "success", result: { ...result, questionType: "short_answer", answer, optionSelections: undefined } }), { isExpanded: true });
    expect(screen.getByRole("region", { name: "Answer" })).toHaveTextContent(answer.trim());
    expect(screen.getByText("Add two equal quantities.")).toBeVisible();
  });
  it("UI04-16: Chinese copy is localized", () => {
    render(<Workspace lang="zh" />); expect(screen.getByRole("button", { name: "解析并填答" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "选择第 1 题" })).toBeVisible();
  });
  it("UI04-17: English copy is localized", () => {
    render(<Workspace />); expect(screen.getByRole("button", { name: "Solve & Fill" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Select question 1" })).toBeVisible();
  });
  it("UI04-18: selection uses a keyboard-operable native checkbox", () => {
    const callbacks = card(candidate("idle")); const checkbox = screen.getByRole("checkbox");
    expect(checkbox.tagName).toBe("INPUT"); expect(checkbox).toHaveAttribute("type", "checkbox");
    // Browser Space activation is exercised in the real-browser UI04 suite.
    fireEvent.click(checkbox); expect(callbacks.onToggle).toHaveBeenCalledOnce();
  });
  it("UI04-19: keyboard focus is visible only on the checkbox", () => {
    card(candidate("idle")); setKeyboardModalityForTesting(true); fireEvent.focus(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toHaveStyle({ outline: orbitFocus.outline });
    expect(articles()[0].style.outline).toBe("");
  });
  it("UI04-20: active presentation is candidate-specific without a global progress panel", () => {
    card(candidate("idle"), { active: true }); expect(articles()[0]).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Solving", { exact: true })).toBeVisible(); expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("UI04-21: Activity Strip owns workflow progress and Stop", () => {
    const stop = vi.fn();
    const activity = deriveWorkspaceActivity({ status: "solving", lang: "en", isDetecting: false, isFullPageScan: false, scanProgress: null,
      isAutoSolving: true, autoSolveProgress: { current: 2, total: 4, filled: 1, solved: 1, statusText: "" }, fillFeedback: null, onStopAutoSolve: stop });
    render(<SidePanelActivityStrip activity={activity!} lang="en" />);
    expect(screen.getByText(/Question 2/)).toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "Stop" })); expect(stop).toHaveBeenCalledOnce();
  });
  it("UI04-22: action area has controls without duplicate Running/progress surfaces", () => {
    render(<Workspace running />); const actions = screen.getByRole("group", { name: "Candidate actions" });
    expect(actions).not.toHaveTextContent("Running"); expect(within(actions).queryByRole("progressbar")).toBeNull();
    expect(within(actions).getByRole("button", { name: "Stop Solve & Fill" })).toBeEnabled();
  });
  it("UI04-23: page-changed display requires stable stale codes", () => {
    expect(deriveCandidatePresentation(candidate("stale", { status: "error", error: "STALE_QUESTION_REVISION" }), "en").status).toBe("stale");
    expect(deriveCandidatePresentation(candidate("error", { status: "error", error: "page changed raw exception" }), "en").status).toBe("failed");
  });
  it("UI04-24: actual segment images render; missing media is explained truthfully", () => {
    const item = candidate("image"); item.block.hasImage = true; item.block.displaySegments = [{ type: "image", url: "https://quiz.example.test/figure.png" }];
    const { rerender } = render(<CandidateWorkspaceCard cand={item} index={1} isExpanded={false} lang="en" onToggle={() => {}} onFlash={() => {}} onFill={() => {}} onRetryVision={() => {}} onToggleDetails={() => {}} />);
    expect(screen.getByRole("img", { name: "Question figure" })).toHaveAttribute("src", "https://quiz.example.test/figure.png");
    item.block.displaySegments = undefined;
    rerender(<CandidateWorkspaceCard cand={{ ...item }} index={1} isExpanded={false} lang="en" onToggle={() => {}} onFlash={() => {}} onFill={() => {}} onRetryVision={() => {}} onToggleDetails={() => {}} />);
    expect(screen.queryByRole("img")).toBeNull(); expect(screen.getByText(/preview is unavailable/)).toBeVisible();
  });
  it("UI04-27: compact counts match candidate truth", () => {
    render(<Workspace />); expect(screen.getAllByRole("definition")).toHaveLength(4);
    const values = [...document.querySelectorAll("dl dd")].map(item => item.textContent); expect(values).toEqual(["4", "1", "2", "2"]);
  });
  it("UI04-28: review filter count matches existing risk count", () => {
    const list = items(); const metrics = computeCandidateMetrics(list, "risky", isRiskyCandidate);
    expect(metrics.riskyCount).toBe(2); expect(metrics.filteredCandidates).toHaveLength(metrics.riskyCount);
  });
  it("UI04-29: no submission control is introduced", () => {
    render(<Workspace />); expect(screen.queryByRole("button", { name: /submit/i })).toBeNull();
  });
  it("UI04-30: no visible legacy Auto Solve terminology", () => {
    const { container } = render(<Workspace running />); expect(container).not.toHaveTextContent(/Auto Solve|自动答题/);
  });
  it("unproven/mock answers remain viewable but never fillable", () => {
    card(candidate("mock", { status: "success", result: { ...result, resultSource: "mock" } }));
    expect(screen.getByRole("button", { name: "Fill unavailable" })).toBeDisabled();
    expect(screen.getByText(/source is unverified/)).toBeVisible();
  });
  it("judge and blank questions retain their existing whitelisted URL image path", () => {
    const item = candidate("judge-image"); item.block.questionTypeGuess = "judge"; item.block.hasImage = true;
    item.block.questionImageUrl = "https://tikuimgs.oss-cn-shanghai.aliyuncs.com/figure.png";
    card(item);
    expect(screen.getByRole("img", { name: "Question figure" })).toHaveAttribute("src", item.block.questionImageUrl);
    expect(screen.queryByText(/preview is unavailable/)).toBeNull();
  });
  it("generated blank labels follow the UI language without changing source hints", () => {
    const item = candidate("blank"); item.block.questionTypeGuess = "fill_blank"; item.block.previewText = "Complete the value: ____";
    card(item); expect(screen.getByText("Blank 1", { exact: true })).toBeVisible();
    expect(screen.queryByText("空1", { exact: true })).toBeNull();
  });
});

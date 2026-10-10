/** Test-only component fixture. No production auth/runtime/transport is replaced. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CandidateOrigin, DetectedCandidate, ParseResult } from "../../src/shared/types";
import { CandidatesTab } from "../../src/sidepanel/CandidatesTab";
import { computeCandidateMetrics, type CandidateViewFilter } from "../../src/sidepanel/sidepanelCandidateMetrics";
import { isRiskyCandidate } from "../../src/sidepanel/batchParseHeuristics";
import { APP_SHELL_STYLE, PANEL_BODY_STYLE, SidePanelHeader, SidePanelActivityStrip, WorkspaceTabPanel } from "../../src/sidepanel/sidePanelShell";
import { deriveWorkspaceActivity } from "../../src/sidepanel/sidePanelWorkspaceState";
import { SettingsTab } from "../../src/sidepanel/settingsPanel";
import { ORBIT_SCROLLBAR_CSS } from "../../src/sidepanel/orbitScrollbar";
import { WorkspaceUserFeedback } from "../../src/sidepanel/WorkspaceUserFeedback";
import { getBatchFillFeedback, getFillActionFeedback } from "../../src/sidepanel/sidepanelActionMessages";

const params = new URLSearchParams(location.search);
const lang = params.get("lang") === "en" ? "en" : "zh";
const mode = params.get("mode") || "candidates";
const origin: CandidateOrigin = { tabId: 7, url: "https://quiz.example.test/questions" };
const result: ParseResult = { blockId: "q1", questionType: "single_choice", answer: "B", confidence: 0.96, briefExplanation: "2 + 2 = 4.",
  detailedExplanation: "Adding two equal quantities gives four.", recognizedText: "", resultSource: "provider", routeUsed: "text", optionSelections: { B: true } };
const question = (id: string, previewText: string): DetectedCandidate => ({ block: { id, previewText, hasImage: false, questionTypeGuess: "single_choice", source: "auto_dom", confidence: 0.9,
  bbox: { x: 0, y: 0, width: 100, height: 40 }, identity: { stableId: id, contentFingerprint: `fingerprint-${id}`, identityVersion: 1, strategy: "native-id",
    signals: { nativeId: true, content: true, options: true, media: false, structure: false } } }, origin, selected: false, status: "idle" });
function fixtures(): DetectedCandidate[] {
  if (mode === "empty") return [];
  const solved = question("q1", "Which value equals 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6"); solved.status = "success"; solved.selected = true; solved.result = result;
  const review = question("q2", "计算 x^{2} - 1，其中 x = 3。\nA. 6\nB. 8\nC. 10\nD. 12"); review.status = "success"; review.result = { ...result, blockId: "q2", confidence: 0.61 };
  const idle = question("q3", "Choose the correct statement.\nA. All birds can fly.\nB. Some birds can fly.\nC. No birds can fly.\nD. Birds are plants.");
  if (mode === "image") {
    idle.block.hasImage = true;
    idle.block.displaySegments = [{ type: "text", text: "Inspect both available figures." },
      { type: "image", url: "/e2e/fixtures/ui04-figure.svg" }, { type: "image", url: "/e2e/fixtures/ui04-figure.svg" }];
    return [idle];
  }
  if (mode === "running") { idle.status = "loading"; return [solved, review, idle]; }
  if (mode === "long") {
    const long = question("long", "完整题干与 mixed-language content：" + "请验证每一个条件 / verify every condition. ".repeat(45));
    long.block.questionTypeGuess = "short_answer"; long.status = "success";
    long.result = { ...result, questionType: "short_answer", blockId: "long", answer: "完整答案 / complete answer. ".repeat(45), optionSelections: undefined };
    return [long];
  }
  return [solved, review, idle];
}

// Settings uses its real component with empty test storage, no credentials or
// authenticated session. This fixture cannot send extension messages.
const store: Record<string, unknown> = { appSettings: { language: lang, deviceId: "ui04-fixture-device", providerId: "anthropic" } };
const event = { addListener: () => {}, removeListener: () => {} };
Object.assign(globalThis, { chrome: { storage: { onChanged: event, local: { get: async () => store, set: async (values: Record<string, unknown>) => Object.assign(store, values), remove: async () => {} } },
  runtime: { onMessage: event, getManifest: () => ({ version: "0.2.0" }), sendMessage: async () => undefined }, tabs: {} } });

function Fixture() {
  const [candidates, setCandidates] = useState(fixtures);
  const [filter, setFilter] = useState<CandidateViewFilter>(mode === "review" ? "risky" : mode === "selected" ? "selected" : "all");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(mode === "running" || mode === "feedback-warning");
  const feedback = mode === "feedback-success" ? getFillActionFeedback(lang, { ok: true })
    : mode === "feedback-warning" ? getBatchFillFeedback(lang, 1, 1, 1)
    : mode === "feedback-review" ? getFillActionFeedback(lang, { ok: false, code: "FILL_VERIFICATION_FAILED" }) : null;
  const [tab, setTab] = useState<"candidates" | "history" | "settings">(mode === "settings" ? "settings" : "candidates");
  const metrics = computeCandidateMetrics(candidates, filter, isRiskyCandidate);
  const progress = running ? { current: 3, total: 3, solved: 2, filled: 1, statusText: "", currentQuestionId: "q3", currentBlock: candidates[2].block } : null;
  const activity = deriveWorkspaceActivity({ status: mode === "feedback-review" ? "review_required" : running ? "solving" : "ready", lang, isDetecting: false, isFullPageScan: false, scanProgress: null,
    isAutoSolving: running, autoSolveProgress: progress, fillFeedback: feedback, onStopAutoSolve: () => setRunning(false) });
  useEffect(() => { document.documentElement.lang = lang === "en" ? "en" : "zh-CN"; }, []);
  const noop = () => {};
  return <div style={APP_SHELL_STYLE}><style>{ORBIT_SCROLLBAR_CSS}</style>
    <SidePanelHeader lang={lang} authStatus="authenticated" isAuthenticated userEmail="" tab={tab} onTabChange={setTab} workspaceStatus={running ? "solving" : "ready"} />
    <div className="orbit-panel-scroll" style={PANEL_BODY_STYLE}>
      <WorkspaceTabPanel id={`sidepanel-tabpanel-${tab}`} tabId={tab}>
        <WorkspaceUserFeedback feedback={feedback} activity={activity} />
        {tab === "settings" ? <SettingsTab lang={lang} onLanguageChange={noop} /> : <CandidatesTab {...metrics} candidates={candidates} filteredCandidates={metrics.filteredCandidates}
          candidateViewFilter={filter} expandedIds={expandedIds} fillFeedback={null} detectionPhase="never_started" workspaceOrigin={origin}
          lang={lang} isAutoSolving={running} autoSolveProgress={progress} isBatchFilling={false} isBatchParsing={false} isDetecting={false} isFullPageScan={false} isRetryingRisky={false} scanProgress={null}
          onToggleCandidate={id => setCandidates(previous => previous.map(item => item.block.id === id ? { ...item, selected: !item.selected } : item))}
          onCandidateFilterChange={setFilter} onClearSelection={() => setCandidates(previous => previous.map(item => ({ ...item, selected: false })))}
          onToggleDetails={id => setExpandedIds(previous => ({ ...previous, [id]: !previous[id] }))}
          onStartAutoSolve={noop} onStopAutoSolve={() => setRunning(false)} onBatchFill={noop} onBatchParse={noop} onCancelFullPage={noop} onDetect={noop} onFillCandidate={noop}
          onFlashCandidate={noop} onFullPageDetect={noop} onRetryRisky={noop} onRetryVision={noop} onSelectAll={noop} onSelectRisky={noop} />}
      </WorkspaceTabPanel>
    </div>
    {activity && <SidePanelActivityStrip activity={activity} lang={lang} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

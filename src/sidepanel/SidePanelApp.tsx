import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DetectedCandidate, QuestionBlock } from "@/shared/types";
import { loadSettings } from "@/shared/utils/storage";
import { findNextFractionExpression, normalizeRenderableMathText, type UILang } from "./displayUtils";
import {
  isRiskyCandidate,
} from "./batchParseHeuristics";
import { HistoryTab } from "./HistoryTab";
import { SettingsTab } from "./settingsPanel";
import { registerSidePanelRuntimeListeners } from "./sidepanelMessageBridge";
import { computeCandidateMetrics, type CandidateViewFilter } from "./sidepanelCandidateMetrics";
import { CandidatesTab } from "./CandidatesTab";
import { useSidePanelActions } from "./useSidePanelActions";

export { findNextFractionExpression, normalizeRenderableMathText, renderMathText } from "./displayUtils";
export const SidePanelApp: React.FC = () => {
  const [uiLang, setUiLang] = useState<UILang>("zh");
  const [tab, setTab] = useState<"candidates" | "history" | "settings">("candidates");
  const [candidates, setCandidates] = useState<DetectedCandidate[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isFullPageScan, setIsFullPageScan] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ progress: number; found: number; step: number; total: number } | null>(null);
  const [isBatchParsing, setIsBatchParsing] = useState(false);
  const [isBatchFilling, setIsBatchFilling] = useState(false);
  const [isRetryingRisky, setIsRetryingRisky] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [candidateViewFilter, setCandidateViewFilter] = useState<CandidateViewFilter>("all");
  const [fillFeedback, setFillFeedback] = useState<string>("");
  const [isAutoSolving, setIsAutoSolving] = useState(false);
  const [autoSolveProgress, setAutoSolveProgress] = useState<{
    solved: number;
    filled: number;
    total: number;
    current: number;
    statusText: string;
    currentPreview?: string;
    currentBlock?: QuestionBlock;
  } | null>(null);

  useEffect(() => {
    return registerSidePanelRuntimeListeners({
      loadLanguage: async () => ((await loadSettings()).language ?? "zh") as UILang,
      setUiLang,
      setCandidates,
      setIsDetecting,
      setIsFullPageScan,
      setScanProgress,
      setExpandedIds,
      setIsAutoSolving,
      setAutoSolveProgress,
      setFillFeedback,
    });
  }, []);

  const {
    handleBatchFill,
    handleBatchParse,
    handleCancelFullPage,
    handleClearSelection,
    handleDetect,
    handleFillCandidate,
    handleFlash,
    handleFullPageDetect,
    handleRetryRisky,
    handleRetryVision,
    handleSelectAll,
    handleSelectRisky,
    handleStartAutoSolve,
    handleStopAutoSolve,
    toggleDetails,
    toggleSelect,
  } = useSidePanelActions({
    candidates,
    isBatchParsing,
    setCandidates,
    setExpandedIds,
    setFillFeedback,
    setIsAutoSolving,
    setIsBatchFilling,
    setIsBatchParsing,
    setIsDetecting,
    setIsFullPageScan,
    setIsRetryingRisky,
    setAutoSolveProgress,
    setScanProgress,
    uiLang,
  });

  const { selectedCount, selectedSolvedCount, riskyCount, doneCount, filteredCandidates } = useMemo(
    () => computeCandidateMetrics(candidates, candidateViewFilter, isRiskyCandidate),
    [candidateViewFilter, candidates],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <div style={{ display: "flex", flexShrink: 0, backgroundColor: "#181825", borderBottom: "1px solid #313244" }}>
        {[
          { id: "candidates" as const, label: uiLang === "en" ? "Candidates" : "\u5019\u9009\u9898" },
          { id: "history" as const, label: uiLang === "en" ? "History" : "\u5386\u53f2" },
          { id: "settings" as const, label: uiLang === "en" ? "Settings" : "\u8bbe\u7f6e" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: "11px 4px",
              border: "none",
              cursor: "pointer",
              backgroundColor: tab === t.id ? "#1e1e2e" : "transparent",
              color: tab === t.id ? "#cba6f7" : "#6c7086",
              fontSize: 12,
              fontWeight: tab === t.id ? 700 : 400,
              borderBottom: `2px solid ${tab === t.id ? "#cba6f7" : "transparent"}`,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "candidates" && (
          <CandidatesTab
            autoSolveProgress={autoSolveProgress}
            candidateViewFilter={candidateViewFilter}
            candidates={candidates}
            doneCount={doneCount}
            expandedIds={expandedIds}
            fillFeedback={fillFeedback}
            filteredCandidates={filteredCandidates}
            isAutoSolving={isAutoSolving}
            isBatchFilling={isBatchFilling}
            isBatchParsing={isBatchParsing}
            isDetecting={isDetecting}
            isFullPageScan={isFullPageScan}
            isRetryingRisky={isRetryingRisky}
            lang={uiLang}
            riskyCount={riskyCount}
            scanProgress={scanProgress}
            selectedCount={selectedCount}
            selectedSolvedCount={selectedSolvedCount}
            onBatchFill={handleBatchFill}
            onBatchParse={handleBatchParse}
            onCancelFullPage={handleCancelFullPage}
            onCandidateFilterChange={setCandidateViewFilter}
            onClearSelection={handleClearSelection}
            onDetect={handleDetect}
            onFillCandidate={handleFillCandidate}
            onFlashCandidate={handleFlash}
            onFullPageDetect={handleFullPageDetect}
            onRetryRisky={handleRetryRisky}
            onRetryVision={handleRetryVision}
            onSelectAll={handleSelectAll}
            onSelectRisky={handleSelectRisky}
            onStartAutoSolve={handleStartAutoSolve}
            onStopAutoSolve={handleStopAutoSolve}
            onToggleCandidate={toggleSelect}
            onToggleDetails={toggleDetails}
          />
        )}

        {tab === "history" && <HistoryTab lang={uiLang} />}
        {tab === "settings" && <SettingsTab lang={uiLang} onLanguageChange={setUiLang} />}
      </div>
    </div>
  );
};

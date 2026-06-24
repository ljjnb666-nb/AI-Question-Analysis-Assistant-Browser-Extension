import React from "react";
import type { DetectedCandidate, QuestionBlock } from "@/shared/types";
import { AutoSolvePreviewCard, CandidateCard } from "./candidateViews";
import { Btn } from "./settingsPanel";
import type { CandidateViewFilter } from "./sidepanelCandidateMetrics";
import type { UILang } from "./displayUtils";

type AutoSolveProgress = {
  solved: number;
  filled: number;
  total: number;
  current: number;
  statusText: string;
  currentPreview?: string;
  currentBlock?: QuestionBlock;
} | null;

type ScanProgress = { progress: number; found: number; step: number; total: number } | null;

export const CandidatesTab: React.FC<{
  autoSolveProgress: AutoSolveProgress;
  candidateViewFilter: CandidateViewFilter;
  candidates: DetectedCandidate[];
  doneCount: number;
  expandedIds: Record<string, boolean>;
  fillFeedback: string;
  filteredCandidates: DetectedCandidate[];
  isAutoSolving: boolean;
  isBatchFilling: boolean;
  isBatchParsing: boolean;
  isDetecting: boolean;
  isFullPageScan: boolean;
  isRetryingRisky: boolean;
  lang: UILang;
  riskyCount: number;
  scanProgress: ScanProgress;
  selectedCount: number;
  selectedSolvedCount: number;
  onBatchFill: () => void;
  onBatchParse: () => void;
  onCancelFullPage: () => void;
  onCandidateFilterChange: (filter: CandidateViewFilter) => void;
  onClearSelection: () => void;
  onDetect: () => void;
  onFillCandidate: (candidate: DetectedCandidate) => void;
  onFlashCandidate: (blockId: string) => void;
  onFullPageDetect: () => void;
  onRetryRisky: () => void;
  onRetryVision: (candidate: DetectedCandidate) => void;
  onSelectAll: () => void;
  onSelectRisky: () => void;
  onStartAutoSolve: () => void;
  onStopAutoSolve: () => void;
  onToggleCandidate: (blockId: string) => void;
  onToggleDetails: (blockId: string) => void;
}> = ({
  autoSolveProgress,
  candidateViewFilter,
  candidates,
  doneCount,
  expandedIds,
  fillFeedback,
  filteredCandidates,
  isAutoSolving,
  isBatchFilling,
  isBatchParsing,
  isDetecting,
  isFullPageScan,
  isRetryingRisky,
  lang,
  riskyCount,
  scanProgress,
  selectedCount,
  selectedSolvedCount,
  onBatchFill,
  onBatchParse,
  onCancelFullPage,
  onCandidateFilterChange,
  onClearSelection,
  onDetect,
  onFillCandidate,
  onFlashCandidate,
  onFullPageDetect,
  onRetryRisky,
  onRetryVision,
  onSelectAll,
  onSelectRisky,
  onStartAutoSolve,
  onStopAutoSolve,
  onToggleCandidate,
  onToggleDetails,
}) => {
  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <Btn primary onClick={onDetect} disabled={isDetecting || isFullPageScan}>
          {isDetecting ? (lang === "en" ? "Detecting..." : "识别中...") : (lang === "en" ? "Current View" : "当前屏")}
        </Btn>
        <Btn primary={isFullPageScan} onClick={isFullPageScan ? onCancelFullPage : onFullPageDetect} disabled={isDetecting}>
          {isFullPageScan ? (lang === "en" ? "Stop Scan" : "停止扫描") : (lang === "en" ? "Full Page Scan" : "整页扫描")}
        </Btn>
        <Btn
          primary={isAutoSolving}
          onClick={isAutoSolving ? onStopAutoSolve : onStartAutoSolve}
          disabled={isDetecting || isFullPageScan || isBatchParsing || isBatchFilling}
        >
          {isAutoSolving
            ? (lang === "en" ? "Stop Auto Solve" : "停止自动答题")
            : (lang === "en" ? "Auto Solve All" : "自动答题")}
        </Btn>
        {candidates.length > 0 && !isFullPageScan && (
          <>
            <Btn onClick={onSelectAll}>
              {lang === "en" ? "Select All" : "全选"}
            </Btn>
            <Btn onClick={onClearSelection}>
              {lang === "en" ? "Clear" : "清空"}
            </Btn>
            <Btn onClick={onSelectRisky} disabled={!riskyCount}>
              {lang === "en" ? `Select Risky ${riskyCount}` : `选中风险题 ${riskyCount}`}
            </Btn>
            <Btn onClick={onRetryRisky} disabled={!riskyCount || isRetryingRisky || isBatchParsing}>
              {isRetryingRisky
                ? (lang === "en" ? "Reviewing..." : "复核中...")
                : (lang === "en" ? `Review Risky ${riskyCount}` : `复核风险题 ${riskyCount}`)}
            </Btn>
            <Btn primary onClick={onBatchParse} disabled={!selectedCount || isBatchParsing}>
              {isBatchParsing
                ? (lang === "en" ? "Parsing..." : "解析中...")
                : (lang === "en" ? `Solve ${selectedCount}` : `解析 ${selectedCount} 题`)}
            </Btn>
            <Btn primary onClick={onBatchFill} disabled={!selectedSolvedCount || isBatchFilling || isBatchParsing}>
              {isBatchFilling
                ? (lang === "en" ? "Filling..." : "填写中...")
                : (lang === "en" ? `Fill ${selectedSolvedCount}` : `填写 ${selectedSolvedCount} 题`)}
            </Btn>
          </>
        )}
      </div>

      {fillFeedback && (
        <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, backgroundColor: "#1c2a3a", border: "1px solid #4f9cf9", fontSize: 12, color: "#cfe7ff" }}>
          {fillFeedback}
        </div>
      )}

      {autoSolveProgress && (
        <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 8, backgroundColor: "#1f2d1f", border: "1px solid #5ab56b" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
            <span style={{ color: "#8fe39a", fontWeight: 700 }}>
              {lang === "en" ? "Auto Solving" : "自动答题中"}
            </span>
            <span style={{ color: "#9bc7a3" }}>
              {lang === "en"
                ? `Solved ${autoSolveProgress.solved}${autoSolveProgress.total ? ` / ${autoSolveProgress.total}` : ""}, filled ${autoSolveProgress.filled}`
                : `已解析 ${autoSolveProgress.solved}${autoSolveProgress.total ? ` / ${autoSolveProgress.total}` : ""}，已填写 ${autoSolveProgress.filled}`}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#d5f5da", lineHeight: 1.5 }}>
            {autoSolveProgress.statusText}
          </div>
          {(autoSolveProgress.currentBlock || autoSolveProgress.currentPreview) && (
            <AutoSolvePreviewCard
              previewText={autoSolveProgress.currentPreview || ""}
              block={autoSolveProgress.currentBlock}
              lang={lang}
            />
          )}
        </div>
      )}

      {scanProgress && (
        <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 8, backgroundColor: "#1c2a3a", border: "1px solid #4f9cf9" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
            <span style={{ color: "#89b4fa", fontWeight: 600 }}>{lang === "en" ? "Scanning full page" : "整页扫描中"}</span>
            <span style={{ color: "#6c7086" }}>
              {lang === "en"
                ? `Step ${scanProgress.step}/${scanProgress.total}, found ${scanProgress.found}`
                : `第 ${scanProgress.step}/${scanProgress.total} 步，已发现 ${scanProgress.found} 题`}
            </span>
          </div>
          <div style={{ height: 5, backgroundColor: "#313244", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${scanProgress.progress}%`,
                backgroundColor: "#4f9cf9",
                borderRadius: 3,
                transition: "width 0.25s",
              }}
            />
          </div>
          <div style={{ marginTop: 4, fontSize: 10, color: "#585b70", textAlign: "right" }}>{scanProgress.progress}%</div>
        </div>
      )}

      {candidates.length > 0 && !isFullPageScan && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {([
            ["all", lang === "en" ? `All ${candidates.length}` : `全部 ${candidates.length}`],
            ["risky", lang === "en" ? `Risky ${riskyCount}` : `风险 ${riskyCount}`],
            ["done", lang === "en" ? `Done ${doneCount}` : `完成 ${doneCount}`],
          ] as const).map(([filterId, label]) => (
            <button
              key={filterId}
              onClick={() => onCandidateFilterChange(filterId)}
              style={{
                border: `1px solid ${candidateViewFilter === filterId ? "#4f9cf9" : "#313244"}`,
                backgroundColor: candidateViewFilter === filterId ? "#1c2a3a" : "transparent",
                color: candidateViewFilter === filterId ? "#89b4fa" : "#6c7086",
                borderRadius: 999,
                fontSize: 11,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {candidates.length === 0 && !isDetecting && !isFullPageScan && !scanProgress && (
        <div style={{ textAlign: "center", padding: "28px 0", color: "#6c7086", fontSize: 13 }}>
          {lang === "en"
            ? "Click 'Current View' or 'Full Page Scan' to detect questions"
            : "点击“当前屏”或“整页扫描”开始识别题目"}
        </div>
      )}

      {filteredCandidates.map((cand, i) => (
        <CandidateCard
          key={cand.block.id}
          index={i + 1}
          cand={cand}
          isExpanded={!!expandedIds[cand.block.id]}
          onToggle={() => onToggleCandidate(cand.block.id)}
          onFlash={() => onFlashCandidate(cand.block.id)}
          onToggleDetails={() => onToggleDetails(cand.block.id)}
          onFill={() => onFillCandidate(cand)}
          onRetryVision={() => onRetryVision(cand)}
          lang={lang}
        />
      ))}
    </div>
  );
};

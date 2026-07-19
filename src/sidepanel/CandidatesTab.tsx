import React, { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { DetectedCandidate, QuestionBlock as _QuestionBlock } from "@/shared/types";
import { CandidateCard } from "./candidateViews";
import {
  CandidateAutoSolveCard,
  CandidateFeedbackCard,
  CandidateFilterBar,
  CandidateQuickActionsCard,
  CandidateScanProgressCard,
  CandidateStatsGrid,
  EmptyCandidatesState,
} from "./candidatesTabSections";
import type { CandidateViewFilter } from "./sidepanelCandidateMetrics";
import type { UILang } from "./displayUtils";
import type { CandidateAutoSolveProgress, CandidateScanProgress } from "./candidatesTabSections";

gsap.registerPlugin(useGSAP);

export const CandidatesTab: React.FC<{
  autoSolveProgress: CandidateAutoSolveProgress;
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
  scanProgress: CandidateScanProgress;
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
  lang,
}) => {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const isEn = lang === "en";
  const statCards = [
    { label: isEn ? "Detected" : "\u5df2\u8bc6\u522b", value: candidates.length, tint: "rgba(99, 102, 241, 0.15)", glow: "rgba(99, 102, 241, 0.25)" },
    { label: isEn ? "Selected" : "\u5df2\u9009\u4e2d", value: selectedCount, tint: "rgba(139, 92, 246, 0.15)", glow: "rgba(139, 92, 246, 0.25)" },
    { label: isEn ? "Solved" : "\u5df2\u5b8c\u6210", value: doneCount, tint: "rgba(16, 185, 129, 0.12)", glow: "rgba(16, 185, 129, 0.2)" },
    { label: isEn ? "Risky" : "\u5f85\u590d\u6838", value: riskyCount, tint: "rgba(245, 158, 11, 0.12)", glow: "rgba(245, 158, 11, 0.2)" },
  ];

  useGSAP(() => {
    gsap.from(".cand-stat", {
      y: 14,
      autoAlpha: 0,
      duration: 0.4,
      stagger: 0.06,
      ease: "power2.out",
    });
    gsap.from(".cand-section", {
      y: 16,
      autoAlpha: 0,
      duration: 0.42,
      stagger: 0.08,
      ease: "power2.out",
      delay: 0.08,
    });
    gsap.from(".candidate-card", {
      y: 12,
      autoAlpha: 0,
      duration: 0.35,
      stagger: 0.035,
      ease: "power2.out",
      delay: 0.14,
    });

    const hoverTargets = gsap.utils.toArray<HTMLElement>(".cand-stat, .cand-section");
    const cleanups = hoverTargets.map((element) => {
      const onEnter = () => {
        gsap.to(element, {
          y: -3,
          boxShadow: "0 12px 28px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
          duration: 0.2,
          ease: "power2.out",
        });
      };
      const onLeave = () => {
        gsap.to(element, {
          y: 0,
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.04)",
          duration: 0.2,
          ease: "power2.out",
        });
      };
      element.addEventListener("mouseenter", onEnter);
      element.addEventListener("mouseleave", onLeave);
      return () => {
        element.removeEventListener("mouseenter", onEnter);
        element.removeEventListener("mouseleave", onLeave);
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, { scope: scopeRef, dependencies: [filteredCandidates.length, candidates.length, candidateViewFilter], revertOnUpdate: true });

  return (
    <div ref={scopeRef} style={{ padding: "12px 0 18px" }}>
      <CandidateStatsGrid statCards={statCards} />
      <CandidateQuickActionsCard
        candidatesCount={candidates.length}
        isAutoSolving={isAutoSolving}
        isBatchFilling={isBatchFilling}
        isBatchParsing={isBatchParsing}
        isDetecting={isDetecting}
        isEn={isEn}
        isFullPageScan={isFullPageScan}
        isRetryingRisky={isRetryingRisky}
        onBatchFill={onBatchFill}
        onBatchParse={onBatchParse}
        onCancelFullPage={onCancelFullPage}
        onClearSelection={onClearSelection}
        onDetect={onDetect}
        onFullPageDetect={onFullPageDetect}
        onRetryRisky={onRetryRisky}
        onSelectAll={onSelectAll}
        onSelectRisky={onSelectRisky}
        onStartAutoSolve={onStartAutoSolve}
        onStopAutoSolve={onStopAutoSolve}
        riskyCount={riskyCount}
        selectedCount={selectedCount}
        selectedSolvedCount={selectedSolvedCount}
      />
      <CandidateFeedbackCard fillFeedback={fillFeedback} />
      <CandidateAutoSolveCard autoSolveProgress={autoSolveProgress} lang={lang} />
      <CandidateScanProgressCard isEn={isEn} scanProgress={scanProgress} />
      <CandidateFilterBar
        candidateViewFilter={candidateViewFilter}
        candidatesCount={candidates.length}
        doneCount={doneCount}
        isEn={isEn}
        isFullPageScan={isFullPageScan}
        onCandidateFilterChange={onCandidateFilterChange}
        riskyCount={riskyCount}
      />
      {candidates.length === 0 ? (
        <EmptyCandidatesState
          isDetecting={isDetecting}
          isEn={isEn}
          isFullPageScan={isFullPageScan}
          scanProgress={scanProgress}
        />
      ) : null}

      <div>
        {filteredCandidates.map((cand, i) => (
          <div key={cand.block.id} className="candidate-card">
            <CandidateCard
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
          </div>
        ))}
      </div>
    </div>
  );
};

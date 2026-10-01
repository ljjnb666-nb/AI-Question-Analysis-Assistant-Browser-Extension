import React from "react";
import { UiButton } from "@/shared/ui/extensionUi";
import type { QuestionBlock } from "@/shared/types";
import { autoSolveStatusLabel, autoSolveStatusFeedback, autoSolveStatusTone, sanitizeLegacyAutoSolveStatusText } from "@/shared/ui/autoSolveStatus";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import { AutoSolvePreviewCard } from "./candidateViews";
import type { CandidateViewFilter } from "./sidepanelCandidateMetrics";
import { PanelChrome, sidePanelCardStyle } from "./sidepanelTheme";
import type { UILang } from "./displayUtils";

export type CandidateAutoSolveProgress = {
  solved: number;
  filled: number;
  total: number;
  current: number;
  statusText: string;
  statusCode?: string;
  statusDetail?: string;
  currentPreview?: string;
  currentBlock?: QuestionBlock;
} | null;

export type CandidateScanProgress = { progress: number; found: number; step: number; total: number } | null;

type StatCard = {
  label: string;
  value: number;
  tint: string;
  glow: string;
};

export const CandidateStatsGrid: React.FC<{ statCards: StatCard[] }> = ({ statCards }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, padding: "0 0 10px" }}>
    {statCards.map((card) => (
      <div
        key={card.label}
        className="cand-stat"
        style={{
          ...sidePanelCardStyle,
          padding: 0,
          position: "relative",
          overflow: "visible",
          minHeight: 96,
          boxShadow:
            "0 4px 16px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 14,
            right: 14,
            bottom: -8,
            height: 18,
            borderRadius: 999,
            background: `radial-gradient(circle, ${card.glow} 0%, rgba(0,0,0,0) 72%)`,
            filter: "blur(12px)",
            opacity: 0.9,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 14,
            background: `linear-gradient(135deg, ${card.tint}, rgba(255,255,255,0) 52%)`,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 1,
            borderRadius: 13,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01) 22%, rgba(255,255,255,0) 34%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "relative",
            margin: 6,
            borderRadius: 11,
            padding: "14px 14px 12px",
            minHeight: 82,
            background: "linear-gradient(180deg, rgba(16, 24, 48, 0.85), rgba(10, 15, 30, 0.9))",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 12px rgba(0,0,0,0.15)",
            transform: "translateY(-1px)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 26%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 10,
              top: 10,
              width: 34,
              height: 34,
              borderRadius: 10,
              background: `radial-gradient(circle at 35% 35%, ${card.glow}, rgba(0,0,0,0) 72%)`,
              filter: "blur(4px)",
              opacity: 0.9,
              pointerEvents: "none",
            }}
          />
          <div style={{ fontSize: 11, color: "#818cf8", letterSpacing: 0.2, textShadow: `0 0 12px ${card.glow}` }}>
            {card.label}
          </div>
          <div
            style={{
              fontSize: 28,
              lineHeight: 1,
              fontWeight: 800,
              color: "#f8fafc",
              marginTop: 10,
              textShadow: `0 0 18px ${card.glow}`,
            }}
          >
            {card.value}
          </div>
        </div>
      </div>
    ))}
  </div>
);

export const CandidateQuickActionsCard: React.FC<{
  candidatesCount: number;
  isAutoSolving: boolean;
  isBatchFilling: boolean;
  isBatchParsing: boolean;
  isDetecting: boolean;
  isEn: boolean;
  isFullPageScan: boolean;
  isRetryingRisky: boolean;
  onBatchFill: () => void;
  onBatchParse: () => void;
  onCancelFullPage: () => void;
  onClearSelection: () => void;
  onDetect: () => void;
  onFullPageDetect: () => void;
  onRetryRisky: () => void;
  onSelectAll: () => void;
  onSelectRisky: () => void;
  onStartAutoSolve: () => void;
  onStopAutoSolve: () => void;
  riskyCount: number;
  selectedCount: number;
  selectedSolvedCount: number;
}> = (props) => (
  <div
    className="cand-section"
    style={{
      ...sidePanelCardStyle,
      padding: 12,
      marginBottom: 10,
      background: "linear-gradient(135deg, rgba(16, 22, 42, 0.95) 0%, rgba(10, 14, 28, 0.9) 58%, rgba(20, 12, 40, 0.85) 100%)",
      position: "relative",
      overflow: "hidden",
    }}
  >
    <PanelChrome glow="rgba(99, 102, 241, 0.16)" bottom={-12} height={24} overlay="linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0) 26%)" />
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>{props.isEn ? "Quick Actions" : "快捷操作"}</div>
        <div style={{ fontSize: 11, lineHeight: 1.55, color: "#94a3b8", marginTop: 4 }}>
          {props.isEn
            ? "Run detection, solve answers, and review risky items from one place."
            : "在一个区域里完成识别、答题、填答和复核。"}
        </div>
      </div>
      {(props.isAutoSolving || props.isBatchParsing || props.isBatchFilling || props.isFullPageScan) && (
        <div
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(99, 102, 241, 0.1)",
            border: "1px solid rgba(99, 102, 241, 0.2)",
            color: "#a5b4fc",
            fontSize: 11,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {props.isEn ? "Running" : "运行中"}
        </div>
      )}
    </div>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <UiButton primary onClick={props.onDetect} disabled={props.isDetecting || props.isFullPageScan}>
        {props.isDetecting ? (props.isEn ? "Detecting..." : "识别中...") : props.isEn ? "Current View" : "当前屏"}
      </UiButton>
      <UiButton onClick={props.isFullPageScan ? props.onCancelFullPage : props.onFullPageDetect} disabled={props.isDetecting}>
        {props.isFullPageScan ? (props.isEn ? "Stop Scan" : "停止扫描") : props.isEn ? "Full Page" : "整页扫描"}
      </UiButton>
      <UiButton
        onClick={props.isAutoSolving ? props.onStopAutoSolve : props.onStartAutoSolve}
        disabled={props.isDetecting || props.isFullPageScan || props.isBatchParsing || props.isBatchFilling}
      >
        {props.isAutoSolving ? (props.isEn ? "Stop Auto Solve" : "停止自动答题") : props.isEn ? "Auto Solve" : "自动答题"}
      </UiButton>
      {props.candidatesCount > 0 && !props.isFullPageScan ? (
        <>
          <UiButton onClick={props.onSelectAll}>{props.isEn ? "Select All" : "全选"}</UiButton>
          <UiButton onClick={props.onClearSelection}>{props.isEn ? "Clear" : "清空"}</UiButton>
          <UiButton onClick={props.onSelectRisky} disabled={!props.riskyCount}>
            {props.isEn ? `Risky ${props.riskyCount}` : `风险 ${props.riskyCount}`}
          </UiButton>
          <UiButton onClick={props.onRetryRisky} disabled={!props.riskyCount || props.isRetryingRisky || props.isBatchParsing}>
            {props.isRetryingRisky ? (props.isEn ? "Reviewing..." : "复核中...") : props.isEn ? "Review Risky" : "复核风险题"}
          </UiButton>
          <UiButton primary onClick={props.onBatchParse} disabled={!props.selectedCount || props.isBatchParsing}>
            {props.isBatchParsing ? (props.isEn ? "Solving..." : "解析中...") : props.isEn ? `Solve ${props.selectedCount}` : `解析 ${props.selectedCount}`}
          </UiButton>
          <UiButton primary onClick={props.onBatchFill} disabled={!props.selectedSolvedCount || props.isBatchFilling || props.isBatchParsing}>
            {props.isBatchFilling ? (props.isEn ? "Filling..." : "填写中...") : props.isEn ? `Fill ${props.selectedSolvedCount}` : `填写 ${props.selectedSolvedCount}`}
          </UiButton>
        </>
      ) : null}
    </div>
    {props.selectedCount > 0 && props.selectedSolvedCount === 0 && !props.isBatchParsing ? (
      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          lineHeight: 1.6,
          color: "#8fa8c5",
        }}
      >
        {props.isEn
          ? "Selected questions are detected but not solved yet. Run Solve first, then Fill will become available."
          : "已选中的题目还没有解析结果，请先点击“解析”，之后“填写”才会可用。"}
      </div>
    ) : null}
  </div>
);

/**
 * UI-00B PART C: minimal semantic tone styles. Success, info, warning, and
 * error no longer share the success visual; this is a semantic correction,
 * not a redesign.
 */
const FEEDBACK_TONE_STYLES: Record<UserFeedback["tone"], { border: string; background: string; text: string; glow: string }> = {
  success: {
    border: "rgba(16, 185, 129, 0.18)",
    background: "linear-gradient(180deg, rgba(6, 40, 28, 0.8), rgba(5, 28, 20, 0.75))",
    text: "#a7f3d0",
    glow: "rgba(16, 185, 129, 0.16)",
  },
  info: {
    border: "rgba(99, 102, 241, 0.2)",
    background: "linear-gradient(180deg, rgba(17, 24, 46, 0.85), rgba(12, 17, 34, 0.8))",
    text: "#c7d2fe",
    glow: "rgba(99, 102, 241, 0.16)",
  },
  warning: {
    border: "rgba(245, 158, 11, 0.22)",
    background: "linear-gradient(180deg, rgba(67, 40, 15, 0.8), rgba(45, 25, 10, 0.75))",
    text: "#fde68a",
    glow: "rgba(245, 158, 11, 0.16)",
  },
  error: {
    border: "rgba(239, 68, 68, 0.24)",
    background: "linear-gradient(180deg, rgba(69, 26, 26, 0.85), rgba(45, 15, 15, 0.8))",
    text: "#fecaca",
    glow: "rgba(239, 68, 68, 0.16)",
  },
};

export const CandidateFeedbackCard: React.FC<{ fillFeedback: UserFeedback | null }> = ({ fillFeedback }) => {
  if (!fillFeedback?.message) return null;
  const tone = FEEDBACK_TONE_STYLES[fillFeedback.tone] ?? FEEDBACK_TONE_STYLES.info;
  return (
    <div
      className="cand-section"
      role="status"
      data-feedback-tone={fillFeedback.tone}
      style={{
        ...sidePanelCardStyle,
        padding: "11px 12px",
        marginBottom: 10,
        borderColor: tone.border,
        background: tone.background,
        color: tone.text,
        fontSize: 12,
        lineHeight: 1.6,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <PanelChrome glow={tone.glow} />
      {fillFeedback.message}
    </div>
  );
};

export const CandidateAutoSolveCard: React.FC<{
  autoSolveProgress: CandidateAutoSolveProgress;
  lang: UILang;
}> = ({ autoSolveProgress, lang }) => {
  if (!autoSolveProgress) return null;
  // UI-00B PART F + review fix P1-03/P1-04: the stable status code owns the
  // user-visible copy AND the card's semantic tone — a safety stop never
  // renders in the running/success look. Legacy statusText is untrusted
  // input and only ever collapses to a recognized or neutral copy.
  const statusData = {
    current: autoSolveProgress.current,
    solved: autoSolveProgress.solved,
    filled: autoSolveProgress.filled,
    total: autoSolveProgress.total,
    detail: autoSolveProgress.statusDetail || undefined,
  };
  const statusFeedback = autoSolveProgress.statusCode
    ? autoSolveStatusFeedback(autoSolveProgress.statusCode, lang, statusData)
    : null;
  const statusLine = statusFeedback?.detail
    ? statusFeedback.detail.message
    : autoSolveProgress.statusCode
      ? statusFeedback!.label
      : sanitizeLegacyAutoSolveStatusText(autoSolveProgress.statusText, lang);
  const tone = FEEDBACK_TONE_STYLES[autoSolveStatusTone(autoSolveProgress.statusCode)];
  return (
    <div
      className="cand-section"
      data-status-tone={autoSolveStatusTone(autoSolveProgress.statusCode)}
      style={{
        ...sidePanelCardStyle,
        padding: 12,
        marginBottom: 10,
        borderColor: tone.border,
        background: tone.background,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <PanelChrome glow={tone.glow} />
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 8, fontSize: 12 }}>
        <span style={{ color: tone.text, fontWeight: 700 }}>{lang === "en" ? "Auto Solve" : "自动答题"}</span>
        <span style={{ color: "#94a3b8" }}>
          {lang === "en"
            ? `Solved ${autoSolveProgress.solved}${autoSolveProgress.total ? ` / ${autoSolveProgress.total}` : ""}, filled ${autoSolveProgress.filled}`
            : `已解析 ${autoSolveProgress.solved}${autoSolveProgress.total ? ` / ${autoSolveProgress.total}` : ""}，已填写 ${autoSolveProgress.filled}`}
        </span>
      </div>
      <div style={{ fontSize: 12, color: tone.text, lineHeight: 1.6 }}>{statusLine}</div>
      {(autoSolveProgress.currentBlock || autoSolveProgress.currentPreview) && (
        <AutoSolvePreviewCard previewText={autoSolveProgress.currentPreview || ""} block={autoSolveProgress.currentBlock} lang={lang} />
      )}
    </div>
  );
};

export const CandidateScanProgressCard: React.FC<{
  isEn: boolean;
  scanProgress: CandidateScanProgress;
}> = ({ isEn, scanProgress }) =>
  scanProgress ? (
    <div className="cand-section" style={{ ...sidePanelCardStyle, padding: 12, marginBottom: 10, position: "relative", overflow: "hidden" }}>
      <PanelChrome glow="rgba(99, 102, 241, 0.16)" />
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 8, fontSize: 12 }}>
        <span style={{ color: "#f8fafc", fontWeight: 700 }}>{isEn ? "Full Page Scan" : "整页扫描"}</span>
        <span style={{ color: "#94a3b8" }}>
          {isEn ? `Step ${scanProgress.step}/${scanProgress.total}, found ${scanProgress.found}` : `第 ${scanProgress.step}/${scanProgress.total} 步，发现 ${scanProgress.found} 题`}
        </span>
      </div>
      <div style={{ height: 6, backgroundColor: "rgba(255, 255, 255, 0.04)", borderRadius: 999, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${scanProgress.progress}%`,
            background: "linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)",
            borderRadius: 999,
            transition: "width 0.25s ease",
          }}
        />
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8", textAlign: "right" }}>{scanProgress.progress}%</div>
    </div>
  ) : null;

export const CandidateFilterBar: React.FC<{
  candidateViewFilter: CandidateViewFilter;
  candidatesCount: number;
  doneCount: number;
  isEn: boolean;
  isFullPageScan: boolean;
  onCandidateFilterChange: (filter: CandidateViewFilter) => void;
  riskyCount: number;
}> = ({ candidateViewFilter, candidatesCount, doneCount, isEn, isFullPageScan, onCandidateFilterChange, riskyCount }) =>
  candidatesCount > 0 && !isFullPageScan ? (
    <div className="cand-section" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      {([
        ["all", isEn ? `All ${candidatesCount}` : `全部 ${candidatesCount}`],
        ["risky", isEn ? `Risky ${riskyCount}` : `风险 ${riskyCount}`],
        ["done", isEn ? `Done ${doneCount}` : `完成 ${doneCount}`],
      ] as const).map(([filterVal, label]) => {
        const active = candidateViewFilter === filterVal;
        return (
          <UiButton
            key={filterVal}
            onClick={() => onCandidateFilterChange(filterVal)}
            primary={active}
          >
            {label}
          </UiButton>
        );
      })}
    </div>
  ) : null;

export const EmptyCandidatesState: React.FC<{
  isDetecting: boolean;
  isEn: boolean;
  isFullPageScan: boolean;
  scanProgress: CandidateScanProgress;
}> = ({ isDetecting, isEn, isFullPageScan, scanProgress }) =>
  !isDetecting && !isFullPageScan && !scanProgress ? (
    <div
      className="cand-section"
      style={{
        ...sidePanelCardStyle,
        textAlign: "left",
        padding: "18px 16px",
        color: "#94a3b8",
        fontSize: 13,
        lineHeight: 1.65,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <PanelChrome glow="rgba(99, 102, 241, 0.16)" />
      {isEn
        ? 'Use "Current View" or "Full Page" to start detection. Auto Solve becomes useful after questions are found.'
        : "先用“当前屏”或“整页扫描”开始识别，找到题目后再使用“自动答题”会更高效。"}
    </div>
  ) : null;

import React from "react";
import { OrbitButton, OrbitSurface } from "@/shared/ui/orbitPrimitives";
import { orbitColors, orbitRadius, orbitSpacing, orbitTypography, orbitTokens } from "@/shared/ui/orbitTokens";
import type { DetectionPhase, FullPageDetectOutcome } from "@/shared/types";
import type { UILang } from "./displayUtils";
import type { CandidateViewFilter } from "./sidepanelCandidateMetrics";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";

export function CandidateSummary({
  lang,
  counts,
}: {
  lang: UILang;
  counts: { detected: number; selected: number; solved: number; risky: number };
}) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];

  const items = [
    { key: "detected" as const, label: copy.detected, count: counts.detected, color: orbitColors.text.primary },
    { key: "selected" as const, label: copy.selected, count: counts.selected, color: counts.selected > 0 ? orbitColors.brand.primary : orbitColors.text.secondary },
    { key: "solved" as const, label: copy.solved, count: counts.solved, color: counts.solved > 0 ? orbitColors.semantic.success : orbitColors.text.secondary },
    { key: "risky" as const, label: copy.risky, count: counts.risky, color: counts.risky > 0 ? orbitColors.semantic.warning : orbitColors.text.secondary },
  ];

  return (
    <dl
      aria-label={copy.summary}
      style={{
        margin: 0,
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: orbitSpacing[1],
        padding: `${orbitSpacing[2]}px ${orbitSpacing[2]}px`,
        borderRadius: orbitRadius.md,
        backgroundColor: orbitColors.bg.surfaceSubtle,
        border: `1px solid ${orbitColors.border.subtle}`,
      }}
    >
      {items.map((item, index) => (
        <div
          key={item.key}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: `2px ${orbitSpacing[1]}px`,
            minWidth: 0,
            borderRight: index < items.length - 1 ? `1px solid ${orbitColors.border.subtle}` : "none",
          }}
        >
          <dt
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.text.secondary,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "100%",
              letterSpacing: 0.2,
              marginBottom: 2,
            }}
          >
            {item.label}
          </dt>
          <dd
            style={{
              margin: 0,
              fontSize: orbitTypography.fontSize.base,
              fontWeight: orbitTypography.fontWeight.bold,
              color: item.color,
              lineHeight: 1.2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {item.count}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type CandidateAction = {
  label: string;
  onAction: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
};

export function CandidateActionBar({
  lang,
  actions,
}: {
  lang: UILang;
  actions: CandidateAction[];
}) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];

  // Group actions into clear visual tiers:
  // Tier 1: Scan / Hero actions (Current View, Full Page, Solve & Fill / Stop)
  // Tier 2: Batch actions (Solve selected, Fill selected)
  // Tier 3: Review triage actions (Select review items, Retry review items)
  const isScanOrHero = (label: string) =>
    label === copy.currentView ||
    label === copy.fullPage ||
    label === copy.cancelScan ||
    label === copy.solveFill ||
    label === copy.stop;

  const isReviewAction = (label: string) =>
    label === copy.selectReview || label === copy.retryReview;

  const heroActions = actions.filter(a => isScanOrHero(a.label));
  const batchActions = actions.filter(a => !isScanOrHero(a.label) && !isReviewAction(a.label));
  const reviewActions = actions.filter(a => isReviewAction(a.label));

  return (
    <div
      role="group"
      aria-label={copy.actions}
      style={{
        display: "grid",
        gap: orbitSpacing[2],
        minWidth: 0,
      }}
    >
      {/* Hero & Detection Actions */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: heroActions.some(a => a.primary || a.danger)
            ? "minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr)"
            : "repeat(2, minmax(0, 1fr))",
          gap: orbitSpacing[2],
        }}
      >
        {heroActions.map(action => (
          <OrbitButton
            key={action.label}
            size="sm"
            variant={action.danger ? "danger" : action.primary ? "primary" : "secondary"}
            disabled={action.disabled}
            onClick={action.onAction}
            style={{
              minWidth: 0,
              whiteSpace: "normal",
              height: "auto",
              minHeight: orbitSpacing[8],
              paddingInline: orbitSpacing[2],
              fontSize: orbitTypography.fontSize.sm,
              lineHeight: 1.25,
              textAlign: "center",
              overflowWrap: "anywhere",
            }}
          >
            {action.label}
          </OrbitButton>
        ))}
      </div>

      {/* Batch Selection Actions */}
      {batchActions.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${batchActions.length}, minmax(0, 1fr))`,
            gap: orbitSpacing[2],
          }}
        >
          {batchActions.map(action => (
            <OrbitButton
              key={action.label}
              size="sm"
              variant="secondary"
              disabled={action.disabled}
              onClick={action.onAction}
              style={{
                minWidth: 0,
                whiteSpace: "normal",
                height: "auto",
                minHeight: orbitSpacing[8],
                paddingInline: orbitSpacing[2],
                fontSize: orbitTypography.fontSize.sm,
                lineHeight: 1.25,
                textAlign: "center",
                overflowWrap: "anywhere",
              }}
            >
              {action.label}
            </OrbitButton>
          ))}
        </div>
      )}

      {/* Review Triage Actions (when review items present) */}
      {reviewActions.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${reviewActions.length}, minmax(0, 1fr))`,
            gap: orbitSpacing[2],
            padding: orbitSpacing[1],
            borderRadius: orbitRadius.md,
            backgroundColor: orbitColors.semantic.warningSurface,
            border: `1px solid ${orbitColors.semantic.warningBorder}`,
          }}
        >
          {reviewActions.map(action => (
            <OrbitButton
              key={action.label}
              size="sm"
              variant="ghost"
              disabled={action.disabled}
              onClick={action.onAction}
              style={{
                minWidth: 0,
                whiteSpace: "normal",
                height: "auto",
                minHeight: 28,
                paddingInline: orbitSpacing[2],
                fontSize: orbitTypography.fontSize.xs,
                color: orbitColors.semantic.warning,
                lineHeight: 1.2,
                textAlign: "center",
                overflowWrap: "anywhere",
              }}
            >
              {action.label}
            </OrbitButton>
          ))}
        </div>
      )}
    </div>
  );
}

export function CandidateReviewToolbar({
  lang,
  filter,
  onFilter,
  onClear,
  selectedCount,
}: {
  lang: UILang;
  filter: CandidateViewFilter;
  onFilter: (filter: CandidateViewFilter) => void;
  onClear: () => void;
  selectedCount: number;
}) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const views: Array<[CandidateViewFilter, string]> = [
    ["all", copy.all],
    ["selected", copy.selected],
    ["unsolved", copy.unsolved],
    ["done", copy.solved],
    ["risky", copy.review],
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: orbitSpacing[1],
        paddingBlock: orbitSpacing[1],
        borderBlock: `1px solid ${orbitColors.border.subtle}`,
      }}
    >
      <div
        role="group"
        aria-label={copy.filters}
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 2,
          padding: 2,
          borderRadius: orbitRadius.pill,
          backgroundColor: orbitColors.bg.surfaceSubtle,
        }}
      >
        {views.map(([key, label]) => {
          const active = filter === key;
          return (
            <OrbitButton
              key={key}
              variant={active ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={active}
              onClick={() => onFilter(key)}
              style={{
                height: 26,
                paddingInline: orbitSpacing[2],
                fontSize: orbitTypography.fontSize.xs,
                fontWeight: active ? orbitTypography.fontWeight.semibold : orbitTypography.fontWeight.medium,
                color: active ? orbitColors.text.primary : orbitColors.text.secondary,
                borderRadius: orbitRadius.pill,
                backgroundColor: active ? orbitColors.bg.surfaceRaised : "transparent",
                border: active ? `1px solid ${orbitColors.border.default}` : "1px solid transparent",
              }}
            >
              {label}
            </OrbitButton>
          );
        })}
      </div>

      <OrbitButton
        size="sm"
        variant="ghost"
        disabled={!selectedCount}
        onClick={onClear}
        style={{
          height: 26,
          paddingInline: orbitSpacing[2],
          fontSize: orbitTypography.fontSize.xs,
          color: selectedCount ? orbitColors.brand.primary : orbitColors.text.muted,
        }}
      >
        {copy.clear}
      </OrbitButton>
    </div>
  );
}

export function CandidateEmptyState({
  lang,
  phase,
  outcome,
  filteredEmpty = false,
}: {
  lang: UILang;
  phase: DetectionPhase;
  outcome?: FullPageDetectOutcome;
  filteredEmpty?: boolean;
}) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const message = filteredEmpty
    ? copy.filterEmpty
    : phase === "detecting"
      ? copy.detectingEmpty
      : phase === "failed"
        ? copy.failedEmpty
      : phase === "incomplete"
        ? outcome === "filtered_empty" ? copy.filteredCandidateEmpty
          : outcome === "postprocess_empty" ? copy.postprocessedEmpty : copy.incompleteEmpty
      : phase === "completed"
        ? copy.completedEmpty
        : copy.notStarted;

  return (
    <OrbitSurface
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: `${orbitSpacing[6]}px ${orbitSpacing[4]}px`,
        fontSize: orbitTypography.fontSize.sm,
        lineHeight: orbitTypography.lineHeight.relaxed,
        color: orbitColors.text.secondary,
        gap: orbitSpacing[3],
        borderRadius: orbitRadius.lg,
        border: `1px dashed ${orbitColors.border.default}`,
        backgroundColor: orbitColors.bg.surfaceSubtle,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: orbitRadius.pill,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: orbitColors.bg.surfaceRaised,
          color: orbitColors.brand.primary,
          border: `1px solid ${orbitColors.border.subtle}`,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          {phase === "detecting" && <line x1="11" y1="8" x2="11" y2="14" />}
        </svg>
      </div>
      <div style={{ maxWidth: 280 }}>
        {message}
      </div>
    </OrbitSurface>
  );
}

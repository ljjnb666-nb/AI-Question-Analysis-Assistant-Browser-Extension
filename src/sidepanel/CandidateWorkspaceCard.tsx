import React from "react";
import type { DetectedCandidate } from "@/shared/types";
import { OrbitBadge, OrbitButton, OrbitSurface } from "@/shared/ui/orbitPrimitives";
import { useFocusVisible } from "@/shared/ui/orbitFocus";
import { orbitColors, orbitFocus, orbitRadius, orbitSpacing, orbitTypography } from "@/shared/ui/orbitTokens";
import { CandidateQuestionContent, CANDIDATE_TEXT_STYLE } from "./candidateWorkspaceContent";
import { CandidateAnswerSection } from "./candidateWorkspaceAnswer";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";
import { deriveCandidatePresentation } from "./candidatePresentation";
import type { UILang } from "./displayUtils";

function CandidateSelection({
  checked,
  index,
  lang,
  onToggle,
}: {
  checked: boolean;
  index: number;
  lang: UILang;
  onToggle: () => void;
}) {
  const focus = useFocusVisible();
  const copy = CANDIDATE_WORKSPACE_COPY[lang];

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: orbitSpacing[2],
        cursor: "pointer",
        minHeight: 28,
        userSelect: "none",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        aria-label={copy.select(index)}
        onChange={onToggle}
        onFocus={focus.onFocus}
        onBlur={focus.onBlur}
        style={{
          margin: 0,
          width: 16,
          height: 16,
          accentColor: orbitColors.brand.primary,
          cursor: "pointer",
          outline: focus.isFocusVisible ? orbitFocus.outline : "none",
          outlineOffset: orbitFocus.outlineOffset,
        }}
      />
      <strong
        style={{
          fontSize: orbitTypography.fontSize.md,
          fontWeight: orbitTypography.fontWeight.bold,
          color: checked ? orbitColors.brand.primary : orbitColors.text.primary,
          letterSpacing: 0.1,
        }}
      >
        {copy.question(index)}
      </strong>
    </label>
  );
}

export function CandidateWorkspaceCard({
  index,
  cand,
  isExpanded,
  active = false,
  onToggle,
  onFlash,
  onToggleDetails,
  onFill,
  onRetryVision,
  lang,
}: {
  index: number;
  cand: DetectedCandidate;
  isExpanded: boolean;
  active?: boolean;
  lang: UILang;
  onToggle: () => void;
  onFlash: () => void;
  onToggleDetails: () => void;
  onFill: () => void;
  onRetryVision: () => void;
}) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const presentation = deriveCandidatePresentation(cand, lang, active);

  const border = active
    ? `1px solid ${orbitColors.ai.border}`
    : cand.selected
      ? `1px solid ${orbitColors.brand.border}`
      : `1px solid ${orbitColors.border.subtle}`;

  const borderLeft = active
    ? `4px solid ${orbitColors.ai.accent}`
    : cand.selected
      ? `4px solid ${orbitColors.brand.primary}`
      : `4px solid transparent`;

  const background = active
    ? orbitColors.ai.surface
    : cand.selected
      ? orbitColors.brand.subtle
      : orbitColors.bg.surface;

  const boxShadow = active
    ? "0 0 16px rgba(139, 92, 246, 0.16), 0 2px 8px rgba(0, 0, 0, 0.3)"
    : cand.selected
      ? "0 2px 8px rgba(37, 99, 235, 0.12)"
      : "0 1px 3px rgba(0, 0, 0, 0.25)";

  return (
    <OrbitSurface
      role="article"
      aria-label={copy.question(index)}
      data-candidate-id={cand.block.id}
      data-candidate-status={presentation.status}
      data-active={active || undefined}
      style={{
        minWidth: 0,
        padding: orbitSpacing[3],
        display: "grid",
        gap: orbitSpacing[3],
        borderRadius: orbitRadius.md,
        border,
        borderLeft,
        background,
        boxShadow,
        transition: "border-color 160ms ease, background 160ms ease, box-shadow 160ms ease",
      }}
    >
      {/* Header: Checkbox Title + Status Badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: orbitSpacing[2],
          borderBottom: `1px solid ${orbitColors.border.subtle}`,
          paddingBottom: orbitSpacing[2],
        }}
      >
        <CandidateSelection
          checked={cand.selected}
          index={index}
          lang={lang}
          onToggle={onToggle}
        />
        <OrbitBadge variant={presentation.tone} dot>
          {presentation.label}
        </OrbitBadge>
      </div>

      {/* Question Content: Stem, Media, Options */}
      <CandidateQuestionContent block={cand.block} lang={lang} />

      {/* Review Alert Notice */}
      {presentation.reasons.length > 0 && (
        <div
          style={{
            ...CANDIDATE_TEXT_STYLE,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: `${orbitSpacing[2]}px ${orbitSpacing[3]}px`,
            borderRadius: orbitRadius.sm,
            backgroundColor: orbitColors.semantic.warningSurface,
            border: `1px solid ${orbitColors.semantic.warningBorder}`,
            color: orbitColors.semantic.warning,
            fontSize: orbitTypography.fontSize.xs,
          }}
        >
          {presentation.reasons.map(reason => (
            <p key={reason} style={{ margin: 0, lineHeight: 1.4 }}>
              {reason}
            </p>
          ))}
        </div>
      )}

      {/* Safe Error Notice */}
      {presentation.errorFeedback && (
        <div
          data-error-tone={presentation.errorFeedback.tone}
          style={{
            ...CANDIDATE_TEXT_STYLE,
            padding: `${orbitSpacing[2]}px ${orbitSpacing[3]}px`,
            borderRadius: orbitRadius.sm,
            backgroundColor: orbitColors.semantic.errorSurface,
            border: `1px solid ${orbitColors.semantic.errorBorder}`,
            color: orbitColors.semantic.error,
            fontSize: orbitTypography.fontSize.xs,
            lineHeight: 1.4,
          }}
        >
          {presentation.errorFeedback.message}
        </div>
      )}

      {/* Answer & Explanation Section */}
      <CandidateAnswerSection
        candidate={cand}
        lang={lang}
        expanded={isExpanded}
        onToggleDetails={onToggleDetails}
        onFill={onFill}
        onRetryVision={onRetryVision}
      />

      {/* Card Utility Action Bar: Locate + Error Retry */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: orbitSpacing[2],
          paddingTop: orbitSpacing[1],
        }}
      >
        <OrbitButton
          variant="ghost"
          size="sm"
          onClick={onFlash}
          style={{
            height: 26,
            paddingInline: orbitSpacing[2],
            fontSize: orbitTypography.fontSize.xs,
            color: orbitColors.text.secondary,
          }}
        >
          {copy.locate}
        </OrbitButton>
        {cand.status === "error" && (
          <OrbitButton
            variant="secondary"
            size="sm"
            onClick={onRetryVision}
            style={{
              height: 26,
              paddingInline: orbitSpacing[2],
              fontSize: orbitTypography.fontSize.xs,
            }}
          >
            {copy.retryVision}
          </OrbitButton>
        )}
      </div>
    </OrbitSurface>
  );
}

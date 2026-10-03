import type { UILang } from "./displayUtils";
import type { AutoSolveProgressState, ScanProgressState } from "./sidepanelStateSync";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import { autoSolveStatusFeedback } from "@/shared/ui/autoSolveStatus";
import { SIDEPANEL_COPY } from "./sidePanelCopy";

export type SidePanelWorkspaceStatus =
  | "checking_session"
  | "signed_out"
  | "service_unavailable"
  | "ready"
  | "detecting"
  | "scanning"
  | "solving"
  | "review_required";

export interface WorkspaceStatusDerivationInput {
  authStatus: "loading" | "validating" | "authenticated" | "unauthenticated" | "server_unavailable";
  isAuthenticated: boolean;
  isDetecting: boolean;
  isFullPageScan: boolean;
  isAutoSolving: boolean;
  isBatchParsing?: boolean;
  isBatchFilling?: boolean;
  autoSolveProgress: AutoSolveProgressState;
  fillFeedback: UserFeedback | null;
}


export const WORKSPACE_REVIEW_REQUIRED_FEEDBACK_CODES = new Set([
  "STALE_QUESTION_REVISION",
  "STALE_ROOT_CONTEXT",
  "STALE_ACTION_PLAN",
  "PARTIAL_MUTATION_UNPROVABLE",
  "FILL_VERIFICATION_FAILED",
  "USER_STATE_CHANGED",
  "USER_STATE_SNAPSHOT_UNAVAILABLE",
]);

export function isWorkspaceReviewRequired(
  autoSolveProgress: AutoSolveProgressState | undefined,
  fillFeedback: UserFeedback | null | undefined,
  _isAutoSolving?: boolean,
): boolean {
  if (autoSolveProgress?.statusCode === "FILL_STOPPED_SAFETY") {
    return true;
  }
  if (fillFeedback?.code && WORKSPACE_REVIEW_REQUIRED_FEEDBACK_CODES.has(fillFeedback.code)) {
    return true;
  }
  return false;
}

export function deriveSidePanelWorkspaceStatus(input: WorkspaceStatusDerivationInput): SidePanelWorkspaceStatus {
  // Priority 1: SESSION CHECKING
  if (input.authStatus === "loading" || input.authStatus === "validating") {
    return "checking_session";
  }

  // Priority 2: SERVER UNAVAILABLE
  if (input.authStatus === "server_unavailable") {
    return "service_unavailable";
  }

  // Priority 3: SIGNED OUT
  if (!input.isAuthenticated || input.authStatus === "unauthenticated") {
    return "signed_out";
  }

  // Priority 4: SAFETY / REVIEW (Code-based, NEVER tone-based)
  if (isWorkspaceReviewRequired(input.autoSolveProgress, input.fillFeedback, input.isAutoSolving)) {
    return "review_required";
  }

  // Priority 5: SOLVING (Auto Solve, Batch Parse, or Batch Fill)
  if (input.isAutoSolving || input.isBatchParsing || input.isBatchFilling) {
    return "solving";
  }

  // Priority 6: SCANNING
  if (input.isFullPageScan) {
    return "scanning";
  }

  // Priority 7: DETECTING
  if (input.isDetecting) {
    return "detecting";
  }

  // Priority 8: READY
  return "ready";
}

export type WorkspaceActivityKind =
  | "detecting"
  | "scanning"
  | "auto_solve"
  | "batch_parse"
  | "batch_fill"
  | "review";

export interface WorkspaceActivityAction {
  label: string;
  onAction: () => void;
}

export interface WorkspaceActivity {
  kind: WorkspaceActivityKind;
  tone: "info" | "ai" | "warning" | "error";
  label: string;
  secondary?: string;
  progress?: number;
  current?: number;
  total?: number;
  filled?: number;
  action?: WorkspaceActivityAction;
}

export interface WorkspaceActivityDerivationInput {
  status: SidePanelWorkspaceStatus;
  lang: UILang;
  isDetecting: boolean;
  isFullPageScan: boolean;
  scanProgress: ScanProgressState;
  isAutoSolving: boolean;
  isBatchParsing?: boolean;
  isBatchFilling?: boolean;
  autoSolveProgress: AutoSolveProgressState;
  fillFeedback: UserFeedback | null;
  currentTab?: "candidates" | "history" | "settings";
  onCancelFullPage?: () => void;
  onStopAutoSolve?: () => void;
  onReviewCandidates?: () => void;
  onDismissFeedback?: () => void;
}

export function deriveWorkspaceActivity(input: WorkspaceActivityDerivationInput): WorkspaceActivity | null {
  const {
    status,
    lang,
    isDetecting,
    isFullPageScan,
    scanProgress,
    isAutoSolving,
    isBatchParsing,
    isBatchFilling,
    autoSolveProgress,
    fillFeedback,
    currentTab,
    onCancelFullPage,
    onStopAutoSolve,
    onReviewCandidates,
    onDismissFeedback,
  } = input;
  const copy = SIDEPANEL_COPY[lang];

  // UI03-A04: Safety status / review required
  if (status === "review_required") {
    let message: string;
    let tone: "warning" | "error" = "warning";
    let action: WorkspaceActivityAction | undefined = undefined;

    const isAutoSolveSafety = autoSolveProgress?.statusCode === "FILL_STOPPED_SAFETY";

    if (isAutoSolveSafety) {
      const fb = autoSolveStatusFeedback("FILL_STOPPED_SAFETY", lang, {
        current: autoSolveProgress?.current,
        detail: autoSolveProgress?.statusDetail,
      });
      message = fb.label;
      tone = "error";

      // RF01-R06 / RF01-R07: Auto solve safety review gives review action, NEVER fake dismiss
      if (currentTab !== "candidates" && onReviewCandidates) {
        action = {
          label: copy.activity.check,
          onAction: onReviewCandidates,
        };
      }
    } else if (fillFeedback?.code && WORKSPACE_REVIEW_REQUIRED_FEEDBACK_CODES.has(fillFeedback.code)) {
      message = fillFeedback.message;
      tone = fillFeedback.tone === "error" ? "error" : "warning";

      // RF01-R08: Transient fillFeedback can be dismissed to clear
      if (onDismissFeedback) {
        action = {
          label: copy.activity.dismiss,
          onAction: onDismissFeedback,
        };
      }
    } else {
      message = copy.activity.reviewFallback;
    }

    return {
      kind: "review",
      tone,
      label: copy.status.review_required,
      secondary: message,
      action,
    };
  }

  // Priority 5: Solving / Auto Solve / Batch Parse / Batch Fill
  if (status === "solving" || isAutoSolving || isBatchParsing || isBatchFilling) {
    if (isAutoSolving) {
      let secondary = "";
      if (autoSolveProgress && autoSolveProgress.total > 0) {
        secondary = copy.activity.solvingProgress(
          autoSolveProgress.current,
          autoSolveProgress.total,
          autoSolveProgress.filled,
        );
      }
      return {
        kind: "auto_solve",
        tone: "ai",
        label: copy.activity.solving,
        secondary: secondary || undefined,
        current: autoSolveProgress?.current,
        total: autoSolveProgress?.total,
        filled: autoSolveProgress?.filled,
        action: onStopAutoSolve
          ? {
              label: copy.activity.stop,
              onAction: onStopAutoSolve,
            }
          : undefined,
      };
    }

    if (isBatchParsing) {
      return {
        kind: "batch_parse",
        tone: "ai",
        label: copy.activity.batchParse,
        action: undefined, // RF01-A02: no cancel mechanism, no Stop action
      };
    }

    if (isBatchFilling) {
      return {
        kind: "batch_fill",
        tone: "ai",
        label: copy.activity.batchFill,
        action: undefined, // RF01-A03: no cancel mechanism, no Stop action
      };
    }
  }

  // Priority 6: Scanning
  if (status === "scanning" || isFullPageScan) {
    let secondary = "";
    if (scanProgress && scanProgress.total > 0) {
      secondary = copy.activity.scanningProgress(
        scanProgress.step,
        scanProgress.total,
        scanProgress.found,
      );
    }
    return {
      kind: "scanning",
      tone: "info",
      label: copy.activity.scanning,
      secondary: secondary || undefined,
      progress: scanProgress?.progress,
      action: onCancelFullPage
        ? {
            label: copy.activity.stop,
            onAction: onCancelFullPage,
          }
        : undefined,
    };
  }

  // Priority 7: Detecting
  if (status === "detecting" || isDetecting) {
    return {
      kind: "detecting",
      tone: "info",
      label: copy.activity.detecting,
    };
  }

  // UI03-A05: Idle state -> activity strip absent
  return null;
}

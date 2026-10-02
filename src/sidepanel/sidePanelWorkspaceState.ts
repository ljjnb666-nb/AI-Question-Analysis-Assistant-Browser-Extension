import type { UILang } from "./displayUtils";
import type { AutoSolveProgressState, ScanProgressState } from "./sidepanelStateSync";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import { autoSolveStatusFeedback, autoSolveStatusTone } from "@/shared/ui/autoSolveStatus";
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

  // Priority 4: SAFETY / REVIEW
  const hasSafetyTone =
    (input.autoSolveProgress?.statusCode != null &&
      (autoSolveStatusTone(input.autoSolveProgress.statusCode) === "error" ||
        autoSolveStatusTone(input.autoSolveProgress.statusCode) === "warning")) ||
    (input.fillFeedback != null &&
      (input.fillFeedback.tone === "error" || input.fillFeedback.tone === "warning"));

  if (hasSafetyTone) {
    return "review_required";
  }

  // Priority 5: SOLVING
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

export type WorkspaceActivityKind = "detecting" | "scanning" | "solving" | "review";

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
  autoSolveProgress: AutoSolveProgressState;
  fillFeedback: UserFeedback | null;
  onCancelFullPage?: () => void;
  onStopAutoSolve?: () => void;
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
    autoSolveProgress,
    fillFeedback,
    onCancelFullPage,
    onStopAutoSolve,
    onDismissFeedback,
  } = input;
  const copy = SIDEPANEL_COPY[lang];

  // UI03-A04: Safety status / review required
  if (status === "review_required") {
    let message: string;
    let tone: "warning" | "error" = "warning";

    if (autoSolveProgress?.statusCode) {
      const fb = autoSolveStatusFeedback(autoSolveProgress.statusCode, lang, {
        current: autoSolveProgress.current,
        detail: autoSolveProgress.statusDetail,
      });
      message = fb.label;
      tone = autoSolveStatusTone(autoSolveProgress.statusCode) === "error" ? "error" : "warning";
    } else if (fillFeedback) {
      message = fillFeedback.message;
      tone = fillFeedback.tone === "error" ? "error" : "warning";
    } else {
      message = copy.activity.reviewFallback;
    }

    return {
      kind: "review",
      tone,
      label: copy.status.review_required,
      secondary: message,
      action: onDismissFeedback
        ? {
            label: copy.activity.dismiss,
            onAction: onDismissFeedback,
          }
        : undefined,
    };
  }

  // Priority 5: Solving
  if (status === "solving" || isAutoSolving) {
    let secondary = "";
    if (autoSolveProgress && autoSolveProgress.total > 0) {
      secondary = copy.activity.solvingProgress(
        autoSolveProgress.current,
        autoSolveProgress.total,
        autoSolveProgress.filled,
      );
    }
    return {
      kind: "solving",
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

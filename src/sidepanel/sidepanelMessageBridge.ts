import type { CandidateOrigin, CandidateSnapshot, DetectedCandidate, QuestionBlock } from "@/shared/types";
import { mapAutoSolveDoneFeedback } from "@/shared/ui/autoSolveStatus";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import {
  clearProtectedWorkOwnerFromRuntimeDone,
  hasConflictingProtectedWorkUiOwner,
  isProtectedWorkRuntimeUiMessageCurrent,
  reconcileProtectedWorkOwnerFromRuntime,
} from "@/shared/auth/protectedWorkOwner";
import type { ProtectedWorkKind } from "@/shared/auth/protectedWorkOwner";
import type { AutoSolveProgressState, ScanProgressState } from "./sidepanelStateSync";
import {
  mapAutoSolveProgressMessage,
  mapFullPageDoneCandidates,
  mapFullPageProgressMessage,
  mergeCandidateSnapshots,
} from "./sidepanelStateSync";

type StorageChangeMap = { [key: string]: chrome.storage.StorageChange };

export type SidePanelRuntimeHandlers = {
  /** Workspace rendering is snapshot-authoritative; feedback is origin bound. */
  renderWorkspace?: boolean;
  getFeedbackOrigin?: () => CandidateOrigin | undefined;
  loadLanguage: () => Promise<"zh" | "en">;
  setUiLang: (lang: "zh" | "en") => void;
  setCandidates: React.Dispatch<React.SetStateAction<DetectedCandidate[]>>;
  setIsDetecting: (next: boolean) => void;
  setIsFullPageScan: (next: boolean) => void;
  setScanProgress: (next: ScanProgressState) => void;
  setExpandedIds: (next: Record<string, boolean>) => void;
  setIsAutoSolving: (next: boolean) => void;
  setAutoSolveProgress: (next: AutoSolveProgressState) => void;
  setFillFeedback: (next: UserFeedback | null) => void;
};

export function registerSidePanelRuntimeListeners(handlers: SidePanelRuntimeHandlers): () => void {
  let disposed = false;
  // Preserve onMessage arrival order despite async chrome.storage reads and
  // localization. Per-kind ordering prevents a late PROGRESS from overriding
  // DONE while allowing Auto Solve and Full Page to proceed independently.
  const queue = new Map<ProtectedWorkKind, Promise<void>>();
  // A tagged DONE conclusively closes the previous protocol generation for
  // this panel session. A later untagged PROGRESS must not resurrect a ghost
  // legacy owner after the tagged run's exact key was cleaned up.
  const completedTagged = new Set<string>();
  const workKey = (kind: ProtectedWorkKind, tabId: number) => `${kind}:${tabId}`;
  let feedbackSequence = 0;
  void handlers.loadLanguage().then((lang) => { if (!disposed) handlers.setUiLang(lang); });

  const onChanged = (changes: StorageChangeMap, areaName: string) => {
    if (areaName !== "local" || !changes.appSettings?.newValue) return;
    const maybeLang = (changes.appSettings.newValue as { language?: "zh" | "en" }).language;
    if (maybeLang === "zh" || maybeLang === "en") handlers.setUiLang(maybeLang);
  };

  const onMessage = (msg: Record<string, unknown>, sender: chrome.runtime.MessageSender) => {
    const origin = sender.tab?.id && sender.tab.url
      ? { tabId: sender.tab.id, url: sender.tab.url }
      : undefined;
    const workspaceRendered = handlers.renderWorkspace !== false;
    const matchesOrigin = () => {
      if (disposed) return false;
      const bound = handlers.getFeedbackOrigin?.();
      return (handlers.getFeedbackOrigin === undefined && workspaceRendered) || (bound !== undefined
        && origin !== undefined && bound.tabId === origin.tabId && bound.url === origin.url
        && (sender.frameId === undefined || sender.frameId === 0));
    };
    const queueByKind = (kind: ProtectedWorkKind, effect: () => Promise<void>) => {
      const previous = queue.get(kind) ?? Promise.resolve();
      const next = previous.then(effect).catch((error) => {
        console.warn("[SidePanel] protected-work runtime message failed:", error);
      });
      queue.set(kind, next);
    };

    if (msg.type === "AUTO_DETECT_RESULT_READY") {
      if (!workspaceRendered || !matchesOrigin()) return;
      const snapshots = (msg.candidates as CandidateSnapshot[]) ?? [];
      handlers.setCandidates((prev) => mergeCandidateSnapshots(prev, snapshots, origin));
      handlers.setIsDetecting(false);
      return;
    }

    if (msg.type === "FULL_PAGE_DETECT_PROGRESS" || msg.type === "FULL_PAGE_DETECT_DONE") {
      const done = msg.type === "FULL_PAGE_DETECT_DONE";
      queueByKind("fullPage", async () => {
        if (disposed) return;
        if (!done && msg.generationId === undefined && origin
          && completedTagged.has(workKey("fullPage", origin.tabId))) return;
        const allowed = origin !== undefined
          && await isProtectedWorkRuntimeUiMessageCurrent("fullPage", origin.tabId, msg.generationId);
        // Legacy recovery remains untagged only; tagged updates cannot
        // resurrect a legacy owner once their exact run has completed.
        if (!done && msg.generationId === undefined && origin
          && allowed) {
          await reconcileProtectedWorkOwnerFromRuntime("fullPage", origin.tabId);
        }
        if (done && origin) {
          await clearProtectedWorkOwnerFromRuntimeDone("fullPage", origin.tabId, msg.generationId);
          if (allowed && msg.generationId !== undefined) {
            completedTagged.add(workKey("fullPage", origin.tabId));
          }
        }
        if (!workspaceRendered || !allowed || !matchesOrigin()) return;
        if (!done) {
          handlers.setIsFullPageScan(true);
          handlers.setScanProgress(mapFullPageProgressMessage(msg));
          return;
        }
        if (await hasConflictingProtectedWorkUiOwner("fullPage", origin!.tabId, msg.generationId)) return;
        if (!matchesOrigin()) return;
        handlers.setIsFullPageScan(false);
        handlers.setScanProgress(null);
        handlers.setCandidates(mapFullPageDoneCandidates((msg.candidates as QuestionBlock[]) ?? [], origin));
        handlers.setExpandedIds({});
      });
      return;
    }

    if (msg.type === "AUTO_SOLVE_PROGRESS" || msg.type === "AUTO_SOLVE_DONE") {
      const done = msg.type === "AUTO_SOLVE_DONE";
      const feedbackToken = done ? ++feedbackSequence : feedbackSequence;
      queueByKind("autoSolve", async () => {
        if (disposed) return;
        if (!done && msg.generationId === undefined && origin
          && completedTagged.has(workKey("autoSolve", origin.tabId))) return;
        const allowed = origin !== undefined
          && await isProtectedWorkRuntimeUiMessageCurrent("autoSolve", origin.tabId, msg.generationId);
        if (!done && msg.running && msg.generationId === undefined && origin
          && allowed) {
          await reconcileProtectedWorkOwnerFromRuntime("autoSolve", origin.tabId);
        }
        if (done && origin) {
          await clearProtectedWorkOwnerFromRuntimeDone("autoSolve", origin.tabId, msg.generationId);
          if (allowed && msg.generationId !== undefined) {
            completedTagged.add(workKey("autoSolve", origin.tabId));
          }
        }
        if (!allowed || !matchesOrigin()) return;
        if (!done) {
          if (!workspaceRendered) return;
          handlers.setIsAutoSolving(Boolean(msg.running));
          handlers.setAutoSolveProgress(mapAutoSolveProgressMessage(msg));
          return;
        }
        if (workspaceRendered) {
          if (await hasConflictingProtectedWorkUiOwner("autoSolve", origin!.tabId, msg.generationId)) return;
          if (!matchesOrigin()) return;
          handlers.setIsAutoSolving(false);
          handlers.setAutoSolveProgress(null);
        }
        const lang = await handlers.loadLanguage();
        if (feedbackToken !== feedbackSequence || !matchesOrigin()) return;
        if (await hasConflictingProtectedWorkUiOwner("autoSolve", origin!.tabId, msg.generationId)) return;
        if (feedbackToken !== feedbackSequence || !matchesOrigin()) return;
        handlers.setFillFeedback(mapAutoSolveDoneFeedback(msg, lang));
        if (workspaceRendered) {
          window.setTimeout(() => {
            if (!disposed && feedbackToken === feedbackSequence) handlers.setFillFeedback(null);
          }, 3200);
        }
      });
    }
  };

  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onChanged);
  return () => {
    disposed = true;
    feedbackSequence++;
    chrome.runtime.onMessage.removeListener(onMessage);
    chrome.storage.onChanged.removeListener(onChanged);
  };
}

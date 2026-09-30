import type { CandidateSnapshot, DetectedCandidate, QuestionBlock } from "@/shared/types";
import {
  clearProtectedWorkOwner,
  reconcileProtectedWorkOwnerFromRuntime,
} from "@/shared/auth/protectedWorkOwner";
import type { AutoSolveProgressState, ScanProgressState } from "./sidepanelStateSync";
import {
  mapAutoSolveDoneFeedback,
  mapAutoSolveProgressMessage,
  mapFullPageDoneCandidates,
  mapFullPageProgressMessage,
  mergeCandidateSnapshots,
} from "./sidepanelStateSync";

type StorageChangeMap = { [key: string]: chrome.storage.StorageChange };

export type SidePanelRuntimeHandlers = {
  loadLanguage: () => Promise<"zh" | "en">;
  setUiLang: (lang: "zh" | "en") => void;
  setCandidates: React.Dispatch<React.SetStateAction<DetectedCandidate[]>>;
  setIsDetecting: (next: boolean) => void;
  setIsFullPageScan: (next: boolean) => void;
  setScanProgress: (next: ScanProgressState) => void;
  setExpandedIds: (next: Record<string, boolean>) => void;
  setIsAutoSolving: (next: boolean) => void;
  setAutoSolveProgress: (next: AutoSolveProgressState) => void;
  setFillFeedback: (next: string) => void;
};

export function registerSidePanelRuntimeListeners(handlers: SidePanelRuntimeHandlers): () => void {
  void handlers.loadLanguage().then(handlers.setUiLang);

  const onChanged = (changes: StorageChangeMap, areaName: string) => {
    if (areaName !== "local" || !changes.appSettings?.newValue) return;
    const maybeLang = (changes.appSettings.newValue as { language?: "zh" | "en" }).language;
    if (maybeLang === "zh" || maybeLang === "en") handlers.setUiLang(maybeLang);
  };

  const onMessage = (msg: Record<string, unknown>, sender: chrome.runtime.MessageSender) => {
    const origin = sender.tab?.id && sender.tab.url
      ? { tabId: sender.tab.id, url: sender.tab.url }
      : undefined;
    if (msg.type === "AUTO_DETECT_RESULT_READY") {
      const snapshots = (msg.candidates as CandidateSnapshot[]) ?? [];
      handlers.setCandidates((prev) => mergeCandidateSnapshots(prev, snapshots, origin));
      handlers.setIsDetecting(false);
    }
    if (msg.type === "FULL_PAGE_DETECT_PROGRESS") {
      // AUTH-UI-INV-15 reconciliation: a running full-page scan reported by
      // its own tab claims the cross-surface owner record, recovering any
      // START whose owner mark was missed. This is a recovery path only —
      // the START itself must still establish the owner first.
      if (origin?.tabId != null) {
        void reconcileProtectedWorkOwnerFromRuntime("fullPage", origin.tabId);
      }
      handlers.setIsFullPageScan(true);
      handlers.setScanProgress(mapFullPageProgressMessage(msg));
    }
    if (msg.type === "FULL_PAGE_DETECT_DONE") {
      // Natural completion: clear the owner so a later auth loss never sends
      // a stale CANCEL at the finished tab.
      if (origin?.tabId != null) {
        void clearProtectedWorkOwner("fullPage", origin.tabId);
      }
      handlers.setIsFullPageScan(false);
      handlers.setScanProgress(null);
      const blocks = (msg.candidates as QuestionBlock[]) ?? [];
      handlers.setCandidates(mapFullPageDoneCandidates(blocks, origin));
      handlers.setExpandedIds({});
    }
    if (msg.type === "AUTO_SOLVE_PROGRESS") {
      const running = Boolean(msg.running);
      // Reconciliation for the auto-solve owner, same contract as above.
      if (running && origin?.tabId != null) {
        void reconcileProtectedWorkOwnerFromRuntime("autoSolve", origin.tabId);
      }
      handlers.setIsAutoSolving(running);
      handlers.setAutoSolveProgress(mapAutoSolveProgressMessage(msg));
    }
    if (msg.type === "AUTO_SOLVE_DONE") {
      if (origin?.tabId != null) {
        void clearProtectedWorkOwner("autoSolve", origin.tabId);
      }
      handlers.setIsAutoSolving(false);
      handlers.setAutoSolveProgress(null);
      handlers.setFillFeedback(mapAutoSolveDoneFeedback(msg));
      window.setTimeout(() => handlers.setFillFeedback(""), 3200);
    }
  };

  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onChanged);
  return () => {
    chrome.runtime.onMessage.removeListener(onMessage);
    chrome.storage.onChanged.removeListener(onChanged);
  };
}

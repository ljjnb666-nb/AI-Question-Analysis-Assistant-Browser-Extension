import type { CandidateSnapshot, DetectedCandidate, QuestionBlock } from "@/shared/types";
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

  const onMessage = (msg: Record<string, unknown>) => {
    if (msg.type === "AUTO_DETECT_RESULT_READY") {
      const snapshots = (msg.candidates as CandidateSnapshot[]) ?? [];
      handlers.setCandidates((prev) => mergeCandidateSnapshots(prev, snapshots));
      handlers.setIsDetecting(false);
    }
    if (msg.type === "FULL_PAGE_DETECT_PROGRESS") {
      handlers.setIsFullPageScan(true);
      handlers.setScanProgress(mapFullPageProgressMessage(msg));
    }
    if (msg.type === "FULL_PAGE_DETECT_DONE") {
      handlers.setIsFullPageScan(false);
      handlers.setScanProgress(null);
      const blocks = (msg.candidates as QuestionBlock[]) ?? [];
      handlers.setCandidates(mapFullPageDoneCandidates(blocks));
      handlers.setExpandedIds({});
    }
    if (msg.type === "AUTO_SOLVE_PROGRESS") {
      handlers.setIsAutoSolving(Boolean(msg.running));
      handlers.setAutoSolveProgress(mapAutoSolveProgressMessage(msg));
    }
    if (msg.type === "AUTO_SOLVE_DONE") {
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

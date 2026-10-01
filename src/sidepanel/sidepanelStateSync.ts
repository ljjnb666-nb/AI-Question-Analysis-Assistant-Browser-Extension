import type { CandidateOrigin, CandidateSnapshot, DetectedCandidate, QuestionBlock } from "@/shared/types";
import type { UILang } from "./displayUtils";
import { sameCandidateResultContext } from "./candidateAuthority";

export type ScanProgressState = { progress: number; found: number; step: number; total: number } | null;

export type AutoSolveProgressState = {
  solved: number;
  filled: number;
  total: number;
  current: number;
  statusText: string;
  /** UI-00B: stable status code; user copy is localized from this. */
  statusCode?: string;
  /** Stable sub-code behind the status (e.g. a fill result code). */
  statusDetail?: string;
  currentPreview?: string;
  currentBlock?: QuestionBlock;
} | null;

export function mergeCandidateSnapshots(
  prev: DetectedCandidate[],
  snapshots: CandidateSnapshot[],
  origin?: CandidateOrigin,
): DetectedCandidate[] {
  const prevById = new Map(prev.map((candidate) => [candidate.block.id, candidate] as const));
  return snapshots.map((snapshot) => {
    const old = prevById.get(snapshot.block.id);
    const contextMatches = old ? sameCandidateResultContext(old, { block: snapshot.block, origin }) : false;
    return {
      block: snapshot.block,
      origin,
      selected: snapshot.selected,
      status: contextMatches ? snapshot.status ?? old?.status ?? "idle" : snapshot.status === "loading" ? "loading" : "idle",
      result: contextMatches ? old?.result : undefined,
      error: contextMatches ? old?.error : undefined,
      debugInfo: contextMatches ? old?.debugInfo : undefined,
    };
  });
}

export function mapFullPageDoneCandidates(blocks: QuestionBlock[], origin?: CandidateOrigin): DetectedCandidate[] {
  return blocks.map((block) => ({ block, origin, selected: false, status: "idle" as const }));
}

export function mapFullPageProgressMessage(msg: Record<string, unknown>) {
  return {
    progress: (msg.progress as number) ?? 0,
    found: (msg.found as number) ?? 0,
    step: (msg.currentStep as number) ?? 0,
    total: (msg.totalScrollSteps as number) ?? 1,
  };
}

export function mapAutoSolveProgressMessage(msg: Record<string, unknown>) {
  return {
    solved: Number(msg.solved ?? 0),
    filled: Number(msg.filled ?? 0),
    total: Number(msg.total ?? 0),
    current: Number(msg.current ?? 0),
    statusText: String(msg.statusText ?? ""),
    // UI-00B: stable status code + detail; the UI localizes from these and
    // only falls back to statusText for legacy payloads.
    statusCode: typeof msg.statusCode === "string" ? msg.statusCode : "",
    statusDetail: typeof msg.statusDetail === "string" ? msg.statusDetail : "",
    currentPreview: typeof msg.currentPreview === "string" ? msg.currentPreview : "",
    currentBlock: (msg.currentBlock as QuestionBlock | undefined) ?? undefined,
  };
}

export function buildAutoSolveStartingState(uiLang: UILang) {
  return {
    solved: 0,
    filled: 0,
    total: 0,
    current: 0,
    statusText: uiLang === "en" ? "Starting auto solve..." : "开始自动答题...",
    statusCode: "STARTING",
    statusDetail: "",
  };
}

export function resetDetectState() {
  return {
    isDetecting: true,
    isFullPageScan: false,
    scanProgress: null as ScanProgressState,
    candidates: [] as DetectedCandidate[],
    expandedIds: {} as Record<string, boolean>,
  };
}

export function startFullPageDetectState() {
  return {
    isDetecting: false,
    candidates: [] as DetectedCandidate[],
    expandedIds: {} as Record<string, boolean>,
    scanProgress: { progress: 0, found: 0, step: 0, total: 1 },
  };
}

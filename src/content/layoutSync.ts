import type { BoundingBox, ExtMessage, QuestionBlock, QuestionType } from "@/shared/types";
import type { ScanScrollRoot } from "./detector/fullPageDetector";

type CandidateStatus = { status: string; selected: boolean };

type ApplySelectionUpdateDeps = {
  candidateStatusMap: Map<string, CandidateStatus>;
  activeHighlightBlocks: QuestionBlock[];
  activeCandidates: QuestionBlock[];
  highlightLayer: { setBlocks: (blocks: QuestionBlock[], candidateStatusMap: Map<string, CandidateStatus>) => void } | null;
  notifySidePanel: (candidates: QuestionBlock[]) => void;
};

type RefreshViewportDeps = {
  activeDetectMode: "viewport" | "fullpage" | null;
  highlightLayer: { setBlocks: (blocks: QuestionBlock[], candidateStatusMap: Map<string, CandidateStatus>) => void } | null;
  activeCandidates: QuestionBlock[];
  detectCandidatesInViewport: () => QuestionBlock[];
  findMatchingCandidate: (candidates: QuestionBlock[], target: QuestionBlock) => QuestionBlock | null;
  candidateStatusMap: Map<string, CandidateStatus>;
  notifySidePanel: (candidates: QuestionBlock[]) => void;
};

type FullPageRemapDeps = {
  isExtensionUiElement: (el: Element) => boolean;
  extractRichQuestionPreviewFromElement: (node: Element) => string;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  getAutoSolveTextFingerprint: (text: string) => string;
  inferAutoSolveQuestionType: (text: string) => QuestionType;
  projectViewportBboxToAbsolute: (bbox: BoundingBox, scrollRoot: ScanScrollRoot) => BoundingBox;
};

type RefreshFullPageDeps = FullPageRemapDeps & {
  activeDetectMode: "viewport" | "fullpage" | null;
  highlightLayer: { setBlocks: (blocks: QuestionBlock[], candidateStatusMap: Map<string, CandidateStatus>) => void } | null;
  resolveFullPageScrollRoot: () => ScanScrollRoot;
  refreshLayoutResizeObservation: () => void;
  candidateStatusMap: Map<string, CandidateStatus>;
};

export function applySelectionUpdate(
  message: Extract<ExtMessage, { type: "UPDATE_CANDIDATE_SELECTION" }>,
  deps: ApplySelectionUpdateDeps,
): void {
  if (typeof message.selectAll === "boolean") {
    for (const state of deps.candidateStatusMap.values()) {
      state.selected = message.selectAll;
    }
  } else if (message.blockId && typeof message.selected === "boolean") {
    const state = deps.candidateStatusMap.get(message.blockId);
    if (state) {
      state.selected = message.selected;
    }
  }

  if (deps.highlightLayer && deps.activeHighlightBlocks.length > 0) {
    deps.highlightLayer.setBlocks(deps.activeHighlightBlocks, deps.candidateStatusMap);
  }
  if (deps.activeCandidates.length > 0) {
    deps.notifySidePanel(deps.activeCandidates);
  }
}

export function refreshViewportCandidatesAfterLayoutChange(
  deps: RefreshViewportDeps,
): {
  activeCandidates: QuestionBlock[];
  activeHighlightBlocks: QuestionBlock[];
} | null {
  if (deps.activeDetectMode !== "viewport") return null;
  if (!deps.highlightLayer) return null;

  const nextCandidates = deps.detectCandidatesInViewport();
  if (nextCandidates.length === 0) return null;

  const previousCandidates = deps.activeCandidates;
  const nextStatusMap = new Map<string, CandidateStatus>();

  for (const next of nextCandidates) {
    const matched = deps.findMatchingCandidate(previousCandidates, next);
    if (matched) {
      nextStatusMap.set(next.id, deps.candidateStatusMap.get(matched.id) ?? { status: "pending", selected: false });
    } else {
      nextStatusMap.set(next.id, { status: "pending", selected: false });
    }
  }

  deps.candidateStatusMap.clear();
  for (const [id, state] of nextStatusMap) {
    deps.candidateStatusMap.set(id, state);
  }

  deps.highlightLayer.setBlocks(nextCandidates, deps.candidateStatusMap);
  deps.notifySidePanel(nextCandidates);

  return {
    activeCandidates: nextCandidates,
    activeHighlightBlocks: nextCandidates,
  };
}

export function refreshFullPageHighlightsAfterLayoutChange(
  activeCandidates: QuestionBlock[],
  deps: RefreshFullPageDeps,
): {
  activeCandidates: QuestionBlock[];
  activeHighlightBlocks: QuestionBlock[];
  lastFullPageLayoutKey: string;
} | null {
  if (deps.activeDetectMode !== "fullpage") return null;
  if (!deps.highlightLayer) return null;
  const scrollRoot = deps.resolveFullPageScrollRoot();
  const lastFullPageLayoutKey = getFullPageLayoutKey(scrollRoot);
  deps.refreshLayoutResizeObservation();
  const remappedBlocks = remapFullPageBlocksFromDom(activeCandidates, scrollRoot, deps);
  const nextBlocks = remappedBlocks.length === activeCandidates.length ? remappedBlocks : activeCandidates;
  deps.highlightLayer.setBlocks(nextBlocks, deps.candidateStatusMap);

  return {
    activeCandidates: nextBlocks,
    activeHighlightBlocks: nextBlocks,
    lastFullPageLayoutKey,
  };
}

export function getFullPageLayoutKey(scrollRoot: ScanScrollRoot): string {
  if (!(scrollRoot instanceof HTMLElement)) {
    return `window:${window.innerWidth}x${window.innerHeight}`;
  }

  const rect = scrollRoot.getBoundingClientRect();
  return [
    "root",
    Math.round(window.innerWidth),
    Math.round(window.innerHeight),
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ].join(":");
}

export function remapFullPageBlocksFromDom(
  blocks: QuestionBlock[],
  scrollRoot: ScanScrollRoot,
  deps: FullPageRemapDeps,
): QuestionBlock[] {
  const containerNodes = Array.from(
    document.querySelectorAll<HTMLElement>(".question-item, .questionBox, .base-question-component"),
  ).filter((el) => {
    if (!el.isConnected || deps.isExtensionUiElement(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 240 && rect.height >= 120;
  });

  const seenContainers = new Set<HTMLElement>();
  const containerRecords = containerNodes
    .filter((el) => {
      if (seenContainers.has(el)) return false;
      seenContainers.add(el);
      return true;
    })
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const viewportBox: BoundingBox = {
        x: Math.max(0, rect.left),
        y: Math.max(0, rect.top),
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
      const previewText = deps.extractRichQuestionPreviewFromElement(el);
      return {
        previewText,
        order: deps.extractAutoSolveQuestionOrder(previewText),
        fingerprint: deps.getAutoSolveTextFingerprint(previewText),
        type: deps.inferAutoSolveQuestionType(previewText),
        bbox: deps.projectViewportBboxToAbsolute(viewportBox, scrollRoot),
      };
    });

  const used = new Set<number>();
  const remapped: QuestionBlock[] = [];

  for (const block of [...blocks].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)) {
    const blockOrder = deps.extractAutoSolveQuestionOrder(block.previewText || "");
    const blockFingerprint = deps.getAutoSolveTextFingerprint(block.previewText || "");
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < containerRecords.length; i += 1) {
      if (used.has(i)) continue;
      const record = containerRecords[i];
      let score = 0;
      if (blockOrder !== null && record.order !== null && blockOrder === record.order) score += 120;
      if (blockFingerprint && record.fingerprint) {
        if (blockFingerprint === record.fingerprint) score += 120;
        else if (
          blockFingerprint.length >= 16 &&
          record.fingerprint.length >= 16 &&
          (blockFingerprint.includes(record.fingerprint) || record.fingerprint.includes(blockFingerprint))
        ) {
          score += 80;
        }
      }
      if (record.type === block.questionTypeGuess) score += 20;
      score -= Math.abs(record.bbox.y - block.bbox.y) / 12;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestScore >= 80) {
      used.add(bestIndex);
      remapped.push({
        ...block,
        bbox: containerRecords[bestIndex].bbox,
      });
      continue;
    }

    remapped.push(block);
  }

  return remapped;
}

/**
 * Full Page Detector (V2)
 * Scrolls the entire page from top to bottom, capturing question candidates
 * at each viewport position. Deduplicates across scroll positions.
 * Reports progress to the side panel via chrome.runtime.sendMessage.
 */

import type { QuestionBlock, DomCandidateDiagnostics } from "@/shared/types";
import { detectCandidatesInViewport } from "./domDetector";
import { isExtensionUiElement, isLikelyControlPanelText } from "./domDetectorShared";

// ─── Config ───────────────────────────────────────────────────────────────────

const SCROLL_STEP_PX = 600;         // maximum stride; a shorter scroll viewport must never be skipped
const SCROLL_PAUSE_MS = 300;        // wait after each scroll for content to render
const MAX_SCROLL_STEPS = 200;       // safety cap (~120,000px page max)
const OVERLAP_RATIO_THRESHOLD = 0.4;

// ─── State ────────────────────────────────────────────────────────────────────

export type ScanScrollRoot = Window | HTMLElement;

/**
 * Every scan owns a distinct scroll lease. Cancel releases the active slot
 * immediately; an older paused scan cannot restore/scroll a newer scan.
 */
type ActiveFullPageScan = { cancelled: boolean; eligible: () => boolean };
let activeScan: ActiveFullPageScan | null = null;

function isWindowScrollRoot(scrollRoot: ScanScrollRoot): scrollRoot is Window {
  return scrollRoot === window;
}

/** Never advance beyond the viewport actually inspected on this scroll root. */
function boundedScanStep(clientHeight: number): number {
  return Number.isFinite(clientHeight)
    ? Math.min(SCROLL_STEP_PX, Math.max(1, Math.floor(clientHeight)))
    : 1;
}

export function isFullPageScanRunning(): boolean {
  // A route/Runtime lease can expire without a matching explicit CANCEL.
  if (activeScan && !activeScan.eligible()) {
    activeScan.cancelled = true;
    activeScan = null;
  }
  return activeScan !== null;
}

export function cancelFullPageScan(): void {
  if (!activeScan) return;
  activeScan.cancelled = true;
  activeScan = null;
}

export interface ScanProgress {
  progress: number;
  found: number;
  currentStep: number;
  totalScrollSteps: number;
  observedCandidates?: number;
  retainedCandidates?: number;
  domDiagnostics?: DomCandidateDiagnostics;
  /** True only when the fixed scroll budget ends before actual page bottom. */
  budgetExhausted?: boolean;
  /** A scroll command did not advance the live root, leaving content unscanned. */
  scrollStalled?: boolean;
}

/**
 * isExecutionCurrent is captured from the exact Full Page START (or Auto
 * Solve run) and composed with the starting URL and attached scroll root.
 * Both scroll mutation and scroll restoration are denied on cancellation.
 */
export async function detectCandidatesFullPage(
  onProgress: (p: ScanProgress) => void,
  isExecutionCurrent: () => boolean = () => true,
): Promise<QuestionBlock[]> {
  if (isFullPageScanRunning()) return [];

  const startedAtUrl = location.href;
  let scrollRoot: ScanScrollRoot | null = null;
  const scan: ActiveFullPageScan = {
    cancelled: false,
    eligible: () => {
      if (location.href !== startedAtUrl) return false;
      if (scrollRoot && !isWindowScrollRoot(scrollRoot) && !scrollRoot.isConnected) return false;
      try {
        return isExecutionCurrent();
      } catch {
        return false;
      }
    },
  };
  activeScan = scan;
  const isCurrent = () => activeScan === scan && !scan.cancelled && scan.eligible();
  const allBlocks: QuestionBlock[] = [];
  let observedCandidates = 0;
  // Numeric-only DOM probes; never carry page text or identifiers.
  // Scoped to one scan lease including its bounded readiness recheck.
  const domDiagnostics: DomCandidateDiagnostics = {
    probedElements: 0, acceptedCandidates: 0,
    rejected: { geometry: 0, text: 0, controls: 0, navigation: 0, signal: 0, confidence: 0, completeness: 0 },
  };
  let originalTop = 0;
  let originalLeft = 0;

  try {
    if (!isCurrent()) return [];
    const root = resolveFullPageScrollRoot();
    scrollRoot = root;
    if (!isCurrent()) return [];

    originalTop = getScrollTop(root);
    originalLeft = getScrollLeft(root);

    if (!isCurrent()) return [];
    setScrollPosition(root, 0, originalLeft);
    await pause(SCROLL_PAUSE_MS);

    // Capture an immutable scan budget after the initial top-of-page scroll.
    // Live sites may grow/shrink their scrollHeight as ads/images load or the
    // scroll root reflows. Recomputing the denominator on every iteration
    // used to yield "31 / 15" and to keep scrolling well past the advertised
    // number of steps (only the unrelated 200-step safety cap applied).
    if (!isCurrent()) return [];
    const initialMetrics = getScrollMetrics(root);
    // A fixed 600px stride can jump over all content between two sampled
    // viewports when the browser/pane is shorter than 600px. Bind both the
    // immutable budget and every actual scroll to the owning root's viewport.
    const scanStepPx = boundedScanStep(initialMetrics.clientHeight);
    const initialDistance = initialMetrics.scrollHeight - initialMetrics.clientHeight;
    const totalSteps = Number.isFinite(initialDistance)
      ? Math.min(Math.max(1, Math.ceil(Math.max(0, initialDistance) / scanStepPx) + 1), MAX_SCROLL_STEPS)
      : 1;
    let step = 0;
    let previousTop: number | null = null;
    // A virtualized page may apply scrollTop after the normal 300ms render
    // pause. Allow one bounded read-only settling window per scan, not one
    // retry per viewport. This neither resends a scroll nor consumes a step.
    let delayedScrollSettleUsed = false;
    // At most ONE later empty-viewport readiness window per scan, in
    // addition to the existing first-viewport window. Never multiply the
    // advertised scroll budget by repeated SPA polling.
    let laterViewportReadinessUsed = false;
    while (isCurrent() && step < totalSteps) {
      let metrics = getScrollMetrics(root);
      // A scroll trap or fixed-position container must not repeatedly parse
      // the same viewport while claiming forward progress. Some virtual lists
      // commit the requested scroll *after* the initial render pause, though:
      // wait at most once per scan before declaring a genuine stall.
      if (previousTop !== null && metrics.scrollTop <= previousTop) {
        if (!delayedScrollSettleUsed
          && metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - 10) {
          delayedScrollSettleUsed = true;
          await pause(650);
          if (!isCurrent()) break;
          metrics = getScrollMetrics(root);
        }
        if (metrics.scrollTop <= previousTop) {
          // No retry-scroll, candidate re-probe or invented step is allowed.
          // A blocked scroll is not complete and is not budget exhaustion.
          if (metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - 10) {
            onProgress({
              progress: Math.min(Math.round((step / totalSteps) * 100), 99),
              found: allBlocks.length, currentStep: step, totalScrollSteps: totalSteps,
              observedCandidates, retainedCandidates: allBlocks.length, scrollStalled: true,
              domDiagnostics: { ...domDiagnostics, rejected: { ...domDiagnostics.rejected } },
            });
          }
          break;
        }
      }

      let viewportBlocks = detectCandidatesInViewport(domDiagnostics);
      // A virtual list may recycle its previous question DOM while mounting
      // the next item. A non-empty old question is NOT proof this viewport
      // is ready: detect exact repeated source text and use the SAME single
      // later-viewport readiness window as the empty-case recovery.
      // This is strictly a recheck hint, never a global deduplication rule:
      // legitimate repeated questions on distant cards remain separate.
      const recycledPreviousCandidate = step > 0
        && viewportBlocks.length > 0
        && viewportBlocks.every((candidate) => isExactPreviouslyObservedQuestion(candidate, allBlocks));
      if ((viewportBlocks.length === 0 || recycledPreviousCandidate)
        && (step === 0 || !laterViewportReadinessUsed)) {
        if (step > 0) laterViewportReadinessUsed = true;
        if (isPageContentPending()) {
          await pause(650);
          if (!isCurrent()) break;
          viewportBlocks = detectCandidatesInViewport(domDiagnostics);
        } else if (await observeUnmarkedViewportMutation(650)) {
          // Wait only for DOM presence changes, not question text or URLs.
          if (!isCurrent()) break;
          viewportBlocks = detectCandidatesInViewport(domDiagnostics);
        }
      }
      if (!isCurrent()) break;
      observedCandidates += viewportBlocks.length;
      for (const block of viewportBlocks) {
        const absoluteBlock = toAbsoluteCoords(block, root);
        const normalizedPreview = normalizePreviewText(absoluteBlock.previewText);
        if (!isLikelyUsefulPreview(normalizedPreview, absoluteBlock.questionTypeGuess)) continue;
        upsertCandidate(allBlocks, { ...absoluteBlock, previewText: normalizedPreview.slice(0, 420) });
      }

      step++;
      if (!isCurrent()) break;
      // A SPA may change scrollHeight while its question content is mounted
      // or during the bounded readiness recheck. The metrics sampled BEFORE
      // detection are not authoritative for the end-of-page decision: a pane
      // that was at bottom can grow and expose another legitimate viewport.
      // Keep totalSteps immutable; only refresh coverage/advance geometry.
      const remainingMetrics = getScrollMetrics(root);
      const budgetExhausted = step >= totalSteps
        && remainingMetrics.scrollTop + remainingMetrics.clientHeight < remainingMetrics.scrollHeight - 10;
      onProgress({
        progress: Math.min(Math.round((step / totalSteps) * 100), 99),
        found: allBlocks.length,
        currentStep: step,
        totalScrollSteps: totalSteps,
        observedCandidates,
        retainedCandidates: allBlocks.length,
        ...(budgetExhausted ? { budgetExhausted: true } : {}),
        domDiagnostics: { ...domDiagnostics, rejected: { ...domDiagnostics.rejected } },
      });
      // User handlers may synchronously CANCEL or change the route.
      if (!isCurrent()) break;
      // Use post-detection metrics, not the stale pre-readiness snapshot.
      if (remainingMetrics.scrollTop + remainingMetrics.clientHeight >= remainingMetrics.scrollHeight - 10) break;
      // The immutable budget is an execution limit, not just a UI total.
      if (step >= totalSteps) break;

      if (!isCurrent()) break;
      // If the viewport shrinks during a run, shrink the stride as well.
      // Keep the original totalSteps immutable; exhaustion then reports partial coverage.
      const nextTop = Math.min(
        remainingMetrics.scrollTop + Math.min(scanStepPx, boundedScanStep(remainingMetrics.clientHeight)),
        remainingMetrics.scrollHeight,
      );
      if (nextTop <= remainingMetrics.scrollTop) break;
      previousTop = remainingMetrics.scrollTop;
      setScrollPosition(root, nextTop, remainingMetrics.scrollLeft);
      await pause(SCROLL_PAUSE_MS);
    }

    if (!isCurrent()) return allBlocks;
    const filtered = postProcessCandidates(allBlocks).sort((a, b) => a.bbox.y - b.bbox.y);
    return filtered.map((block, index) => ({
      ...block,
      id: `fullpage-${Date.now()}-${index}`,
    }));
  } finally {
    // Never restore scroll after STOP, SPA churn, reinjection, or replacement.
    // A still-current normal scan owns its original scroll restoration.
    try {
      if (scrollRoot && isCurrent()) setScrollPosition(scrollRoot, originalTop, originalLeft);
    } finally {
      if (activeScan === scan) activeScan = null;
    }
  }
}

/** Readiness evidence is advisory only. It never grants scan authority. */
function isPageContentPending(): boolean {
  // Only an explicit site loading marker authorizes one bounded recheck.
  // document.readyState can stay "loading" inside test or embedded documents.
  return !!document.querySelector(
    'body[aria-busy="true"],main[aria-busy="true"],[data-loading="true"],' +
    '[role="progressbar"],[class*="skeleton"],[class*="loading-spinner"]',
  );
}

/**
 * An empty SPA viewport may not expose aria-busy or a loading element.
 * A mounted question may also become visible through a hidden/class/style/
 * aria-hidden update without adding nodes or changing text. Observe only
 * DOM structural, text-node and visibility-affecting attribute changes for
 * one bounded window; never collect page text, attribute values, IDs or URLs.
 * Extension overlay churn must not manufacture a page-readiness signal.
 */
async function observeUnmarkedViewportMutation(ms: number): Promise<boolean> {
  if (!document.body || typeof MutationObserver === "undefined") return false;
  let changed = false;
  const observer = new MutationObserver((records) => {
    if (changed) return;
    for (const record of records) {
      const nodes = record.type === "childList"
        ? [...record.addedNodes, ...record.removedNodes]
        : [record.target];
      for (const node of nodes) {
        const element = node.nodeType === Node.ELEMENT_NODE
          ? node as Element
          : node.parentElement;
        if (element && !isExtensionUiElement(element)) {
          changed = true;
          return;
        }
      }
    }
  });
  // Attribute-only SPA reveals (e.g. hidden → visible) do not emit childList
  // or characterData mutations. Do not watch unrelated attributes such as
  // href/value/data-* or record their values.
  observer.observe(document.body, {
    childList: true, characterData: true, attributes: true, subtree: true,
    attributeFilter: ["hidden", "aria-hidden", "class", "style"],
  });
  try {
    await pause(ms);
  } finally {
    observer.disconnect();
  }
  return changed;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A recycled virtual-list card can still display the previous viewport's
 * question after scrollTop advances. Only use exact, untruncated content
 * agreement as a bounded readiness signal; never drop legitimate repeated
 * questions or equate the first 420 characters of distinct long questions.
 */
function isExactPreviouslyObservedQuestion(candidate: QuestionBlock, accepted: QuestionBlock[]): boolean {
  const preview = normalizePreviewText(candidate.previewText);
  const fullSource = normalizePreviewText(candidate.identitySourceText ?? "");
  return accepted.some((prior) => {
    if (candidate.questionTypeGuess !== prior.questionTypeGuess) return false;
    const priorFull = normalizePreviewText(prior.identitySourceText ?? "");
    if (fullSource && priorFull) return fullSource === priorFull;
    const priorPreview = normalizePreviewText(prior.previewText);
    return preview.length > 0 && preview.length < 420
      && priorPreview.length < 420 && preview === priorPreview;
  });
}

/** Convert a viewport-relative block to page-absolute coordinates */
function toAbsoluteCoords(block: QuestionBlock, scrollRoot: ScanScrollRoot): QuestionBlock {
  if (!isWindowScrollRoot(scrollRoot)) {
    const rect = scrollRoot.getBoundingClientRect();
    return {
      ...block,
      bbox: {
        x: block.bbox.x - rect.left + getScrollLeft(scrollRoot),
        y: block.bbox.y - rect.top + getScrollTop(scrollRoot),
        width: block.bbox.width,
        height: block.bbox.height,
      },
    };
  }

  return {
    ...block,
    bbox: {
      x: block.bbox.x + getScrollLeft(scrollRoot),
      y: block.bbox.y + getScrollTop(scrollRoot),
      width: block.bbox.width,
      height: block.bbox.height,
    },
  };
}

/**
 * A long navigation/sidebar scroller must not outrank the question surface.
 * An explicit navigation landmark is never the document's question scroll root.
 * A generic pane remains eligible until a credible question-bearing pane exists.
 */
function isNavigationScrollPane(el: HTMLElement): boolean {
  if (el.closest('nav,[role="navigation"],[role="menu"]')) return true;
  const identity = `${el.id} ${typeof el.className === "string" ? el.className : ""}`;
  const navigationName = /(?:^|[\s_-])(?:sidebar|sidenav|navigation|navbar|menu|toc|catalog)(?=$|[\s_-])/i.test(identity);
  if (!navigationName && !el.closest("aside")) return false;
  return !el.matches(".question-item,.questionBox,.base-question-component")
    && !el.querySelector(".question-item,.questionBox,.base-question-component");
}

export function resolveFullPageScrollRoot(): ScanScrollRoot {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let best: HTMLElement | null = null;
  let bestScore = 0;
  let bestContainsQuestions = false;

  const nodes = Array.from(document.querySelectorAll<HTMLElement>("body *"));
  for (const el of nodes) {
    if (!el.isConnected) continue;
    if (el.id === "qs-highlight-layer" || el.closest("#qs-highlight-layer, #qs-overlay-root, #qs-floating-host, #qs-capture-toolbar")) continue;
    const style = window.getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
    const scrollDelta = el.scrollHeight - el.clientHeight;
    if (scrollDelta < 200) continue;
    if (el.clientHeight < Math.max(220, vh * 0.35)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < Math.max(320, vw * 0.3)) continue;
    if (rect.height < Math.max(220, vh * 0.3)) continue;
    if (isNavigationScrollPane(el)) continue;

    // Prefer a question-bearing pane even when a generic layout scroller is
    // taller. Do not make empty or still-loading content panes ineligible.
    const containsQuestions = el.matches(".question-item,.questionBox,.base-question-component")
      || !!el.querySelector(".question-item,.questionBox,.base-question-component");
    let score = scrollDelta;
    score += Math.min(rect.width, vw) * 0.2;
    score += Math.min(rect.height, vh) * 0.3;
    if (/question|exam|scroll|content|main|body|list|paper/i.test(`${el.className} ${el.id}`)) score += 240;
    if (rect.left < vw * 0.2) score += 60;

    if (!best || (containsQuestions && !bestContainsQuestions)
      || (containsQuestions === bestContainsQuestions && score > bestScore)) {
      bestScore = score;
      bestContainsQuestions = containsQuestions;
      best = el;
    }
  }

  return best ?? window;
}

export function getScrollMetrics(scrollRoot: ScanScrollRoot): {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  clientHeight: number;
} {
  if (isWindowScrollRoot(scrollRoot)) {
    const el = document.scrollingElement || document.documentElement;
    return {
      scrollTop: window.scrollY,
      scrollLeft: window.scrollX,
      scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, el.scrollHeight),
      clientHeight: window.innerHeight,
    };
  }

  const elementRoot = scrollRoot;
  return {
    scrollTop: elementRoot.scrollTop,
    scrollLeft: elementRoot.scrollLeft,
    scrollHeight: elementRoot.scrollHeight,
    clientHeight: elementRoot.clientHeight,
  };
}

export function getScrollTop(scrollRoot: ScanScrollRoot): number {
  if (isWindowScrollRoot(scrollRoot)) return window.scrollY;
  return scrollRoot.scrollTop;
}

export function getScrollLeft(scrollRoot: ScanScrollRoot): number {
  if (isWindowScrollRoot(scrollRoot)) return window.scrollX;
  return scrollRoot.scrollLeft;
}

export function setScrollPosition(scrollRoot: ScanScrollRoot, top: number, left: number): void {
  if (isWindowScrollRoot(scrollRoot)) {
    window.scrollTo({ top, left, behavior: "instant" });
    return;
  }
  scrollRoot.scrollTo({ top, left, behavior: "instant" });
}

function overlapRatio(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function upsertCandidate(target: QuestionBlock[], block: QuestionBlock): void {
  const idx = target.findIndex((existing) => isLikelySameQuestion(existing, block));
  if (idx < 0) {
    target.push(block);
    return;
  }
  const prev = target[idx];
  if (candidateRank(block) > candidateRank(prev)) {
    target[idx] = block;
  }
}

function postProcessCandidates(blocks: QuestionBlock[]): QuestionBlock[] {
  const byRank = [...blocks].sort((a, b) => candidateRank(b) - candidateRank(a));
  const kept: QuestionBlock[] = [];
  // A 96-character prefix is not a global question identity: separate
  // comprehension questions can share all introductory material. Retain
  // spatially distinct candidates and deduplicate only with the same-question
  // geometry/text evidence already used during viewport accumulation.
  for (const block of byRank) {
    // Blocks have already passed the complete-text preview gate before
    // truncation to 420 characters. Revalidating the truncated preview can
    // drop a legitimate choice question whose D option appears after 420.
    const text = normalizePreviewText(block.previewText);
    if (kept.some((k) => isLikelySameQuestion(k, block))) continue;
    kept.push({ ...block, previewText: text.slice(0, 420) });
  }

  return kept;
}

function isLikelySameQuestion(a: QuestionBlock, b: QuestionBlock): boolean {
  const overlap = overlapRatio(a.bbox, b.bbox);
  // Geometry is a necessary but not sufficient identity signal. An enclosing
  // reading-material card can overlap a distinct nested question almost
  // entirely. Never discard one solely because overlap > 0.4.
  if (overlap < 0.12) return false;

  const ta = normalizePreviewText(a.previewText);
  const tb = normalizePreviewText(b.previewText);
  if (!ta || !tb) return false;
  // DOM candidates publish a display-only preview capped at 420 characters.
  // Never treat that prefix as complete question identity: a decisive option
  // or negation may occur after the truncation boundary. The full original
  // source text, when present on both observations, can disprove equality.
  const fullA = normalizePreviewText(a.identitySourceText ?? "");
  const fullB = normalizePreviewText(b.identitySourceText ?? "");
  if (fullA && fullB && fullA !== fullB) return false;
  if ((!fullA || !fullB) && (ta.length >= 420 || tb.length >= 420)) return false;
  // A near-identical reading passage is not question identity. Changing one
  // decisive character ("正确" vs "错误") can preserve >0.86 Bigram similarity.
  // Without a trusted native question ID, fail open: retain both candidates.
  // Whitespace-normalized *exact* preview remains safe for re-observations.
  if (ta !== tb) return false;

  // Strongly overlapping observations of the same text may be merged even
  // when minor layout shifts move their top-left corner.
  if (overlap > OVERLAP_RATIO_THRESHOLD) return true;
  // Smaller overlaps still need proximity to prove the same candidate.
  return Math.abs(a.bbox.x - b.bbox.x) < 140 &&
    Math.abs(a.bbox.y - b.bbox.y) < 260;
}

function candidateRank(block: QuestionBlock): number {
  const text = normalizePreviewText(block.previewText);
  const len = text.length;
  const optionCount = (text.match(/[A-D][\.\):\uFF1A\u3001]/g) || []).length;
  const circledCount = (text.match(/[\u2460\u2461\u2462\u2463]/g) || []).length;
  const hasQuestion = /[?\uFF1F]/.test(text);
  let rank = (block.confidence ?? 0) * 100;
  rank += Math.min(optionCount + circledCount, 6) * 8;
  if (hasQuestion) rank += 10;
  if (len >= 80 && len <= 650) rank += 12;
  if (len > 900) rank -= 20;
  if ((block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice") && optionCount + circledCount >= 4) {
    rank += 12;
  }
  return rank;
}

function normalizePreviewText(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyUsefulPreview(text: string, questionType: QuestionBlock["questionTypeGuess"]): boolean {
  if (!text) return false;
  const controlPanelLike = isLikelyControlPanelText(text);
  if (controlPanelLike) return false;
  if (text.length < 28) {
    const shortJudgeLike = (questionType === "judge" || questionType === "unknown")
      && text.length >= 12
      && !/[A-D][\.\):\uFF1A\u3001]/.test(text)
      && /[。！？.!?\)）]$/.test(text);
    if (!shortJudgeLike) return false;
  }
  if (/^(?:[A-D][\.\):\uFF1A\u3001]?|[\u2460\u2461\u2462\u2463])/.test(text)) return false;

  const optionCount = (text.match(/[A-D][\.\):\uFF1A\u3001]/g) || []).length;
  const circledCount = (text.match(/[\u2460\u2461\u2462\u2463]/g) || []).length;
  const optionLike = optionCount + circledCount;
  const looksChoice = questionType === "single_choice" || questionType === "multi_choice" || optionLike >= 3;
  const hasABCD = /A[\.\):\uFF1A\u3001][\s\S]*B[\.\):\uFF1A\u3001][\s\S]*C[\.\):\uFF1A\u3001][\s\S]*D[\.\):\uFF1A\u3001]/.test(text);

  if (looksChoice && optionLike < 4) return false;
  if (looksChoice && !hasABCD && circledCount < 4) return false;
  return true;
}


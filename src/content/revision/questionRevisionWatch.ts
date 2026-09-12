import type { QuestionBlock } from "@/shared/types";
import { isExtensionUiElement } from "../detector/domDetectorShared";
import { abortQuestionRevisionAttempt, activeQuestionRevisionAttempt, revisionRegistry } from "./questionRevisionRuntime";
import type { QuestionRevisionEvent } from "./questionRevisionTypes";

const RELEVANT_ATTRIBUTES = ["src", "srcset", "style", "class", "alt", "aria-label", "aria-labelledby", "aria-disabled", "disabled", "checked", "value", "aria-checked", "aria-selected"];
const INTERACTION_ATTRIBUTES = new Set(["checked", "value", "aria-checked", "aria-selected"]);

export type QuestionRevisionWatchOptions = {
  detectCandidates: () => QuestionBlock[];
  onCandidates: (candidates: QuestionBlock[]) => void;
  onEvent?: (event: QuestionRevisionEvent) => void;
};

function isRelevantMutation(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target && isExtensionUiElement(target)) return false;
  if (record.type === "attributes") return !INTERACTION_ATTRIBUTES.has(record.attributeName ?? "");
  if (record.type === "characterData") return Boolean(target && !isExtensionUiElement(target));
  return record.addedNodes.length > 0 || record.removedNodes.length > 0;
}

/** The single SPA semantic-watch owner. Its observer only queues work; canonical detection happens in flush. */
export function startQuestionRevisionWatch(options: QuestionRevisionWatchOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const registry = revisionRegistry();

  const reconcile = () => {
    timer = null;
    if (stopped) return;
    const routeChanged = registry.refreshRoute();
    const candidates = options.detectCandidates();
    options.onCandidates(candidates);
    const active = activeQuestionRevisionAttempt();
    if (!active) return;
    if (routeChanged) {
      options.onEvent?.("ROUTE_CHANGED");
      abortQuestionRevisionAttempt();
      return;
    }
    const sameId = candidates.find((block) =>
      (block.identity?.stableId ?? block.id) === active.stableId
      || Boolean(active.nativeQuestionId && block.identity?.nativeQuestionId === active.nativeQuestionId),
    );
    if (!sameId) {
      const event: QuestionRevisionEvent = candidates.length ? "REPLACED" : "REMOVED";
      options.onEvent?.(event);
      abortQuestionRevisionAttempt();
      return;
    }
    const fingerprint = sameId.identity?.contentFingerprint ?? sameId.id;
    if (fingerprint !== active.contentFingerprint) {
      options.onEvent?.("REVISION_CHANGED");
      abortQuestionRevisionAttempt();
      return;
    }
    const observed = registry.observe(sameId);
    options.onEvent?.(observed.event);
  };

  const schedule = () => {
    if (!timer) timer = setTimeout(reconcile, 50);
  };
  const observer = new MutationObserver((records) => {
    if (records.some(isRelevantMutation)) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: RELEVANT_ATTRIBUTES });
  const onRoute = () => schedule();
  addEventListener("popstate", onRoute);
  addEventListener("hashchange", onRoute);
  return () => {
    stopped = true;
    observer.disconnect();
    removeEventListener("popstate", onRoute);
    removeEventListener("hashchange", onRoute);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

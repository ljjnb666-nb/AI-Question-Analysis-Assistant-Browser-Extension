import type { QuestionBlock } from "@/shared/types";
import { rootAttachmentOf, TOP_ROOT_KEY } from "./roots/rootContext";

/** One authoritative watcher aggregation, keyed by the root that produced each snapshot. */
export class CandidateRootAggregation {
  private readonly candidatesByRoot = new Map<string, QuestionBlock[]>();

  constructor(initialCandidates: QuestionBlock[] = []) {
    for (const block of initialCandidates) {
      const rootKey = rootAttachmentOf(block).rootKey || TOP_ROOT_KEY;
      const current = this.candidatesByRoot.get(rootKey) ?? [];
      current.push(block);
      this.candidatesByRoot.set(rootKey, current);
    }
  }

  replaceRoot(rootKey: string, candidates: QuestionBlock[]): QuestionBlock[] {
    this.candidatesByRoot.set(rootKey, [...candidates]);
    return this.snapshot();
  }

  removeRoot(rootKey: string): QuestionBlock[] {
    this.candidatesByRoot.delete(rootKey);
    return this.snapshot();
  }

  snapshot(): QuestionBlock[] {
    return [...this.candidatesByRoot.values()].flat().sort((left, right) => left.bbox.y - right.bbox.y || left.bbox.x - right.bbox.x);
  }
}

import { describe, expect, it } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { CandidateRootAggregation } from "./candidateRootAggregation";
import { RUNTIME_ROOT, TOP_ROOT_KEY } from "./roots/rootContext";

function question(id: string, rootKey: string, y: number): QuestionBlock {
  const block: QuestionBlock = {
    id,
    identity: {
      identityVersion: 1,
      stableId: id,
      contentFingerprint: `fp-${id}`,
      strategy: "content-only",
      signals: { nativeId: false, content: true, options: false, media: false, structure: false },
    },
    bbox: { x: 0, y, width: 300, height: 120 },
    previewText: id,
    hasImage: false,
    questionTypeGuess: "single_choice",
    confidence: 1,
    source: "auto_dom",
  };
  Object.defineProperty(block, RUNTIME_ROOT, {
    configurable: true,
    enumerable: true,
    value: {
      rootKey,
      rootGeneration: rootKey === TOP_ROOT_KEY ? 0 : 1,
      kind: rootKey === TOP_ROOT_KEY ? "top-document" : rootKey.includes("shadow") ? "open-shadow-root" : "same-origin-frame",
    },
  });
  return block;
}

describe("per-root watcher candidate aggregation", () => {
  it("ROOT-WATCH-AGG-1 keeps three roots represented when one root changes", () => {
    const aggregate = new CandidateRootAggregation([
      question("top-q", TOP_ROOT_KEY, 10),
      question("frame-q", "root-frame-1", 20),
      question("shadow-q", "root-shadow-2", 30),
    ]);

    expect(aggregate.replaceRoot("root-frame-1", [question("frame-q2", "root-frame-1", 21)])).toHaveLength(3);
  });

  it("ROOT-WATCH-AGG-2 replaces one root semantically without losing the others", () => {
    const aggregate = new CandidateRootAggregation([
      question("top-q", TOP_ROOT_KEY, 10),
      question("frame-q", "root-frame-1", 20),
      question("shadow-q", "root-shadow-2", 30),
    ]);

    expect(aggregate.replaceRoot("root-frame-1", [question("frame-replacement", "root-frame-1", 22)]).map((block) => block.id))
      .toEqual(["top-q", "frame-replacement", "shadow-q"]);
  });

  it("ROOT-WATCH-AGG-3 removes only candidates from the removed root", () => {
    const aggregate = new CandidateRootAggregation([
      question("top-q", TOP_ROOT_KEY, 10),
      question("frame-q", "root-frame-1", 20),
      question("shadow-q", "root-shadow-2", 30),
    ]);

    expect(aggregate.removeRoot("root-frame-1").map((block) => block.id)).toEqual(["top-q", "shadow-q"]);
  });

  it("ROOT-WATCH-AGG-4 adds a newly discovered root", () => {
    const aggregate = new CandidateRootAggregation([question("top-q", TOP_ROOT_KEY, 10)]);

    expect(aggregate.replaceRoot("root-frame-new", [question("frame-q", "root-frame-new", 20)])).toHaveLength(2);
  });
});

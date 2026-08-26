import { describe, expect, it } from "vitest";
import { QuestionRevisionRegistry, compareQuestionRuntimeRevision } from "./questionRevisionRegistry";

const block = (fingerprint = "cf-a") => ({
  id: "runtime-q12",
  bbox: { x: 0, y: 0, width: 100, height: 100 },
  previewText: "12. 2 + 2 = ? A. 3 B. 4",
  hasImage: false,
  questionTypeGuess: "single_choice" as const,
  confidence: 1,
  source: "auto_dom" as const,
  identity: { stableId: "q12", contentFingerprint: fingerprint, identityVersion: 1 as const, strategy: "native-id" as const, nativeQuestionId: "12", signals: { nativeId: true, content: true, options: true, media: false, structure: true } },
});

describe("Phase 6 runtime question revisions", () => {
  it("classifies equivalent replacement as REBOUND without changing semantic identity", () => {
    const registry = new QuestionRevisionRegistry();
    const firstOwner = document.createElement("section");
    const secondOwner = document.createElement("section");
    const first = registry.observe(block(), firstOwner).version;
    const rebound = registry.observe(block(), secondOwner);
    expect(rebound.event).toBe("REBOUND");
    expect(rebound.version.bindingEpoch).toBe(first.bindingEpoch + 1);
  });

  it("keeps semantic and binding comparisons explicit", () => {
    const prior = { stableId: "q12", contentFingerprint: "cf-a", bindingEpoch: 1, routeEpoch: 0, routeFingerprint: "route-a" };
    expect(compareQuestionRuntimeRevision(prior, { ...prior, bindingEpoch: 2 })).toBe("REBOUND");
    expect(compareQuestionRuntimeRevision(prior, { ...prior, contentFingerprint: "cf-b" })).toBe("REVISION_CHANGED");
    expect(compareQuestionRuntimeRevision(prior, { ...prior, stableId: "q13" })).toBe("REPLACED");
    expect(compareQuestionRuntimeRevision(prior, { ...prior, routeEpoch: 1 })).toBe("ROUTE_CHANGED");
  });
});

import { describe, expect, it } from "vitest";
import type { DetectedCandidate } from "@/shared/types";
import {
  clearCandidateSelection,
  selectAllCandidates,
  toggleCandidateSelection,
} from "./sidepanelSelectionSync";

const makeCandidate = (id: string, selected = false): DetectedCandidate => ({
  block: {
    id,
    bbox: { x: 0, y: 0, width: 100, height: 40 },
    previewText: `Question ${id}`,
    hasImage: false,
    questionTypeGuess: "single_choice",
    confidence: 0.8,
    source: "manual_capture",
  },
  selected,
  status: "idle",
});

describe("sidepanelSelectionSync", () => {
  it("toggles only the targeted candidate selection", () => {
    const candidates = [makeCandidate("a"), makeCandidate("b", true)];

    const next = toggleCandidateSelection(candidates, "a");

    expect(next[0].selected).toBe(true);
    expect(next[1].selected).toBe(true);
    expect(candidates[0].selected).toBe(false);
  });

  it("clears all candidate selections", () => {
    const candidates = [makeCandidate("a", true), makeCandidate("b", true)];

    const next = clearCandidateSelection(candidates);

    expect(next.every((candidate) => !candidate.selected)).toBe(true);
  });

  it("selects all candidates", () => {
    const candidates = [makeCandidate("a"), makeCandidate("b", false)];

    const next = selectAllCandidates(candidates);

    expect(next.every((candidate) => candidate.selected)).toBe(true);
  });
});

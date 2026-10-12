import { describe, expect, it } from "vitest";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";

describe("Issue #102 R10B partial-coverage zero-result guidance", () => {
  it("distinguishes an unscanned remainder from a genuinely empty page in Chinese", () => {
    const copy = CANDIDATE_WORKSPACE_COPY.zh;
    expect(copy.budgetExhaustedEmpty).toContain("步数上限");
    expect(copy.budgetExhaustedEmpty).toContain("未覆盖");
    expect(copy.budgetExhaustedEmpty).toContain("并非整页无题");
  });
  it("states in English that the full page was not checked", () => {
    const copy = CANDIDATE_WORKSPACE_COPY.en;
    expect(copy.budgetExhaustedEmpty).toContain("step limit");
    expect(copy.budgetExhaustedEmpty).toContain("full page was not checked");
    expect(copy.budgetExhaustedEmpty).not.toBe(copy.completedEmpty);
  });
});

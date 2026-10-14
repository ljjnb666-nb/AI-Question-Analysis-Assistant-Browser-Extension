import { describe, expect, it } from "vitest";
import { normalizeAnswer, resolveStableChoiceResolution } from "./parseResultChoice";

describe("WS5-001 prose answer must not be letter-scraped into a fill", () => {
  it("does not fabricate answers from English uncertain prose", () => {
    // Audit repro: "I am not sure, possibly B" used to become "A,B" and be filled.
    expect(normalizeAnswer("I am not sure, possibly B")).toBe("I am not sure, possibly B");
    expect(normalizeAnswer("None of the above")).toBe("None of the above");
    // Negated option must not leak in either ("A,C" included the denied A).
    expect(normalizeAnswer("A is wrong, the correct one is C")).toBe("A is wrong, the correct one is C");
  });

  it("still normalizes clean letter sets", () => {
    expect(normalizeAnswer("B")).toBe("B");
    expect(normalizeAnswer("b")).toBe("B");
    expect(normalizeAnswer("a,c")).toBe("A,C");
    expect(normalizeAnswer("C，A")).toBe("A,C");
    expect(normalizeAnswer("B。")).toBe("B");
    expect(normalizeAnswer("")).toBe("—");
  });

  it("resolveStableChoiceResolution fails closed on prose raw answers", () => {
    const r = resolveStableChoiceResolution(
      "single_choice",
      "I am not sure, possibly B",
      "",
      "",
      "I am not sure, possibly B",
    );
    expect(r.answer).toBe("");
  });

  it("English uncertainty in the explanation blocks even clean letter answers", () => {
    const r = resolveStableChoiceResolution(
      "single_choice",
      "B",
      "",
      "",
      "I am not sure, possibly B. The image is a bit unclear.",
    );
    expect(r.answer).toBe("");
  });

  it("Chinese uncertainty still blocks", () => {
    const r = resolveStableChoiceResolution("single_choice", "B", "", "", "我不确定，可能是B");
    expect(r.answer).toBe("");
  });

  it("confident answers still resolve (no over-blocking)", () => {
    const r = resolveStableChoiceResolution(
      "single_choice",
      "B",
      "",
      "",
      "B is correct because the capital of China is Beijing. This cannot be A.",
    );
    expect(r.answer).toBe("B");
    expect(r.optionSelections?.B).toBe(true);
  });
});

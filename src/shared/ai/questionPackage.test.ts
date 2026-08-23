import { describe, expect, it } from "vitest";
import { buildSolverRequestContent } from "./questionPackage";
describe("solver request content", () => {
  it("P4-16/P4-17 labels every option and multiple stem image", () => {
    const parts = buildSolverRequestContent("Question text", [
      { assetId: "s1", role: "stem", contentFingerprint: "s1", source: { kind: "data-url", dataUrl: "data:image/png;base64,eA==" } },
      { assetId: "s2", role: "stem", contentFingerprint: "s2", source: { kind: "data-url", dataUrl: "data:image/png;base64,eA==" } },
      ...["A", "B", "C", "D"].map((optionKey) => ({ assetId: optionKey, role: "option" as const, optionKey, contentFingerprint: optionKey, source: { kind: "data-url" as const, dataUrl: "data:image/png;base64,eA==" } })),
    ]);
    expect(parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual(["Question text", "Question stem image 1:", "Question stem image 2:", "Option A image:", "Option B image:", "Option C image:", "Option D image:"]);
  });
});

import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  findNextFractionExpression,
  normalizeRenderableMathText,
  renderMathText,
} from "./SidePanelApp";

function renderMarkup(text: string): string {
  return renderToStaticMarkup(<div>{renderMathText(text)}</div>);
}

describe("SidePanelApp formula rendering", () => {
  it("detects parenthesized fractions", () => {
    expect(findNextFractionExpression("(1)/(6)*(X_{1}+X_{2})")).toEqual({
      start: 0,
      end: 7,
      numerator: "1",
      denominator: "6",
    });
  });

  it("normalizes flattened sub/superscript text before rendering", () => {
    expect(normalizeRenderableMathText("T 1 = (1)/(6)*(X 1 + X 2) + θ 2")).toBe(
      "T_{1} = (1)/(6)*(X_{1} + X_{2}) + θ^{2}",
    );
  });

  it("keeps explicit math markers from the DOM extractor intact", () => {
    expect(normalizeRenderableMathText("x_{1} = 1, x_{2} = 2, x_{3} = 1")).toBe(
      "x_{1} = 1, x_{2} = 2, x_{3} = 1",
    );
    expect(normalizeRenderableMathText("2*θ^{5}(1-θ)")).toBe("2*θ^{5}(1-θ)");
  });

  it("renders fractions as structured spans instead of plain slash text", () => {
    const markup = renderMarkup("(1)/(6)*(X_{1}+X_{2})");
    expect(markup).toContain("inline-flex");
    expect(markup).toContain("border-bottom:1px solid currentColor");
    expect(markup).not.toContain("(1)/(6)");
  });

  it("renders subscripts and superscripts into DOM tags", () => {
    const markup = renderMarkup("T_{1} = (1)/(6)*(X_{1} + X_{2}) + θ^{2}");
    expect(markup).toContain("T<sub>1</sub>");
    expect(markup).toContain("X<sub>1</sub>");
    expect(markup).toContain("θ<sup>2</sup>");
  });

  it("renders likelihood-style powers on the host symbol instead of on 1", () => {
    const markup = renderMarkup("2*θ^{5}(1-θ)");
    expect(markup).toContain("θ<sup>5</sup>");
    expect(markup).not.toContain("1<sup>5</sup>");
  });
});

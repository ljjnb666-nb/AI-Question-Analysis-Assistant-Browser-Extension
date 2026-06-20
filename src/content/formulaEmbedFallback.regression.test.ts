import { describe, expect, it } from "vitest";

import { extractSemanticSvgLikeText } from "./formulaEmbedFallback";

function makeSvgText(svg: SVGSVGElement, txt: string, x: string, y: string) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
  node.setAttribute("x", x);
  node.setAttribute("y", y);
  node.setAttribute("txt", txt);
  node.textContent = txt;
  svg.appendChild(node);
}

describe("formulaEmbedFallback regression cases", () => {
  it("attaches superscripts to the left theta before a parenthesized factor", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    makeSvgText(svg, "2", "58", "416");
    makeSvgText(svg, "5", "480", "244");
    makeSvgText(svg, "θ", "220", "416");
    makeSvgText(svg, "(", "632", "416");
    makeSvgText(svg, "1", "728", "416");
    makeSvgText(svg, "-", "944", "416");
    makeSvgText(svg, "θ", "1094", "416");
    makeSvgText(svg, ")", "1346", "416");
    document.body.appendChild(svg);

    expect(extractSemanticSvgLikeText(svg)).toContain("2*θ^{5}*(1 - θ)");
  });
});

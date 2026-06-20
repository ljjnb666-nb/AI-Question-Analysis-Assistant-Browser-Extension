import { beforeEach, describe, expect, it } from "vitest";
import {
  decodeFormulaLikeText,
  extractSemanticSvgLikeText,
  findNearbySemanticFormulaTextForImage,
  hasNearbyLargeVisualImageForSemanticNode,
  processFormulaEmbeds,
  shouldInstallFormulaEmbedFallback,
} from "./formulaEmbedFallback";

describe("formulaEmbedFallback", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("decodes latex-like embed payloads into readable inline text", () => {
    const text = decodeFormulaLikeText("G(s)=10+%5Cfrac%7B2%7D%7Bs%7D%20+5s");
    expect(text).toBe("G(s)=10+(2)/(s)+5s");
  });

  it("replaces blocked zhihuishu formula embeds with inline fallback text", () => {
    document.body.innerHTML = `
      <div id="stem">
        某系统的校正装置的数学模型为
        <embed id="formula" data-svg-latex="G(s)=10+%5Cfrac%7B2%7D%7Bs%7D%20+5s" type="image/svg+xml" />
        ，则该校正装置为�?）�?
      </div>
    `;

    const changed = processFormulaEmbeds(document);
    const formula = document.getElementById("formula") as HTMLElement | null;
    const fallback = document.querySelector("[data-qs-formula-fallback]") as HTMLElement | null;

    expect(changed).toBe(1);
    expect(formula?.style.display).toBe("none");
    expect(fallback?.textContent).toBe("G(s)=10+(2)/(s)+5s");
    expect(document.getElementById("stem")?.textContent).toContain("G(s)=10+(2)/(s)+5s");
  });

  it("limits visual embed fallback to zhihuishu hosts", () => {
    expect(shouldInstallFormulaEmbedFallback("hiexam.zhihuishu.com")).toBe(true);
    expect(shouldInstallFormulaEmbedFallback("example.com")).toBe(false);
  });

  it("extracts semantic svg text without style noise", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", "formula");
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = ".brush0 { fill: rgb(255,255,255); } .font0 { font-size: 12px; }";
    const t1 = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t1.setAttribute("txt", "θ");
    t1.textContent = "q";
    const t2 = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t2.textContent = "=";
    const t3 = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t3.textContent = "3.25";
    svg.append(style, t1, t2, t3);
    document.body.appendChild(svg);

    expect(extractSemanticSvgLikeText(svg)).toBe("θ = 3.25");
  });

  it("matches formula carrier images with nearby semantic svg text", () => {
    document.body.innerHTML = `
      <div id="wrap">
        <img id="carrier" src="https://example.com/formula.png" />
        <svg id="formula" viewBox="0 0 100 20">
          <text>X</text>
          <text>=</text>
          <text>1</text>
        </svg>
      </div>
    `;

    const img = document.getElementById("carrier")!;
    const svg = document.getElementById("formula")!;
    Object.defineProperty(img, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 120, width: 180, height: 40, right: 280, bottom: 160, x: 100, y: 120, toJSON() {} }),
    });
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ left: 110, top: 168, width: 170, height: 24, right: 280, bottom: 192, x: 110, y: 168, toJSON() {} }),
    });

    expect(findNearbySemanticFormulaTextForImage(img)).toBe("X = 1");
  });

  it("keeps large question images as visual content instead of formula carriers", () => {
    document.body.innerHTML = `
      <div id="wrap">
        <img id="figure" src="https://example.com/table.png" />
        <svg id="semantic" viewBox="0 0 320 24">
          <text x="10" y="18">x</text>
          <text x="40" y="18">1</text>
          <text x="80" y="18">=</text>
          <text x="110" y="18">1</text>
        </svg>
      </div>
    `;

    const img = document.getElementById("figure")!;
    const svg = document.getElementById("semantic")!;
    Object.defineProperty(img, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 120, width: 346, height: 56, right: 446, bottom: 176, x: 100, y: 120, toJSON() {} }),
    });
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ left: 110, top: 184, width: 320, height: 24, right: 430, bottom: 208, x: 110, y: 184, toJSON() {} }),
    });

    expect(findNearbySemanticFormulaTextForImage(img)).toBe("");
    expect(hasNearbyLargeVisualImageForSemanticNode(svg)).toBe(true);
  });

  it("keeps large question figures but still allows semantic continuation text after the figure", () => {
    document.body.innerHTML = `
      <div id="wrap" class="questionContent">
        <img id="figure" src="https://example.com/table.png" />
        <svg id="semantic" viewBox="0 0 640 40">
          <text x="10" y="18">取得样本�?/text>
          <text x="180" y="18">x</text>
          <text x="210" y="30">1</text>
          <text x="235" y="18">=</text>
          <text x="260" y="18">1,</text>
          <text x="320" y="18">则参�?/text>
          <text x="430" y="18">θ</text>
          <text x="470" y="18">的矩估计�?/text>
        </svg>
      </div>
    `;

    const img = document.getElementById("figure")!;
    const svg = document.getElementById("semantic")!;
    Object.defineProperty(img, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 120, width: 346, height: 56, right: 446, bottom: 176, x: 100, y: 120, toJSON() {} }),
    });
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ left: 110, top: 184, width: 500, height: 28, right: 610, bottom: 212, x: 110, y: 184, toJSON() {} }),
    });

    expect(hasNearbyLargeVisualImageForSemanticNode(svg)).toBe(false);
    expect(extractSemanticSvgLikeText(svg)).toContain("取得");
    expect(extractSemanticSvgLikeText(svg)).toContain("叙参");
  });

  it("reconstructs svg subscripts into inline math text", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const makeText = (txt: string, x: string, y: string, content?: string) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.setAttribute("x", x);
      node.setAttribute("y", y);
      if (content !== undefined) node.textContent = content;
      if (txt) node.setAttribute("txt", txt);
      return node;
    };
    svg.append(
      makeText("", "20", "100", "x"),
      makeText("", "52", "100", "="),
      makeText("", "70", "100", "1,"),
      makeText("", "120", "100", "x"),
      makeText("", "152", "100", "="),
      makeText("", "170", "100", "2"),
      makeText("", "34", "132", "1"),
      makeText("", "134", "132", "2"),
    );
    document.body.appendChild(svg);

    expect(extractSemanticSvgLikeText(svg)).toContain("x_{1} = 1, x_{2} = 2");
  });

  it("reconstructs coefficient fractions inside estimator formulas", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const makeText = (txt: string, x: string, y: string) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.setAttribute("x", x);
      node.setAttribute("y", y);
      node.setAttribute("txt", txt);
      node.textContent = txt;
      return node;
    };
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "803");
    line.setAttribute("y1", "538");
    line.setAttribute("x2", "1025");
    line.setAttribute("y2", "538");
    svg.append(
      makeText("11234", "233 1509 2331 3724 4550", "743"),
      makeText("11", "797 2995", "392"),
      makeText("()()", "1058 2491 3259 4710", "640"),
      makeText("63", "800 3001", "934"),
      makeText("TXXXX", "34 1232 2040 3433 4262", "640"),
      makeText("=+++", "464 1716 2677 3938", "640"),
      line,
    );
    document.body.appendChild(svg);

    const text = extractSemanticSvgLikeText(svg);
    expect(text).toContain("T_{1}");
    expect(text).toContain("(1)/(6)");
    expect(text).toContain("(1)/(3)");
    expect(text).toContain("(1)/(3)");
  });

  it("reconstructs fraction plus exponent options like 5/18 θ^2", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const makeText = (txt: string, x: string, y: string) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.setAttribute("x", x);
      node.setAttribute("y", y);
      node.setAttribute("txt", txt);
      node.textContent = txt;
      return node;
    };
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "64");
    line.setAttribute("y1", "512");
    line.setAttribute("x2", "440");
    line.setAttribute("y2", "512");
    svg.append(
      makeText("2", "737", "436"),
      makeText("18", "48", "908"),
      makeText("5", "159", "366"),
      makeText("θ", "470", "608"),
      line,
    );
    document.body.appendChild(svg);

    const text = extractSemanticSvgLikeText(svg);
    expect(text).toContain("(5)/(18)");
    expect(text).toContain("θ^{2}");
  });

  it("keeps theta as the baseline host for 1/4 θ^2 style options", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const makeText = (txt: string, x: string, y: string) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.setAttribute("x", x);
      node.setAttribute("y", y);
      node.setAttribute("txt", txt);
      node.textContent = txt;
      return node;
    };
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "64");
    line.setAttribute("y1", "512");
    line.setAttribute("x2", "296");
    line.setAttribute("y2", "512");
    svg.append(
      makeText("2", "593", "436"),
      makeText("4", "90", "908"),
      makeText("1", "84", "366"),
      makeText("θ", "326", "608"),
      line,
    );
    document.body.appendChild(svg);

    expect(extractSemanticSvgLikeText(svg)).toContain("(1)/(4)*θ^{2}");
  });

  it("reconstructs z-test statistic with radical denominator", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const makeText = (txt: string, x: string, y: string) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.setAttribute("x", x);
      node.setAttribute("y", y);
      node.setAttribute("txt", txt);
      node.textContent = txt;
      return node;
    };
    const makeLine = (x1: string, y1: string, x2: string, y2: string) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "line");
      node.setAttribute("x1", x1);
      node.setAttribute("y1", y1);
      node.setAttribute("x2", x2);
      node.setAttribute("y2", y2);
      return node;
    };
    svg.append(
      makeText("2", "737", "436"),
      makeText("5", "1659", "934"),
      makeText("/", "1237", "934"),
      makeText("25", "1680", "366"),
      makeText(".", "1584", "366"),
      makeText("3", "1392", "366"),
      makeText("σ", "889", "934"),
      makeText("�?", "1128", "366"),
      makeText("=", "406", "608"),
      makeText("X", "768", "366"),
      makeText("Z", "64", "608"),
      makeLine("1425", "846", "1474", "818"),
      makeLine("1474", "826", "1545", "956"),
      makeLine("1553", "956", "1647", "568"),
      makeLine("1647", "568", "1859", "568"),
      makeLine("712", "512", "2072", "512"),
    );
    document.body.appendChild(svg);

    const text = extractSemanticSvgLikeText(svg);
    expect(text).toContain("Z =");
    expect(text).toContain("X - 3.25");
    expect(text).toContain("(σ)/(�?5))");
  });

  it("reconstructs chi-square statistic with squared numerator and denominator", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const makeText = (txt: string, x: string, y: string) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.setAttribute("x", x);
      node.setAttribute("y", y);
      node.setAttribute("txt", txt);
      node.textContent = txt;
      return node;
    };
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "882");
    line.setAttribute("y1", "576");
    line.setAttribute("x2", "2250");
    line.setAttribute("y2", "576");
    svg.append(
      makeText("2", "1634", "800"),
      makeText("2", "2081", "258"),
      makeText("2", "337", "500"),
      makeText(")", "1694", "430"),
      makeText("1", "1532", "430"),
      makeText("(", "902", "430"),
      makeText("σ", "1325", "972"),
      makeText("χ", "70", "672"),
      makeText("S", "1838", "430"),
      makeText("n", "1040", "430"),
      makeText("�?", "1298", "430"),
      makeText("=", "576", "672"),
      line,
    );
    document.body.appendChild(svg);

    const text = extractSemanticSvgLikeText(svg);
    expect(text).toContain("χ^{2} =");
    expect(text).toContain("((n - 1)*S^{2})/(σ^{2})");
  });

  it("keeps subscripts before superscripts in F-test statistics", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const makeText = (txt: string, x: string, y: string) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.setAttribute("x", x);
      node.setAttribute("y", y);
      node.setAttribute("txt", txt);
      node.textContent = txt;
      return node;
    };
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "320");
    line.setAttribute("y1", "512");
    line.setAttribute("x2", "920");
    line.setAttribute("y2", "512");
    svg.append(
      makeText("F", "64", "608"),
      makeText("=", "220", "608"),
      makeText("S", "400", "430"),
      makeText("1", "520", "470"),
      makeText("2", "562", "258"),
      makeText("S", "400", "972"),
      makeText("2", "520", "1140"),
      makeText("2", "562", "800"),
      line,
    );
    document.body.appendChild(svg);

    const text = extractSemanticSvgLikeText(svg);
    expect(text).toContain("F =");
    expect(text).toContain("(S_{1}^{2})/(S_{2}^{2})");
  });
});






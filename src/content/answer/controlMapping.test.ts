import { describe, expect, it } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { buildControlMapping } from "./controlMapping";

const block = (type: QuestionBlock["questionTypeGuess"], previewText: string): QuestionBlock => ({ id: "q12", bbox: { x: 0, y: 0, width: 800, height: 400 }, previewText, questionTypeGuess: type, hasImage: false, confidence: 1, source: "auto_dom" });

describe("Phase 5 control mapping isolation", () => {
  it("XQ2 narrows a broad wrapper to Q12 and excludes Q13 E/F", () => {
    document.body.innerHTML = '<main><section class="question-item">12. stem <button>A. a</button><button>B. b</button><button>C. c</button><button>D. d</button></section><section class="question-item">13. stem <button>E. e</button><button>F. f</button></section></main>';
    const mapping = buildControlMapping(block("single_choice", "12. stem A. a B. b C. c D. d"), document.querySelector("main")!);
    expect(mapping).toMatchObject({ ok: true });
    if (mapping.ok) expect([...mapping.options.keys()]).toEqual(["A", "B", "C", "D"]);
  });

  it("TXT3 maps explicit blank indices rather than storage order", () => {
    document.body.innerHTML = '<section><span>(1) ___</span><span>(2) ___</span><span>(3) ___</span><input data-blank-index="2"><input data-blank-index="1"><input data-blank-index="3"></section>';
    const mapping = buildControlMapping(block("fill_blank", "(1) ___ (2) ___ (3) ___"), document.querySelector("section")!);
    expect(mapping).toMatchObject({ ok: true, confidence: 0.95 });
    if (mapping.ok) expect(mapping.blanks.map((ref) => ref.blankIndex)).toEqual([0, 1, 2]);
  });

  it("TXT4 keeps anonymous DOM-order-only blanks below automatic-fill confidence", () => {
    document.body.innerHTML = '<section><input><input><input></section>';
    const mapping = buildControlMapping(block("fill_blank", "(1) ___ (2) ___ (3) ___"), document.querySelector("section")!);
    expect(mapping.ok && mapping.confidence).toBeLessThan(0.9);
  });
});

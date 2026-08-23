import { describe, expect, it } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { captureSolveStartControlState, fillParsedAnswerInPage } from "../answerFiller";
import { observeLiveQuestion } from "../liveQuestionObservation";

const result: ParseResult = { blockId: "q1", questionType: "single_choice", answer: "B", confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" };
function base(): QuestionBlock { return { id: "q1", bbox: { x: 0, y: 0, width: 800, height: 300 }, previewText: "1. diagram A. a B. b", questionTypeGuess: "single_choice", hasImage: true, confidence: 1, source: "auto_dom" }; }
function preparedBlock(owner: Element) { return observeLiveQuestion(base(), owner); }

describe("Phase 5 production-path races", () => {
  it("PROD-REV1 uses canonical media identity after a pending provider result", async () => {
    document.body.innerHTML = '<section class="question-item" id="q1">1. diagram <img id="diagram" src="diagram-a.png"><button>A. a</button><button id="b">B. b</button></section>';
    const owner = document.getElementById("q1")!; const block = preparedBlock(owner); let clicks = 0;
    document.getElementById("b")!.addEventListener("click", () => clicks++);
    document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
    captureSolveStartControlState(block);
    const provider = Promise.resolve(result);
    document.getElementById("diagram")!.setAttribute("src", "diagram-b.png");
    const filled = await fillParsedAnswerInPage(block, await provider);
    expect(filled.message).toBe("STALE_ACTION_PLAN"); expect(clicks).toBe(0);
  });

  it("PROD-USR1 preserves a user selection while provider is pending", async () => {
    document.body.innerHTML = '<section class="question-item" id="q1">1. diagram <button>A. a</button><button id="b">B. b</button><button id="c">C. c</button></section>';
    const owner = document.getElementById("q1")!; const block = preparedBlock(owner); let extensionClicks = 0;
    document.getElementById("b")!.addEventListener("click", () => extensionClicks++);
    document.getElementById("c")!.addEventListener("click", () => document.getElementById("c")!.setAttribute("aria-checked", "true"));
    document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
    captureSolveStartControlState(block);
    const provider = Promise.resolve(result); document.getElementById("c")!.click();
    const filled = await fillParsedAnswerInPage(block, await provider);
    expect(filled.message).toBe("USER_STATE_CHANGED"); expect(document.getElementById("c")!.getAttribute("aria-checked")).toBe("true"); expect(extensionClicks).toBe(0);
  });

  it("PROD-REV1B detects a canonical CSS background-image revision", async () => {
    document.body.innerHTML = '<section class="question-item" id="q1" style="background-image:url(diagram-a.png)">1. diagram <button>A. a</button><button id="b">B. b</button></section>';
    const owner = document.getElementById("q1")!; const block = preparedBlock(owner); document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
    captureSolveStartControlState(block); (owner as HTMLElement).style.backgroundImage = "url(diagram-b.png)";
    expect((await fillParsedAnswerInPage(block, result)).message).toBe("STALE_ACTION_PLAN");
  });

  it("PROD-REV2 detects changed canvas bytes with an unchanged canvas element", async () => {
    document.body.innerHTML = '<section class="question-item" id="q1">1. diagram <canvas id="canvas" width="10" height="10"></canvas><button>A. a</button><button id="b">B. b</button></section>';
    const owner = document.getElementById("q1")!; const canvas = document.getElementById("canvas") as HTMLCanvasElement; let bytes = "a";
    Object.defineProperty(canvas, "toDataURL", { configurable: true, value: () => `data:image/png;base64,${bytes}` });
    const block = preparedBlock(owner); document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
    captureSolveStartControlState(block); bytes = "b";
    expect((await fillParsedAnswerInPage(block, result)).message).toBe("STALE_ACTION_PLAN");
  });

  it("PROD-USR2 fails closed when solve-start snapshot cannot be captured", async () => {
    document.body.innerHTML = '<section class="question-item" id="q1">1. diagram <button>A. a</button><button id="b">B. b</button></section>';
    const owner = document.getElementById("q1")!; const block = preparedBlock(owner); let clicks = 0;
    document.getElementById("b")!.addEventListener("click", () => clicks++);
    const original = document.elementsFromPoint;
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: undefined });
    try { captureSolveStartControlState(block); expect((await fillParsedAnswerInPage(block, result, { mode: "auto" })).message).toBe("USER_STATE_SNAPSHOT_UNAVAILABLE"); expect(clicks).toBe(0); }
    finally { Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: original }); }
  });
});

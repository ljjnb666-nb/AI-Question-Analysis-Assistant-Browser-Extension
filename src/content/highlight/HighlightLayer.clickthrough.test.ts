import { afterEach, describe, expect, it, vi} from "vitest";
import { HighlightLayer} from "./HighlightLayer";
import type { QuestionBlock} from "@/shared/types";

afterEach(() => {
document.body.innerHTML = "";
});

function makeBlock(): QuestionBlock {
return {
id: "q1",
bbox: { x: 10, y: 20, width: 300, height: 200},
previewText: "2.新时代党的建设的根本方针是()",
hasImage: false,
questionTypeGuess: "single_choice",
confidence: 0.9,
source: "auto_dom",
};
}

describe("HighlightLayer click-through (2026-10-18 zhihuishu report)", () => {
it("renders the highlight box click-through so page options stay clickable", () => {
const layer = new HighlightLayer();
layer.setBlocks([makeBlock()], new Map([["q1", { status: "pending", selected: false}]]));

const box = document.querySelector("#qs-highlight-layer > div") as HTMLElement;
expect(box).not.toBeNull();
// The box body must not swallow clicks on the underlying question options.
expect(box.style.pointerEvents).toBe("none");
layer.destroy();
});

it("keeps the badge clickable as the selection toggle", () => {
const onSelect = vi.fn();
const layer = new HighlightLayer({ onSelect});
layer.setBlocks([makeBlock()], new Map([["q1", { status: "pending", selected: false}]]));

const box = document.querySelector("#qs-highlight-layer > div") as HTMLElement;
const badge = box.firstElementChild as HTMLElement;
expect(badge).not.toBeNull();
expect(badge.style.pointerEvents).toBe("all");
expect(badge.style.cursor).toBe("pointer");

// Badge clicks bubble to the box listener and toggle selection.
badge.dispatchEvent(new MouseEvent("click", { bubbles: true}));
expect(onSelect).toHaveBeenCalledWith("q1", true);
layer.destroy();
});

it("badge click toggles an already-selected block back off", () => {
const onSelect = vi.fn();
const layer = new HighlightLayer({ onSelect});
layer.setBlocks([makeBlock()], new Map([["q1", { status: "pending", selected: true}]]));

const box = document.querySelector("#qs-highlight-layer > div") as HTMLElement;
const badge = box.firstElementChild as HTMLElement;
badge.dispatchEvent(new MouseEvent("click", { bubbles: true}));
expect(onSelect).toHaveBeenCalledWith("q1", false);
layer.destroy();
});
});

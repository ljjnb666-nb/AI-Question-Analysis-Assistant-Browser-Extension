import { afterEach, describe, expect, it} from "vitest";
import type { QuestionBlock} from "@/shared/types";
import { discoverControls} from "./controlDiscovery";
import { buildControlMapping} from "./controlMapping";

afterEach(() => {
document.body.innerHTML = "";
});

const block = (previewText: string): QuestionBlock => ({
id: "zhihuishu-q2",
bbox: { x: 0, y: 0, width: 800, height: 400},
previewText,
questionTypeGuess: "single_choice",
hasImage: false,
confidence: 1,
source: "auto_dom",
});

/**
* 智慧树 hiexam 考试页结构（2026-10-18 用户实测）：
* Element Plus radio —— 原生 input 透明隐藏（opacity:0），靠外层 label 响应点击。
*/
function zhihuishuQuestion(): string {
const option = (key: string, text: string) => `
<label data-v-68615d01 role="radio" tabindex="-1" class="el-radio">
<span class="el-radio__input">
<span class="el-radio__inner"></span>
<input type="radio" class="el-radio__original" value="${key}" style="opacity: 0; position: absolute; z-index: -1;">
</span>
<span class="el-radio__label"><div data-v-68615d01>${key}.</div><div data-v-68615d01 class="optionContent">${text}</div></span>
</label>`;
return `
<div data-v-68615d01 class="questionBox">
<div data-v-68615d01 class="questionTit">2.(10分)</div>
<div data-v-68615d01 class="questionContent">新时代党的建设的根本方针是（）</div>
<ul data-v-68615d01 class="optionUl">
<div data-v-68615d01 role="radiogroup" class="el-radio-group">
${option("A", "坚持党要管党、全面从严治党")}
${option("B", "坚持以政治建设为统领")}
${option("C", "坚持全心全意为人民服务")}
${option("D", "坚持自我革命")}
</div>
</ul>
</div>`;
}

describe("zhihuishu Element Plus choice (2026-10-18)", () => {
it("discovers the visible labels as proxy controls, not the opacity:0 inputs", () => {
document.body.innerHTML = zhihuishuQuestion();
const owner = document.querySelector(".questionBox")!;
const controls = discoverControls(owner);
const options = controls.filter((c) => c.controlType === "custom-choice" || c.controlType === "radio");
// 4 labels as custom-choice; the 4 hidden inputs must not appear as controls.
expect(options).toHaveLength(4);
for (const c of options) {
expect(c.element.tagName).toBe("LABEL");
expect(c.element.classList.contains("el-radio")).toBe(true);
expect(c.visible).toBe(true);
}
expect(controls.some((c) => c.element.classList?.contains("el-radio__original"))).toBe(false);
});

it("maps A/B/C/D options from the Element Plus labels", () => {
document.body.innerHTML = zhihuishuQuestion();
const owner = document.querySelector(".questionBox")!;
const mapping = buildControlMapping(
block("2.(10分) 新时代党的建设的根本方针是（） A. 坚持党要管党、全面从严治党 B. 坚持以政治建设为统领 C. 坚持全心全意为人民服务 D. 坚持自我革命"),
owner,
);
expect(mapping).toMatchObject({ ok: true});
if (mapping.ok) {
expect([...mapping.options.keys()].sort()).toEqual(["A", "B", "C", "D"]);
const refB = mapping.options.get("B")!;
expect(refB.controlType).toBe("custom-choice");
// Clicking the label natively activates the hidden input.
expect(refB.optionKey).toBe("B");
}
});

it("still prefers a visible native input over its wrapper (no duplicate)", () => {
document.body.innerHTML = `
<div class="q"><label role="radio"><input type="radio" name="g1">A. one</label>
<label role="radio"><input type="radio" name="g1">B. two</label></div>`;
const owner = document.querySelector(".q")!;
const mapping = buildControlMapping(block("q A. one B. two"), owner);
expect(mapping).toMatchObject({ ok: true});
if (mapping.ok) {
expect([...mapping.options.keys()].sort()).toEqual(["A", "B"]);
// Native inputs registered directly; wrappers skipped to avoid duplicates.
for (const ref of mapping.options.values()) expect(ref.controlType).toBe("radio");
}
});

it("skips the wrapper when the inner input is disabled", () => {
document.body.innerHTML = `
<div class="q"><label role="radio" class="el-radio"><span class="el-radio__input">
<input type="radio" class="el-radio__original" disabled style="opacity: 0; position: absolute;"></span>
<span class="el-radio__label">A. one</span></label></div>`;
const owner = document.querySelector(".q")!;
const mapping = buildControlMapping(block("q A. one"), owner);
if (mapping.ok) expect(mapping.options.size).toBe(0);
});
});

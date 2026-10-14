import { afterEach, describe, expect, it } from "vitest";
import { detectCandidatesInViewport } from "../domDetector";
import { chaoxingTypeFromTypename } from "./chaoxing";

function setRect(element: Element, rect: { left: number; top: number; width: number; height: number }): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => rect }),
  });
}

function setChaoxingPage(): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL("https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?courseId=1"),
  });
}

afterEach(() => { document.body.innerHTML = ""; });

describe("chaoxing adapter", () => {
  it("detects a 简答题 .questionLi as short_answer (not fill_blank)", () => {
    setChaoxingPage();
    document.body.innerHTML = `
      <div class="padBom50 questionLi fontLabel singleQuesId" typename="其它" id="question406016455" data="406016455" tabindex="0" role="option" aria-label="题目 1. ">
        <h3 class="mark_name colorDeep fontLabel workTextWrap">1.<span class="colorShallow">(其它)</span></h3>
        <div>
          <p>请根据所学知识，撰写一份产品开发设计方案，要求包含以下内容：</p>
          <p>一、产品定位与目标用户分析；二、核心功能设计；三、技术实现方案。</p>
          <p>字数要求不少于500字，内容完整、逻辑清晰。</p>
        </div>
        <div class="stem_answer">
          <div class="eidtDiv">
            <div id="edui1"><div class="edui-toolbar">清除格式 加粗 斜体 下划线 字体颜色 对齐 插入表格 插入图片 附件 录音 拍照上传 画板 导入word</div></div>
            <textarea id="answer406016455" name="answer406016455" style="display:none"></textarea>
            <input type="hidden" id="answertype406016455" value="8">
          </div>
        </div>
      </div>`;
    const block = document.querySelector(".questionLi") as HTMLElement;
    setRect(block, { left: 100, top: 120, width: 900, height: 600 });
    setRect(document.body, { left: 0, top: 0, width: 1600, height: 900 });

    const found = detectCandidatesInViewport();
    expect(found).toHaveLength(1);
    expect(found[0].questionTypeGuess).toBe("short_answer");
    expect(found[0].previewText).toContain("产品开发设计方案");
    // UEditor toolbar noise must not leak into the preview.
    expect(found[0].previewText).not.toContain("清除格式");
  });

  it("maps typename to question types", () => {
    expect(chaoxingTypeFromTypename("单选题", "")).toBe("single_choice");
    expect(chaoxingTypeFromTypename("多选题", "")).toBe("multi_choice");
    expect(chaoxingTypeFromTypename("判断题", "")).toBe("judge");
    expect(chaoxingTypeFromTypename("填空题", "")).toBe("fill_blank");
    expect(chaoxingTypeFromTypename("其它", "")).toBe("short_answer");
    expect(chaoxingTypeFromTypename("简答题", "")).toBe("short_answer");
  });

  it("hidden editor textareas no longer count as blank controls on generic pages", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://example.com/quiz"),
    });
    document.body.innerHTML = `
      <div class="question-card">
        <p>3. 请简述 TCP 三次握手的过程，并说明每次握手的作用，分析其在可靠网络通信中的意义。</p>
        <div class="answer-editor"><textarea style="display:none"></textarea></div>
      </div>`;
    const card = document.querySelector(".question-card") as HTMLElement;
    setRect(card, { left: 100, top: 120, width: 900, height: 400 });
    setRect(document.body, { left: 0, top: 0, width: 1600, height: 900 });

    const found = detectCandidatesInViewport();
    expect(found.length).toBeGreaterThan(0);
    // Must not be flipped to fill_blank by the hidden textarea.
    expect(found[0].questionTypeGuess).not.toBe("fill_blank");
  });
});

describe("chaoxing adapter regression (2026-10-14 device test)", () => {
  function setTallChaoxingFixture(): { block: HTMLElement; answer: HTMLElement } {
    setChaoxingPage();
    document.body.innerHTML = `
      <div class="padBom50 questionLi fontLabel singleQuesId" typename="其它" id="question406016455" data="406016455" tabindex="0" role="option" aria-label="题目 1. ">
        <h3 class="mark_name colorDeep fontLabel workTextWrap">1.<span class="colorShallow">(其它)</span></h3>
        <div><p>请撰写一份产品开发设计方案，字数不少于500字，条理清晰。</p></div>
        <div class="stem_answer">
          <div class="eidtDiv">
            <div id="edui1"><div class="edui-toolbar">清除格式 加粗 斜体</div></div>
            <textarea id="answer406016455" style="display:none"></textarea>
          </div>
        </div>
      </div>`;
    const block = document.querySelector(".questionLi") as HTMLElement;
    const answer = document.querySelector(".stem_answer") as HTMLElement;
    // Tall stem (1600) + editor (300): total element 1900, viewport 900.
    setRect(block, { left: 100, top: 120, width: 900, height: 1900 });
    setRect(answer, { left: 100, top: 1720, width: 900, height: 300 });
    setRect(document.body, { left: 0, top: 0, width: 1600, height: 900 });
    return { block, answer };
  }

  it("bbox covers the stem only, excluding the .stem_answer editor area", () => {
    setTallChaoxingFixture();
    const found = detectCandidatesInViewport();
    expect(found).toHaveLength(1);
    // Stem is 120..1720; the editor (1720..2020) must not be boxed.
    expect(found[0].bbox.y).toBe(120);
    expect(found[0].bbox.y + found[0].bbox.height).toBeLessThanOrEqual(1720);
  });

  it("bbox is the full unclamped stem (full-page slices merge instead of partial boxes)", () => {
    setTallChaoxingFixture();
    const found = detectCandidatesInViewport();
    expect(found).toHaveLength(1);
    // Full stem height 1600 — must NOT be clamped to the 900px viewport.
    expect(found[0].bbox.height).toBe(1600);
  });

  it("identity round-trips: authority check passes (no false 页面已变化)", async () => {
    setTallChaoxingFixture();
    const { isCurrentRuntimeQuestionBlock } = await import("../../liveQuestionObservation");
    const found = detectCandidatesInViewport();
    expect(found).toHaveLength(1);
    const b = found[0] as unknown as Record<string, unknown>;
    expect(b["identityObservationSource"]).toBe("structured");
    expect(b["runtimeQuestionHandle"]).toBeTruthy();
    expect(isCurrentRuntimeQuestionBlock(found[0])).toBe(true);
  });
});

describe("chaoxing adapter media scoping (2026-10-14 device test)", () => {
  it("drops editor-toolbar false-positive media on text-only questions", () => {
    setChaoxingPage();
    document.body.innerHTML = `
      <div class="padBom50 questionLi fontLabel singleQuesId" typename="其它" id="question406016455" data="406016455">
        <h3 class="mark_name">1.(其它)</h3>
        <div><p>请撰写一份产品开发设计方案，字数不少于500字。</p></div>
        <div class="stem_answer">
          <div class="eidtDiv">
            <div id="edui1"><div class="edui-toolbar">
              <img class="edui-icon edui-for-bold" src="https://chaoxing.com/ueditor/icons.png" width="20" height="20">
            </div></div>
            <textarea id="answer406016455" style="display:none"></textarea>
          </div>
        </div>
      </div>`;
    const block = document.querySelector(".questionLi") as HTMLElement;
    setRect(block, { left: 100, top: 120, width: 900, height: 600 });
    setRect(document.body, { left: 0, top: 0, width: 1600, height: 900 });

    const found = detectCandidatesInViewport();
    expect(found).toHaveLength(1);
    // Toolbar chrome must not mark a text question as having an image —
    // otherwise parsing hard-fails fetching a non-existent "question image".
    expect(found[0].hasImage).toBe(false);
    expect(found[0].mediaAssets ?? []).toHaveLength(0);
  });

  it("keeps real stem images", () => {
    setChaoxingPage();
    document.body.innerHTML = `
      <div class="padBom50 questionLi fontLabel singleQuesId" typename="其它" id="question1" data="1">
        <h3 class="mark_name">1.(其它)</h3>
        <div><p>请根据下图描述电路的工作原理，字数不少于100字。</p><img src="https://chaoxing.com/question/circuit.png" width="300" height="200"></div>
        <div class="stem_answer"><div class="eidtDiv"><textarea style="display:none"></textarea></div></div>
      </div>`;
    const block = document.querySelector(".questionLi") as HTMLElement;
    setRect(block, { left: 100, top: 120, width: 900, height: 600 });
    const img = block.querySelector("img") as HTMLImageElement;
    setRect(img, { left: 120, top: 300, width: 300, height: 200 });
    setRect(document.body, { left: 0, top: 0, width: 1600, height: 900 });

    const found = detectCandidatesInViewport();
    expect(found).toHaveLength(1);
    expect(found[0].hasImage).toBe(true);
  });
});

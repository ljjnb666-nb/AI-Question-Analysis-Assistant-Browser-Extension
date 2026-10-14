import { afterEach, describe, expect, it } from "vitest";
import { discoverControls } from "./controlDiscovery";

afterEach(() => { document.body.innerHTML = ""; });

function mockVisible(el: Element): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }),
  });
}

describe("controlDiscovery iframe editors (2026-10-14 device test)", () => {
  it("discovers the UEditor iframe body as a fillable control", () => {
    document.body.innerHTML = `
      <div class="questionLi" typename="其它">
        <h3>1. 简答题</h3>
        <div class="stem_answer">
          <div class="eidtDiv">
            <iframe id="ueditor_0" title="ueditor"></iframe>
            <textarea id="answer1" style="display:none"></textarea>
          </div>
        </div>
      </div>`;
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    mockVisible(iframe);
    // jsdom: no layout engine; emulate the editor document manually.
    const editorDoc = document.implementation.createHTMLDocument("editor");
    editorDoc.body.innerHTML = "<p><br></p>";
    Object.defineProperty(editorDoc.body, "isContentEditable", { configurable: true, value: true });
    Object.defineProperty(iframe, "contentDocument", { configurable: true, value: editorDoc });
    mockVisible(editorDoc.body);

    const owner = document.querySelector(".questionLi") as HTMLElement;
    const found = discoverControls(owner);
    const editor = found.find((c) => c.element === editorDoc.body);
    expect(editor).toBeDefined();
    expect(editor?.controlType).toBe("contenteditable");
    expect(editor?.visible).toBe(true);
  });

  it("ignores non-editor iframes", () => {
    document.body.innerHTML = `
      <div class="questionLi">
        <h3>1. 题目</h3>
        <iframe id="ad-frame" src="https://ads.example.com"></iframe>
      </div>`;
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const otherDoc = document.implementation.createHTMLDocument("ad");
    otherDoc.body.innerHTML = "<p>ad</p>";
    Object.defineProperty(iframe, "contentDocument", { configurable: true, value: otherDoc });

    const owner = document.querySelector(".questionLi") as HTMLElement;
    const found = discoverControls(owner);
    expect(found.find((c) => c.element === otherDoc.body)).toBeUndefined();
  });

  it("skips cross-origin iframes without throwing", () => {
    document.body.innerHTML = `
      <div class="questionLi">
        <h3>1. 题目</h3>
        <iframe id="ueditor_9"></iframe>
      </div>`;
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get() { throw new Error("cross-origin"); },
    });
    const owner = document.querySelector(".questionLi") as HTMLElement;
    expect(() => discoverControls(owner)).not.toThrow();
  });
});

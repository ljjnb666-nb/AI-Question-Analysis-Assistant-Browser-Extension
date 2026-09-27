import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFormulaEmbedFallback } from "./formulaEmbedFallback";

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn(() => { this.disconnected = true; });
  disconnected = false;

  constructor(private readonly callback: MutationCallback) {
    FakeMutationObserver.instances.push(this);
  }

  deliverAdded(node: Element) {
    this.callback([{ addedNodes: [node] } as unknown as MutationRecord], this as unknown as MutationObserver);
  }
}

describe("formula fallback runtime lifecycle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    FakeMutationObserver.instances = [];
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("P10B-FORMULA-01 disconnects and restores runtime-owned formula DOM", () => {
    document.body.innerHTML = '<div id="stem"><embed id="formula" data-latex="x%5E2" style="display: inline" /><b id="page-content">keep</b></div>';
    const formula = document.getElementById("formula") as HTMLEmbedElement;
    const dispose = installFormulaEmbedFallback("example.zhihuishu.com");
    const observer = FakeMutationObserver.instances[0]!;

    expect(observer.disconnected).toBe(false);
    expect(document.querySelector('[data-qs-formula-fallback]')?.textContent).toBe("x^2");
    expect(formula.style.display).toBe("none");

    dispose();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(formula.style.display).toBe("inline");
    expect(formula.hasAttribute("data-qs-formula-fallback-id")).toBe(false);
    expect(formula.hasAttribute("data-qs-formula-hidden")).toBe(false);
    expect(formula.hasAttribute("data-qs-formula-processed")).toBe(false);
    expect(document.querySelector('[data-qs-formula-fallback]')).toBeNull();
    expect(document.getElementById("page-content")?.textContent).toBe("keep");

    const lateEmbed = document.createElement("embed");
    lateEmbed.setAttribute("data-latex", "y%5E2");
    document.body.append(lateEmbed);
    observer.deliverAdded(lateEmbed);
    expect(lateEmbed.hasAttribute("data-qs-formula-processed")).toBe(false);
    expect(document.querySelector('[data-qs-formula-fallback]')).toBeNull();
  });

  it("restores a page-authored fallback instead of removing or replacing it", () => {
    document.body.innerHTML = `
      <div>
        <embed id="formula" data-latex="x%5E2" data-qs-formula-fallback-id="page-id" style="display: inline" />
        <span data-qs-formula-fallback="page-id" style="color: red">page-owned</span>
      </div>`;
    const formula = document.getElementById("formula") as HTMLEmbedElement;
    const fallback = document.querySelector<HTMLElement>('[data-qs-formula-fallback="page-id"]')!;
    const beforeStyle = fallback.getAttribute("style");
    const dispose = installFormulaEmbedFallback("zhihuishu.com");

    expect(fallback.textContent).toBe("x^2");
    dispose();
    expect(fallback.isConnected).toBe(true);
    expect(fallback.textContent).toBe("page-owned");
    expect(fallback.getAttribute("style")).toBe(beforeStyle);
    expect(formula.style.display).toBe("inline");
    expect(formula.getAttribute("data-qs-formula-fallback-id")).toBe("page-id");
  });
});

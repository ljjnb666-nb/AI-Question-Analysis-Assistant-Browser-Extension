import { describe, expect, it } from "vitest";
import { TOP_ROOT_KEY, MAX_ACCESSIBLE_ROOTS, questionInstanceKey } from "./rootContext";
import { framePointToParentViewport, framePointToTopViewport, getAccessibleFrameDocument, topViewportPointToFrame, getOwnerWindow, getComputedStyleFor } from "./rootDom";
import { AccessibleRootRegistry } from "./rootRegistry";

function stubRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  Object.defineProperty(el, "getBoundingClientRect", { configurable: true, value: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }) });
}

describe("rootDom helpers", () => {
  it("exposes same-origin frame documents and fails closed on inaccessible frames", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    try {
      const doc = getAccessibleFrameDocument(iframe);
      expect(doc).toBeTruthy();
      expect(doc!.nodeType).toBe(9);
    } finally {
      iframe.remove();
    }
    const detached = document.createElement("iframe");
    // happy-dom exposes contentDocument even detached; a cross-origin frame is
    // simulated by a sealed proxy that throws on access.
    const hostile = new Proxy(detached, {
      get(target, prop) {
        if (prop === "contentDocument" || prop === "contentWindow") throw new Error("cross-origin");
        return Reflect.get(target, prop);
      },
    });
    expect(getAccessibleFrameDocument(hostile as unknown as HTMLIFrameElement)).toBeNull();
  });

  it("uses the element's own owner window for computed styles", () => {
    const el = document.createElement("div");
    document.body.append(el);
    try {
      expect(getOwnerWindow(el)).toBe(window);
      expect(getComputedStyleFor(el)).toBeInstanceOf(CSSStyleDeclaration);
    } finally {
      el.remove();
    }
  });

  it("FRAME-COORD-2 transforms nested same-origin frame points to top viewport coordinates", () => {
    const outer = document.createElement("iframe");
    document.body.append(outer);
    const outerDoc = outer.contentDocument!;
    const inner = outerDoc.createElement("iframe");
    outerDoc.body.append(inner);
    try {
      stubRect(outer, { left: 100, top: 50, width: 600, height: 400 });
      Object.defineProperty(outer, "clientWidth", { configurable: true, value: 600 });
      Object.defineProperty(outer, "clientHeight", { configurable: true, value: 400 });
      Object.defineProperty(outer, "offsetWidth", { configurable: true, value: 600 });
      Object.defineProperty(outer, "offsetHeight", { configurable: true, value: 400 });
      Object.defineProperty(outer, "clientLeft", { configurable: true, value: 0 });
      Object.defineProperty(outer, "clientTop", { configurable: true, value: 0 });

      stubRect(inner, { left: 10, top: 20, width: 300, height: 200 });
      Object.defineProperty(inner, "clientWidth", { configurable: true, value: 300 });
      Object.defineProperty(inner, "clientHeight", { configurable: true, value: 200 });
      Object.defineProperty(inner, "offsetWidth", { configurable: true, value: 300 });
      Object.defineProperty(inner, "offsetHeight", { configurable: true, value: 200 });
      Object.defineProperty(inner, "clientLeft", { configurable: true, value: 0 });
      Object.defineProperty(inner, "clientTop", { configurable: true, value: 0 });

      // Inner-local (5, 5) → outer (15, 25) → top (115, 75). happy-dom does
      // not implement window.frameElement, so the parent chain is injected —
      // production resolves it through the root registry / standard DOM.
      const parentResolver = (doc: Document): HTMLIFrameElement | null =>
        doc === document ? null : doc === outerDoc ? outer : inner.ownerDocument === doc ? inner : null;
      const top = framePointToTopViewport(inner, { x: 5, y: 5 }, parentResolver);
      expect(top).toMatchObject({ ok: true, point: { x: 115, y: 75 }, scale: 1 });

      const back = topViewportPointToFrame(inner, { x: 115, y: 75 }, parentResolver);
      expect(back).toMatchObject({ ok: true, point: { x: 5, y: 5 } });
    } finally {
      inner.remove();
      outer.remove();
    }
  });

  it("FRAME-COORD-3 accepts a finite positive uniform scale", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    try {
      stubRect(iframe, { left: 40, top: 40, width: 600, height: 400 });
      Object.defineProperty(iframe, "clientWidth", { configurable: true, value: 300 });
      Object.defineProperty(iframe, "clientHeight", { configurable: true, value: 200 });
      Object.defineProperty(iframe, "offsetWidth", { configurable: true, value: 300 });
      Object.defineProperty(iframe, "offsetHeight", { configurable: true, value: 200 });
      Object.defineProperty(iframe, "clientLeft", { configurable: true, value: 0 });
      Object.defineProperty(iframe, "clientTop", { configurable: true, value: 0 });

      // Rendered 600x400 for 300x200 content units → uniform 2x scale.
      const scaled = framePointToParentViewport(iframe, { x: 10, y: 10 });
      expect(scaled).toMatchObject({ ok: true, scale: 2, point: { x: 60, y: 60 } });

    } finally {
      iframe.remove();
    }
  });

  it("FRAME-COORD-4 rejects non-uniform transforms in both directions", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    try {
      stubRect(iframe, { left: 40, top: 40, width: 600, height: 400 });
      Object.defineProperty(iframe, "clientWidth", { configurable: true, value: 300 });
      Object.defineProperty(iframe, "clientHeight", { configurable: true, value: 200 });
      Object.defineProperty(iframe, "offsetWidth", { configurable: true, value: 300 });
      Object.defineProperty(iframe, "offsetHeight", { configurable: true, value: 400 });
      Object.defineProperty(iframe, "clientLeft", { configurable: true, value: 0 });
      Object.defineProperty(iframe, "clientTop", { configurable: true, value: 0 });

      expect(framePointToTopViewport(iframe, { x: 10, y: 10 })).toMatchObject({ ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" });
      expect(topViewportPointToFrame(iframe, { x: 60, y: 60 })).toMatchObject({ ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" });
    } finally {
      iframe.remove();
    }
  });

  it("FRAME-COORD-5 rejects detached frames in both directions", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    iframe.remove();

    expect(framePointToTopViewport(iframe, { x: 1, y: 1 })).toMatchObject({ ok: false, reason: "DETACHED_FRAME" });
    expect(topViewportPointToFrame(iframe, { x: 1, y: 1 })).toMatchObject({ ok: false, reason: "DETACHED_FRAME" });
  });

  it("FRAME-COORD-1 transforms a single frame offset in the forward direction", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    try {
      stubRect(iframe, { left: 100, top: 50, width: 300, height: 200 });
      Object.defineProperty(iframe, "clientWidth", { configurable: true, value: 300 });
      Object.defineProperty(iframe, "clientHeight", { configurable: true, value: 200 });
      Object.defineProperty(iframe, "offsetWidth", { configurable: true, value: 300 });
      Object.defineProperty(iframe, "offsetHeight", { configurable: true, value: 200 });
      Object.defineProperty(iframe, "clientLeft", { configurable: true, value: 0 });
      Object.defineProperty(iframe, "clientTop", { configurable: true, value: 0 });

      expect(framePointToTopViewport(iframe, { x: 12, y: 24 })).toMatchObject({ ok: true, point: { x: 112, y: 74 } });
    } finally {
      iframe.remove();
    }
  });

  it("FRAME-COORD-6 round-trips nested coordinates within floating-point tolerance", () => {
    const outer = document.createElement("iframe");
    document.body.append(outer);
    const outerDoc = outer.contentDocument!;
    const inner = outerDoc.createElement("iframe");
    outerDoc.body.append(inner);
    try {
      stubRect(outer, { left: 100, top: 50, width: 600, height: 400 });
      stubRect(inner, { left: 10, top: 20, width: 300, height: 200 });
      for (const [frame, width, height] of [[outer, 600, 400], [inner, 300, 200]] as const) {
        Object.defineProperty(frame, "clientWidth", { configurable: true, value: width });
        Object.defineProperty(frame, "clientHeight", { configurable: true, value: height });
        Object.defineProperty(frame, "offsetWidth", { configurable: true, value: width });
        Object.defineProperty(frame, "offsetHeight", { configurable: true, value: height });
        Object.defineProperty(frame, "clientLeft", { configurable: true, value: 0 });
        Object.defineProperty(frame, "clientTop", { configurable: true, value: 0 });
      }
      const parentResolver = (doc: Document): HTMLIFrameElement | null =>
        doc === document ? null : doc === outerDoc ? outer : inner.ownerDocument === doc ? inner : null;
      const local = { x: 13.25, y: 27.75 };
      const top = framePointToTopViewport(inner, local, parentResolver);
      expect(top.ok).toBe(true);
      if (!top.ok) return;
      const back = topViewportPointToFrame(inner, top.point, parentResolver);
      expect(back.ok).toBe(true);
      if (!back.ok) return;
      expect(Math.abs(back.point.x - local.x)).toBeLessThan(0.01);
      expect(Math.abs(back.point.y - local.y)).toBeLessThan(0.01);
    } finally {
      inner.remove();
      outer.remove();
    }
  });
});

describe("AccessibleRootRegistry", () => {
  it("registers the top document, same-origin frames and open shadow roots with generations", () => {
    const registry = new AccessibleRootRegistry();
    const events = registry.reconcile(document);
    expect(events).toMatchObject({ addedRootKeys: [], removedRootKeys: [], budgetExceeded: false });
    expect(registry.get(TOP_ROOT_KEY)?.kind).toBe("top-document");

    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const host = document.createElement("my-widget");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(document.createElement("div"));
    try {
      // Production marks mutated roots dirty (host insertion fires a mutation).
      const discovered = registry.reconcile(document, new Set([TOP_ROOT_KEY]));
      expect(discovered.addedRootKeys).toHaveLength(2);
      const frameRoot = registry.list().find((root) => root.kind === "same-origin-frame")!;
      expect(frameRoot.frameElement).toBe(iframe);
      expect(frameRoot.parentRootKey).toBe(TOP_ROOT_KEY);

      // Stable across reconciles while connected.
      expect(registry.reconcile(document).addedRootKeys).toHaveLength(0);

      // Same iframe element, replaced document → same key, new generation.
      // The replacement document keeps the frame's original window, exactly
      // like a real same-origin navigation.
      const frameKey = frameRoot.rootKey;
      const originalWindow = (iframe as { contentWindow: Window }).contentWindow;
      const newDoc = document.implementation.createHTMLDocument("reloaded");
      Object.defineProperty(newDoc, "defaultView", { configurable: true, value: originalWindow });
      Object.defineProperty(iframe, "contentDocument", { configurable: true, value: newDoc });
      const replaced = registry.reconcile(document);
      expect(replaced.replacedRootKeys).toEqual([frameKey]);
      expect(registry.get(frameKey)!.rootGeneration).toBe(2);

      // Removed iframe prunes its root.
      iframe.remove();
      const removed = registry.reconcile(document);
      expect(removed.removedRootKeys).toContain(frameKey);
      expect(registry.get(frameKey)).toBeUndefined();

      // Host removal prunes the shadow root.
      host.remove();
      const shadowRemoved = registry.reconcile(document);
      expect(shadowRemoved.removedRootKeys).toHaveLength(1);
      expect(registry.list().filter((root) => root.kind === "open-shadow-root")).toHaveLength(0);
    } finally {
      iframe.remove();
      host.remove();
    }
  });

  it("FRAME-8 never registers cross-origin frames and never throws", () => {
    const registry = new AccessibleRootRegistry();
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => { throw new Error("cross-origin access denied"); } });
    Object.defineProperty(iframe, "contentWindow", { configurable: true, get: () => { throw new Error("cross-origin access denied"); } });
    document.body.append(iframe);
    try {
      const events = registry.reconcile(document);
      expect(events.addedRootKeys).toHaveLength(0);
      expect(registry.list().filter((root) => root.kind === "same-origin-frame")).toHaveLength(0);
    } finally {
      iframe.remove();
      registry.reconcile(document);
    }
  });

  it("enforces the root count budget and reports it without wrong-filling", () => {
    const registry = new AccessibleRootRegistry();
    const iframes: HTMLIFrameElement[] = [];
    for (let index = 0; index < MAX_ACCESSIBLE_ROOTS + 4; index += 1) {
      const iframe = document.createElement("iframe");
      document.body.append(iframe);
      iframes.push(iframe);
    }
    try {
      const events = registry.reconcile(document);
      expect(events.budgetExceeded).toBe(true);
      expect(registry.list().filter((root) => root.kind === "same-origin-frame").length).toBeLessThanOrEqual(MAX_ACCESSIBLE_ROOTS - 1);
    } finally {
      for (const iframe of iframes) iframe.remove();
      registry.reconcile(document);
    }
  });

  it("keys runtime question instances by root", () => {
    expect(questionInstanceKey("root-frame-1", "q_v1_abc")).not.toBe(questionInstanceKey(TOP_ROOT_KEY, "q_v1_abc"));
  });
});

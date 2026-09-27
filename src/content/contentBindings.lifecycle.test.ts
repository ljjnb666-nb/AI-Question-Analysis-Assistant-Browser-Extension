import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeContentBindings } from "./contentBindings";

describe("content binding lifecycle", () => {
  let originalViewport: PropertyDescriptor | undefined;
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
    else Reflect.deleteProperty(window, "visualViewport");
    originalViewport = undefined;
  });

  it("P10B-BINDINGS-01 removes one owned handler set across shutdown and reboot", () => {
    const viewport = new EventTarget();
    originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    const addedDocument: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];
    const removedDocument: Array<[string, EventListenerOrEventListenerObject, boolean | EventListenerOptions | undefined]> = [];
    const addDocument = vi.spyOn(document, "addEventListener").mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      addedDocument.push([type, listener, options]);
    }) as typeof document.addEventListener);
    vi.spyOn(document, "removeEventListener").mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
      removedDocument.push([type, listener, options]);
    }) as typeof document.removeEventListener);
    const addedWindow: Array<[string, EventListenerOrEventListenerObject]> = [];
    const removedWindow: Array<[string, EventListenerOrEventListenerObject]> = [];
    vi.spyOn(window, "addEventListener").mockImplementation(((type: string, listener: EventListenerOrEventListenerObject) => {
      addedWindow.push([type, listener]);
    }) as typeof window.addEventListener);
    vi.spyOn(window, "removeEventListener").mockImplementation(((type: string, listener: EventListenerOrEventListenerObject) => {
      removedWindow.push([type, listener]);
    }) as typeof window.removeEventListener);
    const addViewport = vi.spyOn(viewport, "addEventListener");
    const removeViewport = vi.spyOn(viewport, "removeEventListener");
    const startManualCapture = vi.fn();
    const handleAutoDetect = vi.fn();
    const scheduleHighlightRelayoutRescan = vi.fn();
    const floatingMgr = {
      init: vi.fn(),
      setOnRetake: vi.fn(),
      setOnUpgradeVision: vi.fn(),
    };
    const deps = {
      floatingMgr: floatingMgr as never,
      handleAutoDetect,
      installFormulaEmbedFallback: vi.fn(() => vi.fn()),
      logEvent: vi.fn(),
      scheduleHighlightRelayoutRescan,
      startManualCapture,
    };

    const disposeA = initializeContentBindings(deps);
    expect(addedDocument.filter(([type]) => type === "keydown")).toHaveLength(1);
    expect(addedDocument.filter(([type]) => type === "scroll")).toHaveLength(1);
    expect(addedWindow.filter(([type]) => type === "resize")).toHaveLength(1);
    expect(addViewport.mock.calls.map(([type]) => type)).toEqual(["resize", "scroll"]);
    disposeA();

    const disposeB = initializeContentBindings(deps);
    expect(addedDocument.filter(([type]) => type === "keydown")).toHaveLength(2);
    expect(addedDocument.filter(([type]) => type === "scroll")).toHaveLength(2);
    expect(addedWindow.filter(([type]) => type === "resize")).toHaveLength(2);
    expect(addViewport).toHaveBeenCalledTimes(4);
    disposeB();

    const keydownHandlers = addedDocument.filter(([type]) => type === "keydown");
    const scrollHandlers = addedDocument.filter(([type]) => type === "scroll");
    const resizeHandlers = addedWindow.filter(([type]) => type === "resize");
    const latestKeydown = keydownHandlers[keydownHandlers.length - 1]![1] as EventListener;
    const latestScroll = scrollHandlers[scrollHandlers.length - 1]![1];
    const latestResize = resizeHandlers[resizeHandlers.length - 1]![1];
    expect(removedDocument).toEqual(expect.arrayContaining([
      ["keydown", addedDocument[0]![1], undefined],
      ["scroll", addedDocument[1]![1], true],
      ["keydown", latestKeydown, undefined],
      ["scroll", latestScroll, true],
    ]));
    expect(removedWindow).toContainEqual(["resize", addedWindow[0]![1]]);
    expect(removedWindow).toContainEqual(["resize", latestResize]);
    expect(removeViewport).toHaveBeenCalledTimes(4);
    expect(removeViewport.mock.calls.map(([type, listener]) => [type, listener]))
      .toEqual(addViewport.mock.calls.map(([type, listener]) => [type, listener]));
    expect(deps.installFormulaEmbedFallback).toHaveBeenCalledTimes(2);
    expect(addDocument).toHaveBeenCalled();
  });
});

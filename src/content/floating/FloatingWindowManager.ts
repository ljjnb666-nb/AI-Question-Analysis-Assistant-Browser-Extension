/**
 * FloatingWindowManager (M3+)
 * - Shadow DOM style isolation
 * - Reuses the same React root across captures (no unmount/remount)
 * - Re-reads saved position on every open() so position memory works correctly
 * - Exposes upgradeToVision() for low-confidence switch suggestion
 */

import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import React from "react";
import { FloatingWindow } from "./FloatingWindow";
import type { FloatingWindowState, ParseResult, QuestionBlock } from "@/shared/types";
import { getDefaultFloatingState } from "@/shared/types";
import { loadFloatingState, saveFloatingState } from "@/shared/utils/storage";
import { clampToViewport } from "@/shared/utils/bbox";
import { logEvent } from "@/shared/utils/analytics";

const HOST_ID = "qs-floating-host";

export class FloatingWindowManager {
  private host: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private root: Root | null = null;

  // Persisted across captures — never reset unless user closes
  private state: FloatingWindowState = getDefaultFloatingState();

  private currentBlock: QuestionBlock | null = null;
  private currentResult: ParseResult | null = null;
  private currentError: string | null = null;
  private streamingText: string | null = null;
  private loading = false;
  private suggestVision = false;

  private onRetakeCallback?: () => void;
  private onUpgradeVisionCallback?: () => void;
  private disposed = false;
  private openSequence = 0;
  private readonly delayedCallbacks = new Set<number>();

  /** Call once at content script startup */
  async init() {
    if (this.disposed) return;
    const defaults = getDefaultFloatingState();
    const saved = await loadFloatingState();
    if (this.disposed) return;
    const clamped = clampToViewport(
      saved.x ?? defaults.x,
      saved.y ?? defaults.y,
      saved.width ?? defaults.width,
      saved.height ?? defaults.height
    );
    this.state = { ...defaults, ...saved, x: clamped.x, y: clamped.y };
    // Pre-build the host so it's ready instantly on first open
    this.ensureHost();
  }

  setOnRetake(cb: () => void) { this.onRetakeCallback = cb; }
  setOnUpgradeVision(cb: () => void) { this.onUpgradeVisionCallback = cb; }

  /** Remove the runtime-owned host and make every outstanding callback inert. */
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.openSequence += 1;
    for (const timer of this.delayedCallbacks) window.clearTimeout(timer);
    this.delayedCallbacks.clear();
    this.onRetakeCallback = undefined;
    this.onUpgradeVisionCallback = undefined;
    this.currentBlock = null;
    this.currentResult = null;
    this.currentError = null;
    this.streamingText = null;
    this.loading = false;
    this.root?.unmount();
    this.root = null;
    this.host?.remove();
    this.host = null;
    this.shadowRoot = null;
  }

  /** Read-only lifecycle seams for deterministic tests. */
  get isDisposed() { return this.disposed; }
  get hasOwnedRoot() { return this.root !== null; }

  /** Open/reuse window for a new capture — does NOT destroy existing root */
  open(block: QuestionBlock) {
    if (this.disposed) return;
    const sequence = ++this.openSequence;
    this.currentBlock = block;
    this.currentResult = null;
    this.currentError = null;
    this.streamingText = null;
    this.loading = true;
    this.suggestVision = false;
    // Re-read saved position in case it changed since init()
    this.syncSavedPosition(() => !this.disposed && sequence === this.openSequence).then(() => {
      if (this.disposed || sequence !== this.openSequence) return;
      this.state = { ...this.state, visible: true, minimized: false };
      this.render();
    });
    logEvent("floating_window_opened", { blockId: block.id });
  }

  setResult(result: ParseResult) {
    if (this.disposed) return;
    this.currentResult = result;
    this.currentError = null;
    this.loading = false;
    // Suggest vision upgrade if confidence is low and we used text route
    this.suggestVision = result.confidence < 0.5 && result.routeUsed === "text";
    this.render();
  }

  setError(error: string) {
    if (this.disposed) return;
    this.currentError = error;
    this.loading = false;
    this.suggestVision = false;
    this.render();
  }

  /** Called during streaming to show partial result text */
  setStreamingText(partial: string) {
    if (this.disposed) return;
    if (!this.loading) return; // already got full result
    this.streamingText = partial;
    this.render();
  }

  /** Called when FloatingWindow internally updates pos/size (drag/resize) */
  onStateChange(patch: Partial<FloatingWindowState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    // Persist position/size changes
    saveFloatingState(patch);
  }

  close() {
    if (this.disposed) return;
    // Don't unmount — just hide. Preserves React state and avoids remount cost.
    this.state = { ...this.state, visible: false };
    this.render();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async syncSavedPosition(isCurrent: () => boolean = () => !this.disposed) {
    const saved = await loadFloatingState();
    if (!isCurrent()) return;
    if (saved.x !== undefined || saved.y !== undefined) {
      const clamped = clampToViewport(
        saved.x ?? this.state.x,
        saved.y ?? this.state.y,
        saved.width ?? this.state.width,
        saved.height ?? this.state.height
      );
      this.state = { ...this.state, ...saved, x: clamped.x, y: clamped.y };
    }
  }

  private ensureHost() {
    if (this.disposed) return;
    if (this.host && document.body.contains(this.host)) return;

    this.host = document.createElement("div");
    this.host.id = HOST_ID;
    Object.assign(this.host.style, {
      position: "fixed",
      top: "0", left: "0",
      width: "0", height: "0",
      overflow: "visible",
      zIndex: String(this.state.zIndex),
      pointerEvents: "none",
    });

    this.shadowRoot = this.host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      button { font-family: inherit; cursor: pointer; }
      textarea, input, select { font-family: inherit; }
      details summary { cursor: pointer; }
      a { color: inherit; }
    `;
    this.shadowRoot.appendChild(style);

    const mountPoint = document.createElement("div");
    mountPoint.style.cssText = "pointer-events: all; position: relative;";
    this.shadowRoot.appendChild(mountPoint);
    document.body.appendChild(this.host);

    this.root = createRoot(mountPoint);
  }

  private render() {
    this.ensureHost();
    if (!this.root) return;

    this.root.render(
      React.createElement(FloatingWindow, {
        initialState: this.state,
        block: this.currentBlock,
        result: this.currentResult,
        loading: this.loading,
        error: this.currentError,
        streamingText: this.streamingText,
        suggestVision: this.suggestVision,
        onClose: () => this.close(),
        onRetake: () => {
          this.close();
          this.scheduleCallback(() => this.onRetakeCallback?.());
        },
        onUpgradeVision: () => {
          this.close();
          this.scheduleCallback(() => this.onUpgradeVisionCallback?.());
        },
        onStateChange: (patch) => this.onStateChange(patch),
      })
    );
  }

  private scheduleCallback(callback: () => void) {
    if (this.disposed) return;
    const timer = window.setTimeout(() => {
      this.delayedCallbacks.delete(timer);
      if (!this.disposed) callback();
    }, 100);
    this.delayedCallbacks.add(timer);
  }
}

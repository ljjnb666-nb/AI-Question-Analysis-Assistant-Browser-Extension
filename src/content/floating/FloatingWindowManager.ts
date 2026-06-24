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

  /** Call once at content script startup */
  async init() {
    const defaults = getDefaultFloatingState();
    const saved = await loadFloatingState();
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

  /** Open/reuse window for a new capture — does NOT destroy existing root */
  open(block: QuestionBlock) {
    this.currentBlock = block;
    this.currentResult = null;
    this.currentError = null;
    this.streamingText = null;
    this.loading = true;
    this.suggestVision = false;
    // Re-read saved position in case it changed since init()
    this.syncSavedPosition().then(() => {
      this.state = { ...this.state, visible: true, minimized: false };
      this.render();
    });
    logEvent("floating_window_opened", { blockId: block.id });
  }

  setResult(result: ParseResult) {
    this.currentResult = result;
    this.currentError = null;
    this.loading = false;
    // Suggest vision upgrade if confidence is low and we used text route
    this.suggestVision = result.confidence < 0.5 && result.routeUsed === "text";
    this.render();
  }

  setError(error: string) {
    this.currentError = error;
    this.loading = false;
    this.suggestVision = false;
    this.render();
  }

  /** Called during streaming to show partial result text */
  setStreamingText(partial: string) {
    if (!this.loading) return; // already got full result
    this.streamingText = partial;
    this.render();
  }

  /** Called when FloatingWindow internally updates pos/size (drag/resize) */
  onStateChange(patch: Partial<FloatingWindowState>) {
    this.state = { ...this.state, ...patch };
    // Persist position/size changes
    saveFloatingState(patch);
  }

  close() {
    // Don't unmount — just hide. Preserves React state and avoids remount cost.
    this.state = { ...this.state, visible: false };
    this.render();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async syncSavedPosition() {
    const saved = await loadFloatingState();
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
          setTimeout(() => this.onRetakeCallback?.(), 100);
        },
        onUpgradeVision: () => {
          this.close();
          setTimeout(() => this.onUpgradeVisionCallback?.(), 100);
        },
        onStateChange: (patch) => this.onStateChange(patch),
      })
    );
  }
}

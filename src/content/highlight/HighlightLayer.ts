/**
 * HighlightLayer (M4)
 * Renders colored highlight boxes over detected question candidates.
 * Supports viewport-space and scroll-root-space boxes.
 */

import type { QuestionBlock } from "@/shared/types";
import type { ScanScrollRoot } from "../detector/fullPageDetector";

const LAYER_ID = "qs-highlight-layer";

const STATUS_COLORS: Record<string, string> = {
  pending: "rgba(79,156,249,0.25)",
  selected: "rgba(166,227,161,0.30)",
  processing: "rgba(249,226,175,0.30)",
  success: "rgba(166,227,161,0.35)",
  error: "rgba(243,139,168,0.30)",
};

const BORDER_COLORS: Record<string, string> = {
  pending: "#4f9cf9",
  selected: "#a6e3a1",
  processing: "#f9e2af",
  success: "#a6e3a1",
  error: "#f38ba8",
};

export class HighlightLayer {
  private layer: HTMLDivElement;
  private highlights = new Map<string, HTMLDivElement>();
  private storedBBoxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  private states = new Map<string, { status: string; selected: boolean; questionType: string }>();
  private onSelect?: (blockId: string, selected: boolean) => void;
  private coordinateSpace: "viewport" | "scroll-root";
  private scrollRoot: ScanScrollRoot | null;
  private onViewportChange = () => this.scheduleRelayout();
  private relayoutRaf: number | null = null;

  constructor(opts?: {
    onSelect?: (blockId: string, selected: boolean) => void;
    coordinateSpace?: "viewport" | "scroll-root";
    scrollRoot?: ScanScrollRoot | null;
  }) {
    this.onSelect = opts?.onSelect;
    this.coordinateSpace = opts?.coordinateSpace ?? "viewport";
    this.scrollRoot = opts?.scrollRoot ?? null;
    this.layer = this.createLayer();
    document.body.appendChild(this.layer);
    window.addEventListener("scroll", this.onViewportChange, { passive: true });
    window.addEventListener("resize", this.onViewportChange, { passive: true });
    if (this.scrollRoot && this.scrollRoot !== window) {
      this.scrollRoot.addEventListener("scroll", this.onViewportChange, { passive: true });
    }
  }

  private createLayer(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = LAYER_ID;
    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483630",
    });
    return el;
  }

  setBlocks(blocks: QuestionBlock[], statusMap: Map<string, { status: string; selected: boolean }>) {
    for (const [id, el] of this.highlights) {
      if (!blocks.find((b) => b.id === id)) {
        el.remove();
        this.highlights.delete(id);
        this.storedBBoxes.delete(id);
        this.states.delete(id);
      }
    }

    for (const block of blocks) {
      const state = statusMap.get(block.id) ?? { status: "pending", selected: false };
      this.storedBBoxes.set(block.id, {
        x: block.bbox.x,
        y: block.bbox.y,
        width: block.bbox.width,
        height: block.bbox.height,
      });
      this.states.set(block.id, {
        status: state.status,
        selected: state.selected,
        questionType: block.questionTypeGuess,
      });
      this.upsertHighlight(block.id);
    }

    this.scheduleRelayout();
  }

  private upsertHighlight(blockId: string) {
    const state = this.states.get(blockId);
    if (!state) return;

    let el = this.highlights.get(blockId);
    if (!el) {
      el = document.createElement("div");
      el.style.position = "fixed";
      el.style.boxSizing = "border-box";
      el.style.borderRadius = "4px";
      el.style.transition = "background 0.2s, border-color 0.2s";
      el.style.cursor = "pointer";
      el.style.pointerEvents = "all";
      el.addEventListener("click", () => {
        const current = this.states.get(blockId);
        this.onSelect?.(blockId, !(current?.selected ?? false));
      });
      this.highlights.set(blockId, el);
      this.layer.appendChild(el);
    }

    const key = state.selected ? "selected" : state.status;
    Object.assign(el.style, {
      backgroundColor: STATUS_COLORS[key] ?? STATUS_COLORS.pending,
      border: `2px solid ${BORDER_COLORS[key] ?? BORDER_COLORS.pending}`,
    });

    const qt = state.questionType === "unknown" ? "?" : state.questionType.replace("_choice", "选").replace("judge", "判");
    el.innerHTML = `
      <div style="
        position:absolute; top:-1px; left:-1px;
        background:${BORDER_COLORS[key] ?? BORDER_COLORS.pending};
        color:#1e1e2e; font-size:10px; font-weight:700;
        padding:1px 5px; border-radius:3px 0 3px 0;
        font-family:system-ui,sans-serif; line-height:16px;
        pointer-events:none;
      ">${state.selected ? "✓" : "○"} ${qt}</div>
    `;
  }

  private scheduleRelayout() {
    if (this.relayoutRaf !== null) return;
    this.relayoutRaf = window.requestAnimationFrame(() => {
      this.relayoutRaf = null;
      this.relayout();
    });
  }

  private relayout() {
    for (const [id, el] of this.highlights) {
      const b = this.storedBBoxes.get(id);
      if (!b) continue;
      const projected = this.projectToViewport(b);
      Object.assign(el.style, {
        left: `${projected.x}px`,
        top: `${projected.y}px`,
        width: `${projected.width}px`,
        height: `${projected.height}px`,
        display:
          projected.x + projected.width < 0 ||
          projected.y + projected.height < 0 ||
          projected.x > window.innerWidth ||
          projected.y > window.innerHeight
            ? "none"
            : "block",
      });
    }
  }

  private projectToViewport(bbox: { x: number; y: number; width: number; height: number }) {
    if (this.coordinateSpace !== "scroll-root" || !this.scrollRoot) {
      return bbox;
    }

    if (this.scrollRoot === window) {
      return {
        x: bbox.x - window.scrollX,
        y: bbox.y - window.scrollY,
        width: bbox.width,
        height: bbox.height,
      };
    }

    const elementRoot = this.scrollRoot as HTMLElement;
    const rect = elementRoot.getBoundingClientRect();
    return {
      x: rect.left + bbox.x - elementRoot.scrollLeft,
      y: rect.top + bbox.y - elementRoot.scrollTop,
      width: bbox.width,
      height: bbox.height,
    };
  }

  flashBlock(blockId: string) {
    const el = this.highlights.get(blockId);
    if (!el) return;
    el.style.outline = "3px solid #f9e2af";
    el.style.outlineOffset = "2px";
    setTimeout(() => {
      el.style.outline = "none";
    }, 600);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  destroy() {
    window.removeEventListener("scroll", this.onViewportChange);
    window.removeEventListener("resize", this.onViewportChange);
    if (this.scrollRoot && this.scrollRoot !== window) {
      this.scrollRoot.removeEventListener("scroll", this.onViewportChange);
    }
    if (this.relayoutRaf !== null) {
      window.cancelAnimationFrame(this.relayoutRaf);
      this.relayoutRaf = null;
    }
    this.layer.remove();
    this.highlights.clear();
    this.storedBBoxes.clear();
    this.states.clear();
  }
}

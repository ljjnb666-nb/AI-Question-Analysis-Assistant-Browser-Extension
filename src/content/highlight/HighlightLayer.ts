/**
 * HighlightLayer (M4)
 * Renders colored highlight boxes over detected question candidates.
 * Stores document-space boxes and reprojects to viewport on scroll/resize.
 */

import type { QuestionBlock } from "@/shared/types";

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
  private docBBoxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  private states = new Map<string, { status: string; selected: boolean; questionType: string }>();
  private onSelect?: (blockId: string, selected: boolean) => void;
  private onViewportChange = () => this.scheduleRelayout();
  private relayoutRaf: number | null = null;

  constructor(opts?: { onSelect?: (blockId: string, selected: boolean) => void }) {
    this.onSelect = opts?.onSelect;
    this.layer = this.createLayer();
    document.body.appendChild(this.layer);
    window.addEventListener("scroll", this.onViewportChange, { passive: true });
    window.addEventListener("resize", this.onViewportChange, { passive: true });
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
        this.docBBoxes.delete(id);
        this.states.delete(id);
      }
    }

    for (const block of blocks) {
      const state = statusMap.get(block.id) ?? { status: "pending", selected: false };
      this.docBBoxes.set(block.id, {
        x: block.bbox.x + window.scrollX,
        y: block.bbox.y + window.scrollY,
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
    const sx = window.scrollX;
    const sy = window.scrollY;
    for (const [id, el] of this.highlights) {
      const b = this.docBBoxes.get(id);
      if (!b) continue;
      const vx = b.x - sx;
      const vy = b.y - sy;
      Object.assign(el.style, {
        left: `${vx}px`,
        top: `${vy}px`,
        width: `${b.width}px`,
        height: `${b.height}px`,
        display: vx + b.width < 0 || vy + b.height < 0 || vx > window.innerWidth || vy > window.innerHeight ? "none" : "block",
      });
    }
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
    if (this.relayoutRaf !== null) {
      window.cancelAnimationFrame(this.relayoutRaf);
      this.relayoutRaf = null;
    }
    this.layer.remove();
    this.highlights.clear();
    this.docBBoxes.clear();
    this.states.clear();
  }
}

/**
 * CaptureOverlay
 * Full-screen mask + drag selection.
 * Callbacks: onSubmit(bbox, forceVision) | onCancel
 */

import type { BoundingBox } from "@/shared/types";
import { normalizeBBox, isValidBBox } from "@/shared/utils/bbox";
import { CaptureToolbar } from "./CaptureToolbar";

const OVERLAY_ID = "qs-capture-overlay";
const SELECTION_ID = "qs-capture-selection";
const TOOLBAR_ID = "qs-capture-toolbar";

export class CaptureOverlay {
  private overlay: HTMLDivElement;
  private selection: HTMLDivElement;
  private toolbar: CaptureToolbar | null = null;

  private startX = 0;
  private startY = 0;
  private isDragging = false;
  private currentBBox: BoundingBox | null = null;

  private onSubmit: (bbox: BoundingBox, forceVision: boolean) => void;
  private onCancel: () => void;

  constructor(opts: {
    onSubmit: (bbox: BoundingBox, forceVision: boolean) => void;
    onCancel: () => void;
  }) {
    this.onSubmit = opts.onSubmit;
    this.onCancel = opts.onCancel;

    this.overlay = this.createOverlay();
    this.selection = this.createSelection();
    this.overlay.appendChild(this.selection);
    document.body.appendChild(this.overlay);
    this.bindEvents();
  }

  private createOverlay(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = OVERLAY_ID;
    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483645",
      cursor: "crosshair",
      backgroundColor: "rgba(0,0,0,0.38)",
      userSelect: "none",
    });
    // Hint text
    const hint = document.createElement("div");
    Object.assign(hint.style, {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%,-50%)",
      color: "rgba(255,255,255,0.55)",
      fontSize: "15px",
      fontFamily: "system-ui, sans-serif",
      pointerEvents: "none",
      userSelect: "none",
      letterSpacing: "0.5px",
    });
    hint.textContent = "拖拽框选题目区域 · Esc 取消";
    el.appendChild(hint);
    return el;
  }

  private createSelection(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = SELECTION_ID;
    Object.assign(el.style, {
      position: "absolute",
      border: "2px solid #4f9cf9",
      backgroundColor: "rgba(79,156,249,0.08)",
      boxSizing: "border-box",
      display: "none",
      pointerEvents: "none",
    });
    return el;
  }

  private bindEvents() {
    this.overlay.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("keydown", this.onKeyDown);
  }

  private unbindEvents() {
    this.overlay.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("keydown", this.onKeyDown);
  }

  private onMouseDown = (e: MouseEvent) => {
    // Ignore mousedown from toolbar/button clicks so submit actions can run.
    if ((e.target as HTMLElement | null)?.closest?.(`#${TOOLBAR_ID}`)) return;
    e.preventDefault();
    this.isDragging = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.currentBBox = null;
    this.selection.style.display = "none";
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isDragging) return;
    this.updateSelectionEl(normalizeBBox(this.startX, this.startY, e.clientX, e.clientY));
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.isDragging) return;
    this.isDragging = false;
    const bbox = normalizeBBox(this.startX, this.startY, e.clientX, e.clientY);
    if (!isValidBBox(bbox)) return;
    this.currentBBox = bbox;
    this.updateSelectionEl(bbox);
    this.showToolbar(bbox);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.cancel();
  };

  private updateSelectionEl(bbox: BoundingBox) {
    Object.assign(this.selection.style, {
      display: "block",
      left: `${bbox.x}px`,
      top: `${bbox.y}px`,
      width: `${bbox.width}px`,
      height: `${bbox.height}px`,
    });
  }

  private showToolbar(bbox: BoundingBox) {
    this.toolbar = new CaptureToolbar({
      bbox,
      container: this.overlay,
      onAnalyze: () => this.submit(false),
      onVision:  () => this.submit(true),
      onReselect: () => {
        this.toolbar?.destroy();
        this.toolbar = null;
        this.selection.style.display = "none";
        this.currentBBox = null;
      },
      onCancel: () => this.cancel(),
    });
  }

  private submit(forceVision: boolean) {
    if (!this.currentBBox) return;
    const bbox = this.currentBBox;
    this.destroy();
    this.onSubmit(bbox, forceVision);
  }

  private cancel() {
    console.log("[CaptureOverlay] cancel() called");
    this.destroy();
    this.onCancel();
  }

  destroy() {
    console.log("[CaptureOverlay] destroy() called, overlay exists:", !!this.overlay);
    this.unbindEvents();
    this.toolbar?.destroy();
    this.toolbar = null;
    if (this.overlay && this.overlay.parentNode) {
      console.log("[CaptureOverlay] removing overlay from DOM");
      this.overlay.remove();
    } else {
      console.log("[CaptureOverlay] overlay already removed or no parent");
    }
  }
}

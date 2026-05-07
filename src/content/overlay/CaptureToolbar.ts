/**
 * CaptureToolbar
 * Buttons: 解析此题 | 图题增强 | 重选 | 取消
 */

import type { BoundingBox } from "@/shared/types";

const TOOLBAR_ID = "qs-capture-toolbar";
const TOOLBAR_OFFSET = 8;

export class CaptureToolbar {
  private el: HTMLDivElement;

  constructor(opts: {
    bbox: BoundingBox;
    container: HTMLElement;
    onAnalyze: () => void;
    onVision: () => void;   // 图题增强
    onReselect: () => void;
    onCancel: () => void;
  }) {
    this.el = this.build(opts);
    opts.container.appendChild(this.el);
    this.position(opts.bbox);
  }

  private build(opts: {
    onAnalyze: () => void;
    onVision: () => void;
    onReselect: () => void;
    onCancel: () => void;
  }): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.id = TOOLBAR_ID;
    Object.assign(wrap.style, {
      position: "absolute",
      display: "flex",
      gap: "6px",
      padding: "6px 8px",
      backgroundColor: "#1e1e2e",
      borderRadius: "8px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
      zIndex: "2147483646",
      pointerEvents: "all",
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px",
      border: "1px solid #313244",
      alignItems: "center",
    });

    // Separator helper
    const sep = () => {
      const d = document.createElement("div");
      Object.assign(d.style, { width: "1px", height: "18px", backgroundColor: "#313244" });
      return d;
    };

    wrap.appendChild(this.makeBtn("解析此题", "#4f9cf9", opts.onAnalyze, true));
    wrap.appendChild(sep());
    wrap.appendChild(this.makeBtn("🖼 图题增强", "#7c3aed", opts.onVision, false, "视觉链路解析，适合图表/几何/函数题"));
    wrap.appendChild(sep());
    wrap.appendChild(this.makeBtn("重选", "#45475a", opts.onReselect));
    wrap.appendChild(this.makeBtn("取消", "#45475a", opts.onCancel));
    return wrap;
  }

  private makeBtn(
    label: string,
    bg: string,
    onClick: () => void,
    primary = false,
    title?: string
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    if (title) btn.title = title;
    Object.assign(btn.style, {
      padding: primary ? "6px 14px" : "5px 10px",
      border: "none",
      borderRadius: "5px",
      backgroundColor: bg,
      color: "#fff",
      cursor: "pointer",
      fontWeight: primary ? "600" : "400",
      fontSize: "13px",
      lineHeight: "1",
      fontFamily: "system-ui, sans-serif",
      whiteSpace: "nowrap",
    });
    btn.addEventListener("mouseenter", () => (btn.style.opacity = "0.85"));
    btn.addEventListener("mouseleave", () => (btn.style.opacity = "1"));
    btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return btn;
  }

  private position(bbox: BoundingBox) {
    // Estimate toolbar width: ~340px
    const TOOLBAR_W = 340;
    const TOOLBAR_H = 40;

    let top = bbox.y + bbox.height + TOOLBAR_OFFSET;
    let left = bbox.x;

    if (top + TOOLBAR_H > window.innerHeight - 20) {
      top = bbox.y - TOOLBAR_H - TOOLBAR_OFFSET;
    }
    if (top < 10) top = 10;
    if (left + TOOLBAR_W > window.innerWidth - 10) {
      left = window.innerWidth - TOOLBAR_W - 10;
    }
    if (left < 10) left = 10;

    Object.assign(this.el.style, { top: `${top}px`, left: `${left}px` });
  }

  destroy() { this.el.remove(); }
}

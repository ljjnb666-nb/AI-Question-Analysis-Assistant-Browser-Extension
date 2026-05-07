/**
 * FloatingTrigger (V1 optional)
 * A small persistent button on the page edge that triggers manual capture.
 * Created when user clicks popup, persists until page unload.
 * Draggable, remembers position.
 */

const TRIGGER_ID = "qs-floating-trigger";

export class FloatingTrigger {
  private el: HTMLDivElement;
  private dragging = false;
  private dragOffset = { x: 0, y: 0 };
  private onClick: () => void;

  constructor(onClick: () => void) {
    this.onClick = onClick;
    this.el = this.create();
    document.body.appendChild(this.el);
    this.bindEvents();
  }

  private create(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = TRIGGER_ID;
    Object.assign(el.style, {
      position: "fixed",
      right: "20px",
      bottom: "80px",
      width: "44px",
      height: "44px",
      borderRadius: "50%",
      backgroundColor: "#4f9cf9",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "20px",
      cursor: "pointer",
      zIndex: "2147483635",
      boxShadow: "0 4px 16px rgba(79,156,249,0.5)",
      userSelect: "none",
      transition: "transform 0.15s, box-shadow 0.15s",
      border: "2px solid rgba(255,255,255,0.2)",
    });
    el.textContent = "📘";
    el.title = "题目解析 - 点击截图";
    return el;
  }

  private bindEvents() {
    this.el.addEventListener("mousedown", this.onMouseDown);
    this.el.addEventListener("mouseenter", () => {
      if (!this.dragging) {
        this.el.style.transform = "scale(1.1)";
        this.el.style.boxShadow = "0 6px 20px rgba(79,156,249,0.7)";
      }
    });
    this.el.addEventListener("mouseleave", () => {
      this.el.style.transform = "scale(1)";
      this.el.style.boxShadow = "0 4px 16px rgba(79,156,249,0.5)";
    });
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
  }

  private onMouseDown = (e: MouseEvent) => {
    this.dragging = false;
    const rect = this.el.getBoundingClientRect();
    this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    // We detect drag vs click by movement threshold
    document.addEventListener("mousemove", this.onDragStart, { once: true });
    e.preventDefault();
  };

  private onDragStart = () => { this.dragging = true; };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.dragging) return;
    const x = e.clientX - this.dragOffset.x;
    const y = e.clientY - this.dragOffset.y;
    const maxX = window.innerWidth - 44;
    const maxY = window.innerHeight - 44;
    this.el.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
    this.el.style.top  = `${Math.max(0, Math.min(y, maxY))}px`;
    this.el.style.right = "auto";
    this.el.style.bottom = "auto";
  };

  private onMouseUp = () => {
    if (!this.dragging) {
      // It was a click
      this.onClick();
    }
    this.dragging = false;
  };

  destroy() {
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
    this.el.remove();
  }

  static getExisting(): HTMLElement | null {
    return document.getElementById(TRIGGER_ID);
  }
}

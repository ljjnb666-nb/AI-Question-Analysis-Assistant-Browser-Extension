import { MAX_ROOT_DEPTH } from "./rootContext";

/**
 * Root-aware DOM helpers. Question-engine code must never assume a node
 * belongs to the top document: computed styles, elementsFromPoint and
 * coordinates all belong to the node's own owner window/document.
 */

export type TraversableRoot = Document | ShadowRoot;

export function getTraversalRoot(node: Node): TraversableRoot {
  const root = node.getRootNode();
  if (root instanceof Document || (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot)) return root;
  return node.ownerDocument ?? document;
}

export function getOwnerDocument(node: Node): Document {
  return node.ownerDocument ?? document;
}

export function getOwnerWindow(node: Node): Window {
  return getOwnerDocument(node).defaultView ?? window;
}

export function getComputedStyleFor(node: Element): CSSStyleDeclaration {
  return getOwnerWindow(node).getComputedStyle(node);
}

/** Same-origin policy permitting, expose the frame document; otherwise abstain. */
export function getAccessibleFrameDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    const win = iframe.contentWindow;
    if (!win || win.closed) return null;
    const doc = iframe.contentDocument;
    if (!doc || doc.defaultView !== win) return null;
    return doc;
  } catch {
    // Cross-origin or detached frame: out of scope, fail closed.
    return null;
  }
}

export type Point = { x: number; y: number };

export type FrameTransform =
  | { ok: true; point: Point; scale: number }
  | { ok: false; reason: "DETACHED_FRAME" | "AMBIGUOUS_FRAME_TRANSFORM" };

export type ParentFrameResolver = (doc: Document) => HTMLIFrameElement | null;

/** Standard resolver; environments without window.frameElement can inject their own. */
export const defaultParentFrameResolver: ParentFrameResolver = (doc) => {
  try {
    return doc.defaultView && doc.defaultView.frameElement instanceof HTMLIFrameElement
      ? doc.defaultView.frameElement
      : null;
  } catch {
    return null;
  }
};

const SCALE_EPSILON = 0.01;
const MAX_SCALE = 8;

function clientOffset(iframe: HTMLIFrameElement, axis: "x" | "y"): number {
  // The frame's content viewport starts inside its border (and padding).
  const padding = axis === "x"
    ? parseFloat(getComputedStyleFor(iframe).paddingLeft) || 0
    : parseFloat(getComputedStyleFor(iframe).paddingTop) || 0;
  return axis === "x" ? iframe.clientLeft + padding : iframe.clientTop + padding;
}

/**
 * Transform a point from an iframe's local viewport into its parent document's
 * viewport, accounting for the frame's content origin and a provable uniform
 * CSS scale. Returns a deterministic failure for detached or ambiguous frames
 * so coordinate-based fallbacks can abstain instead of clicking blindly.
 */
export function framePointToParentViewport(iframe: HTMLIFrameElement, point: Point): FrameTransform {
  if (!iframe.isConnected) return { ok: false, reason: "DETACHED_FRAME" };
  const rect = iframe.getBoundingClientRect();
  const offsetX = clientOffset(iframe, "x");
  const offsetY = clientOffset(iframe, "y");
  const contentWidth = iframe.clientWidth;
  const contentHeight = iframe.clientHeight;
  if (contentWidth <= 0 || contentHeight <= 0) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };

  const renderedWidth = rect.width - (iframe.offsetWidth - iframe.clientWidth);
  const renderedHeight = rect.height - (iframe.offsetHeight - iframe.clientHeight);
  const scaleX = renderedWidth / contentWidth;
  const scaleY = renderedHeight / contentHeight;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  if (scaleX <= 0 || scaleY <= 0 || scaleX > MAX_SCALE || scaleY > MAX_SCALE) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  if (Math.abs(scaleX - scaleY) > SCALE_EPSILON) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };

  return {
    ok: true,
    scale: scaleX,
    point: { x: rect.left + offsetX + point.x * scaleX, y: rect.top + offsetY + point.y * scaleY },
  };
}

/** Walk the full frame chain up to the top document's viewport. */
export function framePointToTopViewport(
  iframe: HTMLIFrameElement,
  point: Point,
  resolveParentFrame: ParentFrameResolver = defaultParentFrameResolver,
  maxDepth = MAX_ROOT_DEPTH,
): FrameTransform {
  let current: HTMLIFrameElement | null = iframe;
  let transformed = { ...point };
  let scale = 1;
  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    const step = framePointToParentViewport(current, transformed);
    if (!step.ok) return step;
    transformed = step.point;
    scale *= step.scale;
    current = resolveParentFrame(current.ownerDocument);
  }
  if (current) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  return { ok: true, point: transformed, scale };
}

/** Transform a frame-local rect into the parent document's viewport (provable scale only). */
export function frameRectToParentViewport(
  iframe: HTMLIFrameElement,
  rect: { left: number; top: number; width: number; height: number },
): { ok: true; left: number; top: number; width: number; height: number; scale: number } | { ok: false; reason: "DETACHED_FRAME" | "AMBIGUOUS_FRAME_TRANSFORM" } {
  const point = framePointToParentViewport(iframe, { x: rect.left, y: rect.top });
  if (!point.ok) return point;
  return {
    ok: true,
    left: point.point.x,
    top: point.point.y,
    width: rect.width * point.scale,
    height: rect.height * point.scale,
    scale: point.scale,
  };
}

/** Walk the frame chain, transforming a frame-local rect to top viewport coordinates. */
export function frameRectToTopViewport(
  iframe: HTMLIFrameElement,
  rect: { left: number; top: number; width: number; height: number },
  resolveParentFrame: ParentFrameResolver = defaultParentFrameResolver,
  maxDepth = MAX_ROOT_DEPTH,
): { ok: true; left: number; top: number; width: number; height: number; scale: number } | { ok: false; reason: "DETACHED_FRAME" | "AMBIGUOUS_FRAME_TRANSFORM" } {
  const step = frameRectToParentViewport(iframe, rect);
  if (!step.ok) return step;
  const parentFrame = resolveParentFrame(iframe.ownerDocument);
  if (!parentFrame) return { ok: true, left: step.left, top: step.top, width: step.width, height: step.height, scale: step.scale };
  const rest = frameRectToTopViewport(parentFrame, { left: step.left, top: step.top, width: step.width, height: step.height }, resolveParentFrame, maxDepth);
  if (!rest.ok) return rest;
  return { ok: true, left: rest.left, top: rest.top, width: rest.width, height: rest.height, scale: step.scale * rest.scale };
}

/** Inverse transform: a top-viewport point into a frame's local viewport. */
export function topViewportPointToFrame(
  iframe: HTMLIFrameElement,
  topPoint: Point,
  resolveParentFrame: ParentFrameResolver = defaultParentFrameResolver,
  maxDepth = MAX_ROOT_DEPTH,
): FrameTransform {
  const parentPoint = (() => {
    const parentFrame = resolveParentFrame(iframe.ownerDocument);
    if (!parentFrame) return { ok: true as const, point: { ...topPoint }, scale: 1 };
    return topViewportPointToFrame(parentFrame, topPoint, resolveParentFrame, maxDepth);
  })();
  if (!parentPoint.ok) return parentPoint;

  const rect = iframe.getBoundingClientRect();
  const offsetX = clientOffset(iframe, "x");
  const offsetY = clientOffset(iframe, "y");
  const contentWidth = iframe.clientWidth;
  const contentHeight = iframe.clientHeight;
  if (contentWidth <= 0 || contentHeight <= 0) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  const renderedWidth = rect.width - (iframe.offsetWidth - iframe.clientWidth);
  const scaleX = renderedWidth / contentWidth;
  if (!Number.isFinite(scaleX) || scaleX <= 0 || scaleX > 8) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };

  return {
    ok: true,
    scale: parentPoint.scale * scaleX,
    point: { x: (parentPoint.point.x - rect.left - offsetX) / scaleX, y: (parentPoint.point.y - rect.top - offsetY) / scaleX },
  };
}

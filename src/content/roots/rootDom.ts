import { MAX_ROOT_DEPTH } from "./rootContext";
import { isDocumentNode, isHTMLIFrameInOwnerRealm, isOpenShadowRootNode } from "../domRealm";

/**
 * Root-aware DOM helpers. Question-engine code must never assume a node
 * belongs to the top document: computed styles, elementsFromPoint and
 * coordinates all belong to the node's own owner window/document.
 */

export type TraversableRoot = Document | ShadowRoot;

export function getTraversalRoot(node: Node): TraversableRoot {
  const root = node.getRootNode();
  if (isDocumentNode(root) || isOpenShadowRootNode(root)) return root;
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
    return doc.defaultView && isHTMLIFrameInOwnerRealm(doc.defaultView.frameElement)
      ? doc.defaultView.frameElement
      : null;
  } catch {
    return null;
  }
};

const SCALE_EPSILON = 0.01;
const MAX_SCALE = 8;

type FrameGeometry = { rect: DOMRect; offsetX: number; offsetY: number; scale: number };

function onlyUniformAxisScale(iframe: HTMLIFrameElement): boolean {
  let current: Element | null = iframe;
  while (current) {
    const transform = getComputedStyleFor(current).transform;
    if (transform && transform !== "none") {
      const match = transform.match(/^matrix\(([^)]+)\)$/);
      if (!match) return false;
      const values = match[1]!.split(",").map((value) => Number(value.trim()));
      if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) return false;
      const [scaleX, skewY, skewX, scaleY] = values;
      if (scaleX! <= 0 || scaleY! <= 0 || Math.abs(skewX!) > SCALE_EPSILON
        || Math.abs(skewY!) > SCALE_EPSILON || Math.abs(scaleX! - scaleY!) > SCALE_EPSILON) return false;
    }
    const parentElement: Element | null = current.parentElement;
    if (parentElement) {
      current = parentElement;
    } else {
      const root = current.getRootNode();
      current = isOpenShadowRootNode(root) ? root.host : null;
    }
  }
  return true;
}

function frameGeometry(iframe: HTMLIFrameElement): FrameGeometry | FrameTransform {
  if (!iframe.isConnected) return { ok: false, reason: "DETACHED_FRAME" };
  if (!onlyUniformAxisScale(iframe)) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  const rect = iframe.getBoundingClientRect();
  const offsetX = clientOffset(iframe, "x");
  const offsetY = clientOffset(iframe, "y");
  const contentWidth = iframe.clientWidth;
  const contentHeight = iframe.clientHeight;
  if (![rect.left, rect.top, rect.width, rect.height, offsetX, offsetY, contentWidth, contentHeight]
    .every(Number.isFinite) || contentWidth <= 0 || contentHeight <= 0) {
    return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  }
  const scaleX = (rect.width - (iframe.offsetWidth - contentWidth)) / contentWidth;
  const scaleY = (rect.height - (iframe.offsetHeight - contentHeight)) / contentHeight;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0
    || scaleX > MAX_SCALE || scaleY > MAX_SCALE || Math.abs(scaleX - scaleY) > SCALE_EPSILON) {
    return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  }
  return { rect, offsetX, offsetY, scale: (scaleX + scaleY) / 2 };
}

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
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  const geometry = frameGeometry(iframe);
  if ("ok" in geometry) return geometry;

  return {
    ok: true,
    scale: geometry.scale,
    point: {
      x: geometry.rect.left + geometry.offsetX + point.x * geometry.scale,
      y: geometry.rect.top + geometry.offsetY + point.y * geometry.scale,
    },
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
    if (!Number.isFinite(scale) || scale > MAX_SCALE) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
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
  if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0) {
    return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  }
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
  let current: HTMLIFrameElement | null = iframe;
  let transformed = { ...rect };
  let scale = 1;
  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    const step = frameRectToParentViewport(current, transformed);
    if (!step.ok) return step;
    transformed = { left: step.left, top: step.top, width: step.width, height: step.height };
    scale *= step.scale;
    if (!Number.isFinite(scale) || scale > MAX_SCALE) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
    current = resolveParentFrame(current.ownerDocument);
  }
  if (current) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  return { ok: true, ...transformed, scale };
}

/** Inverse transform: a top-viewport point into a frame's local viewport. */
export function topViewportPointToFrame(
  iframe: HTMLIFrameElement,
  topPoint: Point,
  resolveParentFrame: ParentFrameResolver = defaultParentFrameResolver,
  maxDepth = MAX_ROOT_DEPTH,
): FrameTransform {
  if (!Number.isFinite(topPoint.x) || !Number.isFinite(topPoint.y)) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
  const frames: HTMLIFrameElement[] = [];
  let current: HTMLIFrameElement | null = iframe;
  while (current && frames.length < maxDepth) {
    const geometry = frameGeometry(current);
    if ("ok" in geometry) return geometry;
    frames.push(current);
    current = resolveParentFrame(current.ownerDocument);
  }
  if (current) return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };

  let point = { ...topPoint };
  let scale = 1;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const geometry = frameGeometry(frames[index]!);
    if ("ok" in geometry) return geometry;
    point = {
      x: (point.x - geometry.rect.left - geometry.offsetX) / geometry.scale,
      y: (point.y - geometry.rect.top - geometry.offsetY) / geometry.scale,
    };
    scale *= geometry.scale;
    if (![point.x, point.y, scale].every(Number.isFinite) || scale > MAX_SCALE) {
      return { ok: false, reason: "AMBIGUOUS_FRAME_TRANSFORM" };
    }
  }
  return { ok: true, point, scale };
}

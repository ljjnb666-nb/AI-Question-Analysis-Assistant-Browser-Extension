import type { BoundingBox } from "../types";

/** Normalize a bbox so width/height are always positive (handles reverse-drag). */
export function normalizeBBox(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): BoundingBox {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  return { x, y, width, height };
}

/** Return true if the bbox has a meaningful area (at least 10×10 px). */
export function isValidBBox(bbox: BoundingBox): boolean {
  return bbox.width >= 10 && bbox.height >= 10;
}

/**
 * Scale a viewport-relative bbox to the actual screenshot pixel coords.
 * The screenshot captured by chrome.tabs.captureVisibleTab is at
 * devicePixelRatio resolution, so we must multiply by dpr.
 * scrollX/scrollY are NOT used here because captureVisibleTab only captures
 * the current viewport (no scroll offset needed).
 */
export function scaleBBoxToScreenshot(
  bbox: BoundingBox,
  dpr: number
): BoundingBox {
  return {
    x: Math.round(bbox.x * dpr),
    y: Math.round(bbox.y * dpr),
    width: Math.round(bbox.width * dpr),
    height: Math.round(bbox.height * dpr),
  };
}

/** Clamp a floating window position so it stays within the viewport. */
export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  const maxX = window.innerWidth - width;
  const maxY = window.innerHeight - height;
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

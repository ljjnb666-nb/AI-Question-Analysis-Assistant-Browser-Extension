import type { BoundingBox } from "@/shared/types";

export type ViewportState = "fully-visible" | "clipped-top" | "clipped-bottom" | "clipped-both";
export const VIEWPORT_BOUNDARY_EPSILON = 2;

export interface ViewportBoundaryEvidence {
  state: ViewportState;
  visibleRatio: number;
  clippedTop: boolean;
  clippedBottom: boolean;
}

export function classifyViewportBoundary(
  rect: Pick<BoundingBox, "y" | "height">,
  viewport: Pick<Window, "innerHeight"> = window,
): ViewportBoundaryEvidence {
  const top = rect.y;
  const bottom = rect.y + Math.max(0, rect.height);
  const height = Math.max(1, viewport.innerHeight);
  const clippedTop = top < -VIEWPORT_BOUNDARY_EPSILON;
  const clippedBottom = bottom > height + VIEWPORT_BOUNDARY_EPSILON;
  const visible = Math.max(0, Math.min(bottom, height) - Math.max(top, 0));
  return {
    state: clippedTop && clippedBottom ? "clipped-both" : clippedTop ? "clipped-top" : clippedBottom ? "clipped-bottom" : "fully-visible",
    visibleRatio: Math.min(1, visible / Math.max(1, rect.height)),
    clippedTop,
    clippedBottom,
  };
}

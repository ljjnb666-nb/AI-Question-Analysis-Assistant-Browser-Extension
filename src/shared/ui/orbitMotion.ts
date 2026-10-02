/**
 * Motion Foundation for Orbit Console Design System
 * Micro interactions: 120-180ms
 * Panel transitions: 200-260ms
 * Strict reduced-motion support.
 */

export const ORBIT_MOTION_DURATIONS = {
  microMs: 140,
  normalMs: 180,
  panelMs: 220,
} as const;

export const ORBIT_EASINGS = {
  default: "cubic-bezier(0.16, 1, 0.3, 1)",
  inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  linear: "linear",
} as const;

/**
 * Returns true if the user's environment requests reduced motion.
 */
export function getPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Returns the effective animation duration (0 when reduced-motion is requested).
 */
export function resolveMotionDuration(baseDurationMs: number): number {
  return getPrefersReducedMotion() ? 0 : baseDurationMs;
}

/**
 * CSS text for reduced motion support when injected into host documents or shadow DOM.
 */
export const ORBIT_REDUCED_MOTION_CSS = `
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`.trim();

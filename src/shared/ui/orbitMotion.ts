import { useState, useEffect } from "react";
import { orbitTokens } from "./orbitTokens";

/**
 * Motion Foundation for Orbit Console Design System
 * Values derived directly and strictly from authoritative orbitTokens.motion.
 */

export const ORBIT_MOTION_DURATIONS = {
  microMs: orbitTokens.motion.duration.fast,
  normalMs: orbitTokens.motion.duration.normal,
  panelMs: orbitTokens.motion.duration.panel,
} as const;

export const ORBIT_EASINGS = orbitTokens.motion.easing;

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
 * React hook that actively responds to prefers-reduced-motion media query changes.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => getPrefersReducedMotion());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");

    const updateState = (e: MediaQueryListEvent | MediaQueryList) => {
      setReduced(Boolean(e.matches));
    };

    // Initialize with current match value
    setReduced(Boolean(mql.matches));

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", updateState);
      return () => mql.removeEventListener("change", updateState);
    }
    // Fallback for older environments
    if ("addListener" in mql) {
      (mql as any).addListener(updateState);
      return () => {
        (mql as any).removeListener(updateState);
      };
    }
  }, []);

  return reduced;
}

/**
 * Returns the effective animation duration (0 when reduced-motion is requested).
 */
export function resolveMotionDuration(baseDurationMs: number): number {
  return getPrefersReducedMotion() ? 0 : baseDurationMs;
}

/**
 * Injects required keyframes (e.g. orbit-spin) into document head once,
 * ensuring animations have valid keyframe definitions without global CSS dependencies.
 */
export function ensureOrbitKeyframes(): void {
  if (typeof document === "undefined") return;
  const keyframesId = "orbit-system-keyframes";
  if (!document.getElementById(keyframesId)) {
    const styleEl = document.createElement("style");
    styleEl.id = keyframesId;
    styleEl.textContent = `
@keyframes orbit-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`.trim();
    document.head.appendChild(styleEl);
  }
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

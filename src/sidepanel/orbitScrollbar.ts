import { orbitColors, orbitRadius, orbitSpacing } from "@/shared/ui/orbitTokens";

/** Native scrolling stays intact; unsupported selectors simply fall back. */
export const ORBIT_SCROLLBAR_CSS = `
.orbit-panel-scroll { scrollbar-color: ${orbitColors.border.strong} ${orbitColors.bg.canvas}; scrollbar-width: thin; }
.orbit-panel-scroll::-webkit-scrollbar { width: ${orbitSpacing[2]}px; }
.orbit-panel-scroll::-webkit-scrollbar-track { background: ${orbitColors.bg.canvas}; }
.orbit-panel-scroll::-webkit-scrollbar-thumb { background: ${orbitColors.border.strong}; border-radius: ${orbitRadius.pill}px; }
.orbit-panel-scroll::-webkit-scrollbar-thumb:hover { background: ${orbitColors.text.muted}; }
[data-candidate-workspace] .math-display { max-width: 100%; overflow-x: auto; }
`;

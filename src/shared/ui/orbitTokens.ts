/**
 * Orbit Console Design System Tokens
 * Internal codename: Orbit Console / 星轨工作台
 * Product brand: 题目解析助手 / Quiz Solver
 *
 * Core principles:
 * - Focused, Technical, Calm, Trustworthy, Fast, Readable, Operational
 * - Deep graphite base surfaces with flat / subtle elevation
 * - Hairline 1px borders for clear visual hierarchy without glow
 * - Electric blue action accent; purple reserved exclusively for AI processing
 * - Direct contract alignment with UI-00B UserFeedbackTone (success, info, warning, error)
 * - System typography with zero external downloads
 * - Accessible focus rings and reduced-motion compliance
 * - Single authoritative source of truth for motion, geometry, and tokens
 * - No internal token drift: semantic aliases derive directly from base tokens
 */

export const orbitColors = {
  bg: {
    canvas: "#0B0D11",
    canvasMuted: "#101318",
    surface: "#14181F",
    surfaceRaised: "#1A202A",
    surfaceInteractive: "#1F2633",
    surfaceSubtle: "#0F1217",
  },
  border: {
    subtle: "rgba(255, 255, 255, 0.08)",
    default: "rgba(255, 255, 255, 0.14)",
    strong: "rgba(255, 255, 255, 0.24)",
    focus: "#2563EB",
  },
  text: {
    primary: "#F1F5F9",
    secondary: "#94A3B8",
    muted: "#64748B",
    inverse: "#0B0D11",
    onAccent: "#FFFFFF",
  },
  brand: {
    primary: "#2563EB",
    hover: "#1D4ED8",
    active: "#1E40AF",
    /** Accessible blue for text on dark surfaces; primary is reserved for filled buttons. */
    linkText: "#93C5FD",
    subtle: "rgba(37, 99, 235, 0.14)",
    border: "rgba(59, 130, 246, 0.4)",
  },
  semantic: {
    success: "#10B981",
    successHover: "#059669",
    successSurface: "rgba(16, 185, 129, 0.12)",
    successBorder: "rgba(16, 185, 129, 0.3)",
    warning: "#F59E0B",
    warningHover: "#D97706",
    warningSurface: "rgba(245, 158, 11, 0.12)",
    warningBorder: "rgba(245, 158, 11, 0.3)",
    error: "#EF4444",
    errorHover: "#DC2626",
    errorSurface: "rgba(239, 68, 68, 0.12)",
    errorBorder: "rgba(239, 68, 68, 0.3)",
    info: "#3B82F6",
    infoHover: "#2563EB",
    infoSurface: "rgba(59, 130, 246, 0.12)",
    infoBorder: "rgba(59, 130, 246, 0.3)",
  },
  ai: {
    accent: "#8B5CF6",
    hover: "#7C3AED",
    surface: "rgba(139, 92, 246, 0.12)",
    border: "rgba(139, 92, 246, 0.3)",
  },
  control: {
    onAccent: "#FFFFFF",
    disabledBg: "rgba(255, 255, 255, 0.05)",
    disabledText: "#64748B",
    ghostHover: "rgba(255, 255, 255, 0.06)",
    inputDisabledBg: "rgba(255, 255, 255, 0.03)",
    toggleDisabledBg: "rgba(255, 255, 255, 0.08)",
  },
} as const;

export const orbitSpacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
} as const;

export const orbitRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 18,
  pill: 999,
} as const;

export const orbitTypography = {
  fontFamily:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  codeFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontSize: {
    xxs: 10,
    xs: 11,
    sm: 12,
    md: 13,
    base: 14,
    lg: 16,
    xl: 18,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.55,
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

export const orbitControlHeight = {
  sm: 32,
  md: 36,
  lg: 40,
} as const;

export const orbitComponent = {
  toggle: {
    trackWidth: 38,
    trackHeight: 22,
    trackPadding: 2,
    thumbSize: 16,
    thumbTranslateX: 16,
  },
  badge: {
    dotSize: 6,
    gap: 6,
  },
  status: {
    dotSize: 8,
  },
  disclosure: {
    chevronSize: 10,
  },
  spinner: {
    size: 12,
    borderWidth: 2,
  },
} as const;

export const orbitShadow = {
  none: "none",
  subtle: "0 1px 2px 0 rgba(0, 0, 0, 0.35)",
  elevation: "0 8px 24px -4px rgba(0, 0, 0, 0.5)",
  activityElevation: "0 -2px 8px rgba(0, 0, 0, 0.25)",
} as const;

/**
 * Focus ring styles derived directly from authoritative color tokens without literal drift.
 */
export const orbitFocus = {
  focusRing: `0 0 0 2px ${orbitColors.bg.canvas}, 0 0 0 4px ${orbitColors.brand.primary}`,
  outline: `2px solid ${orbitColors.brand.primary}`,
  outlineOffset: "2px",
} as const;

export const orbitMotionDurations = {
  fast: 140,
  normal: 180,
  panel: 220,
  spinner: 800,
} as const;

export const orbitEasings = {
  default: "ease",
  inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  linear: "linear",
} as const;

export const orbitMotion = {
  duration: orbitMotionDurations,
  easing: orbitEasings,
  fast: `${orbitMotionDurations.fast}ms ${orbitEasings.default}`,
  normal: `${orbitMotionDurations.normal}ms ${orbitEasings.default}`,
  panel: `${orbitMotionDurations.panel}ms ${orbitEasings.default}`,
  spinner: `${orbitMotionDurations.spinner}ms ${orbitEasings.linear}`,
  reducedMotionQuery: "@media (prefers-reduced-motion: reduce)",
} as const;

/**
 * CSS Variables mapping dictionary for Orbit Console Design System.
 */
export const orbitCssVariables: Record<string, string> = {
  "--oc-bg-canvas": orbitColors.bg.canvas,
  "--oc-bg-canvas-muted": orbitColors.bg.canvasMuted,
  "--oc-bg-surface": orbitColors.bg.surface,
  "--oc-bg-surface-raised": orbitColors.bg.surfaceRaised,
  "--oc-bg-surface-interactive": orbitColors.bg.surfaceInteractive,
  "--oc-bg-surface-subtle": orbitColors.bg.surfaceSubtle,

  "--oc-border-subtle": orbitColors.border.subtle,
  "--oc-border-default": orbitColors.border.default,
  "--oc-border-strong": orbitColors.border.strong,
  "--oc-border-focus": orbitColors.border.focus,

  "--oc-text-primary": orbitColors.text.primary,
  "--oc-text-secondary": orbitColors.text.secondary,
  "--oc-text-muted": orbitColors.text.muted,
  "--oc-text-inverse": orbitColors.text.inverse,
  "--oc-text-on-accent": orbitColors.text.onAccent,

  "--oc-brand-primary": orbitColors.brand.primary,
  "--oc-brand-hover": orbitColors.brand.hover,
  "--oc-brand-active": orbitColors.brand.active,

  "--oc-semantic-success": orbitColors.semantic.success,
  "--oc-semantic-success-surface": orbitColors.semantic.successSurface,
  "--oc-semantic-warning": orbitColors.semantic.warning,
  "--oc-semantic-warning-surface": orbitColors.semantic.warningSurface,
  "--oc-semantic-error": orbitColors.semantic.error,
  "--oc-semantic-error-surface": orbitColors.semantic.errorSurface,
  "--oc-semantic-info": orbitColors.semantic.info,
  "--oc-semantic-info-surface": orbitColors.semantic.infoSurface,

  "--oc-ai-accent": orbitColors.ai.accent,
  "--oc-ai-surface": orbitColors.ai.surface,

  "--oc-font-family": orbitTypography.fontFamily,
  "--oc-code-family": orbitTypography.codeFamily,

  "--oc-radius-sm": `${orbitRadius.sm}px`,
  "--oc-radius-md": `${orbitRadius.md}px`,
  "--oc-radius-lg": `${orbitRadius.lg}px`,
  "--oc-radius-xl": `${orbitRadius.xl}px`,
  "--oc-radius-pill": `${orbitRadius.pill}px`,

  "--oc-duration-fast": `${orbitMotionDurations.fast}ms`,
  "--oc-duration-normal": `${orbitMotionDurations.normal}ms`,
  "--oc-duration-panel": `${orbitMotionDurations.panel}ms`,
  "--oc-duration-spinner": `${orbitMotionDurations.spinner}ms`,
};

/**
 * Top-level design token export grouping required semantic categories.
 */
export const orbitTokens = {
  color: orbitColors,
  spacing: orbitSpacing,
  radius: orbitRadius,
  typography: orbitTypography,
  controlHeight: orbitControlHeight,
  component: orbitComponent,
  shadow: orbitShadow,
  focus: orbitFocus,
  motion: orbitMotion,
  cssVariables: orbitCssVariables,
} as const;

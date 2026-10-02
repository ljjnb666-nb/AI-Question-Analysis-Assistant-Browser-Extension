import React from "react";
import { orbitTokens, orbitColors, orbitRadius, orbitTypography } from "./orbitTokens";

export * from "./orbitTokens";
export * from "./orbitPrimitives";
export * from "./orbitMotion";

export const SHARED_FONT_FAMILY = orbitTypography.fontFamily;

export const uiInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: orbitRadius.md,
  border: `1px solid ${orbitColors.border.default}`,
  background: orbitColors.bg.surfaceSubtle,
  color: orbitColors.text.primary,
  fontSize: orbitTypography.fontSize.md,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: SHARED_FONT_FAMILY,
  transition: `border-color ${orbitTokens.motion.fast}, box-shadow ${orbitTokens.motion.fast}`,
};

export const sectionSurfaceStyle: React.CSSProperties = {
  borderRadius: orbitRadius.lg,
  border: `1px solid ${orbitColors.border.subtle}`,
  background: orbitColors.bg.surface,
  boxShadow: orbitTokens.shadow.none,
};

export const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: orbitRadius.md,
  border: `1px solid ${orbitColors.brand.hover}`,
  background: orbitColors.brand.primary,
  color: "#FFFFFF",
  fontSize: orbitTypography.fontSize.sm,
  fontWeight: orbitTypography.fontWeight.semibold,
  lineHeight: 1,
  cursor: "pointer",
  letterSpacing: -0.1,
  fontFamily: SHARED_FONT_FAMILY,
  transition: `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}`,
  outline: "none",
};

export const secondaryButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: orbitRadius.md,
  border: `1px solid ${orbitColors.border.default}`,
  background: orbitColors.bg.surfaceRaised,
  color: orbitColors.text.primary,
  fontSize: orbitTypography.fontSize.sm,
  fontWeight: orbitTypography.fontWeight.semibold,
  lineHeight: 1,
  cursor: "pointer",
  letterSpacing: -0.1,
  fontFamily: SHARED_FONT_FAMILY,
  transition: `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}`,
  outline: "none",
};

export const dangerButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: orbitRadius.md,
  border: `1px solid ${orbitColors.semantic.errorHover}`,
  background: orbitColors.semantic.error,
  color: "#FFFFFF",
  fontSize: orbitTypography.fontSize.sm,
  fontWeight: orbitTypography.fontWeight.semibold,
  lineHeight: 1,
  cursor: "pointer",
  letterSpacing: -0.1,
  fontFamily: SHARED_FONT_FAMILY,
  transition: `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}`,
  outline: "none",
};

export const SectionCard: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <section
    className="settings-card"
    style={{
      ...sectionSurfaceStyle,
      padding: 14,
      position: "relative",
      boxSizing: "border-box",
    }}
  >
    <div
      style={{
        fontSize: orbitTypography.fontSize.md,
        fontWeight: orbitTypography.fontWeight.semibold,
        color: orbitColors.text.primary,
        letterSpacing: -0.1,
      }}
    >
      {title}
    </div>
    <div
      style={{
        fontSize: orbitTypography.fontSize.xs,
        lineHeight: orbitTypography.lineHeight.relaxed,
        color: orbitColors.text.secondary,
        marginTop: 3,
        marginBottom: 10,
      }}
    >
      {description}
    </div>
    {children}
  </section>
);

export const UiButton: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}> = ({ children, onClick, primary, danger, disabled }) => {
  const [isFocused, setIsFocused] = React.useState(false);
  const baseStyle = danger
    ? dangerButtonStyle
    : primary
      ? primaryButtonStyle
      : secondaryButtonStyle;

  const focusStyle: React.CSSProperties = isFocused && !disabled
    ? {
        outline: orbitTokens.focus.outline,
        outlineOffset: orbitTokens.focus.outlineOffset,
        boxShadow: orbitTokens.focus.focusRing,
      }
    : {
        outline: "none",
      };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={{
        ...baseStyle,
        background: disabled ? "rgba(255, 255, 255, 0.05)" : baseStyle.background,
        color: disabled ? orbitColors.text.muted : baseStyle.color,
        border: disabled ? `1px solid ${orbitColors.border.subtle}` : baseStyle.border,
        cursor: disabled ? "not-allowed" : "pointer",
        ...focusStyle,
      }}
    >
      {children}
    </button>
  );
};

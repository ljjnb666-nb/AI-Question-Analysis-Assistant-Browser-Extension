import React from "react";
import { orbitTokens, orbitColors, orbitSpacing, orbitRadius, orbitTypography } from "./orbitTokens";
import { OrbitButton, type OrbitButtonVariant } from "./orbitPrimitives";

export * from "./orbitTokens";
export * from "./orbitPrimitives";
export * from "./orbitMotion";
export * from "./orbitFocus";

export const SHARED_FONT_FAMILY = orbitTypography.fontFamily;

export const uiInputStyle: React.CSSProperties = {
  width: "100%",
  padding: `${orbitSpacing[2]}px ${orbitSpacing[3]}px`,
  borderRadius: orbitRadius.md,
  border: `1px solid ${orbitColors.border.default}`,
  background: orbitColors.bg.surfaceSubtle,
  color: orbitColors.text.primary,
  fontSize: orbitTypography.fontSize.md,
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
  color: orbitColors.control.onAccent,
  fontSize: orbitTypography.fontSize.sm,
  fontWeight: orbitTypography.fontWeight.semibold,
  lineHeight: 1,
  cursor: "pointer",
  letterSpacing: -0.1,
  fontFamily: SHARED_FONT_FAMILY,
  transition: `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}`,
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
};

export const dangerButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: orbitRadius.md,
  border: `1px solid ${orbitColors.semantic.errorHover}`,
  background: orbitColors.semantic.error,
  color: orbitColors.control.onAccent,
  fontSize: orbitTypography.fontSize.sm,
  fontWeight: orbitTypography.fontWeight.semibold,
  lineHeight: 1,
  cursor: "pointer",
  letterSpacing: -0.1,
  fontFamily: SHARED_FONT_FAMILY,
  transition: `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}`,
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

export interface UiButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  onClick: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export const UiButton: React.FC<UiButtonProps> = ({
  children,
  onClick,
  primary,
  danger,
  disabled,
  style,
  className,
  ...rest
}) => {
  const variant: OrbitButtonVariant = danger
    ? "danger"
    : primary
      ? "primary"
      : "secondary";

  return (
    <OrbitButton
      variant={variant}
      disabled={disabled}
      onClick={onClick}
      style={style}
      className={className}
      {...rest}
    >
      {children}
    </OrbitButton>
  );
};

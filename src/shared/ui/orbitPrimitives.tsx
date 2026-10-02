import React, { useState, useEffect } from "react";
import {
  orbitTokens,
  orbitColors,
  orbitSpacing,
  orbitRadius,
  orbitTypography,
  orbitControlHeight,
  orbitComponent,
} from "./orbitTokens";
import { usePrefersReducedMotion, ensureOrbitKeyframes } from "./orbitMotion";
import { useFocusVisible } from "./orbitFocus";
import type { UserFeedbackTone } from "./userFeedback";

export type OrbitButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type OrbitButtonSize = "sm" | "md" | "lg";

export interface OrbitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: OrbitButtonVariant;
  size?: OrbitButtonSize;
  isLoading?: boolean;
}

export const OrbitButton = React.forwardRef<HTMLButtonElement, OrbitButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      disabled = false,
      isLoading = false,
      style,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      ...rest
    },
    ref,
  ) => {
    const [isHovered, setIsHovered] = useState(false);
    const prefersReducedMotion = usePrefersReducedMotion();
    const { isFocusVisible, onFocus: handleFocusVisible, onBlur: handleBlurVisible } = useFocusVisible(
      disabled || isLoading,
    );

    useEffect(() => {
      if (isLoading) {
        ensureOrbitKeyframes();
      }
    }, [isLoading]);

    const height =
      size === "sm"
        ? orbitControlHeight.sm
        : size === "lg"
          ? orbitControlHeight.lg
          : orbitControlHeight.md;

    const paddingInline =
      size === "sm" ? orbitSpacing[2] : size === "lg" ? orbitSpacing[4] : orbitSpacing[3];

    const fontSize =
      size === "sm" ? orbitTypography.fontSize.sm : orbitTypography.fontSize.md;

    // Base colors per variant
    let background: string;
    let color: string;
    let border: string;

    if (disabled || isLoading) {
      background = orbitColors.control.disabledBg;
      color = orbitColors.control.disabledText;
      border = `1px solid ${orbitColors.border.subtle}`;
    } else {
      switch (variant) {
        case "primary":
          background = isHovered
            ? orbitColors.brand.hover
            : orbitColors.brand.primary;
          color = orbitColors.control.onAccent;
          border = `1px solid ${orbitColors.brand.hover}`;
          break;
        case "secondary":
          background = isHovered
            ? orbitColors.bg.surfaceInteractive
            : orbitColors.bg.surfaceRaised;
          color = orbitColors.text.primary;
          border = `1px solid ${isHovered ? orbitColors.border.strong : orbitColors.border.default}`;
          break;
        case "ghost":
          background = isHovered ? orbitColors.control.ghostHover : "transparent";
          color = orbitColors.text.primary;
          border = "1px solid transparent";
          break;
        case "danger":
          background = isHovered
            ? orbitColors.semantic.errorHover
            : orbitColors.semantic.error;
          color = orbitColors.control.onAccent;
          border = `1px solid ${orbitColors.semantic.errorHover}`;
          break;
      }
    }

    const focusRing = isFocusVisible
      ? {
          outline: orbitTokens.focus.outline,
          outlineOffset: orbitTokens.focus.outlineOffset,
          boxShadow: orbitTokens.focus.focusRing,
        }
      : {
          outline: "none",
        };

    const transition = prefersReducedMotion
      ? "none"
      : `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}, color ${orbitTokens.motion.fast}`;

    const combinedStyle: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: orbitSpacing[2],
      height,
      paddingLeft: paddingInline,
      paddingRight: paddingInline,
      borderRadius: orbitRadius.md,
      fontFamily: orbitTypography.fontFamily,
      fontSize,
      fontWeight: orbitTypography.fontWeight.semibold,
      lineHeight: 1,
      background,
      color,
      border,
      cursor: disabled || isLoading ? "not-allowed" : "pointer",
      boxSizing: "border-box",
      transition,
      userSelect: "none",
      textDecoration: "none",
      whiteSpace: "nowrap",
      ...focusRing,
      ...style,
    };

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled || isLoading}
        aria-busy={isLoading}
        style={combinedStyle}
        onMouseEnter={(e) => {
          setIsHovered(true);
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          setIsHovered(false);
          onMouseLeave?.(e);
        }}
        onFocus={(e) => {
          handleFocusVisible();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          handleBlurVisible();
          onBlur?.(e);
        }}
        {...rest}
      >
        {isLoading ? (
          <span
            aria-hidden="true"
            data-testid="orbit-loading-spinner"
            style={{
              display: "inline-block",
              width: orbitComponent.spinner.size,
              height: orbitComponent.spinner.size,
              border: `${orbitComponent.spinner.borderWidth}px solid currentColor`,
              borderTopColor: "transparent",
              borderRadius: orbitRadius.pill,
              animation: prefersReducedMotion ? "none" : `orbit-spin ${orbitTokens.motion.spinner} infinite`,
            }}
          />
        ) : null}
        {children}
      </button>
    );
  },
);
OrbitButton.displayName = "OrbitButton";

export type OrbitSurfaceVariant = "default" | "raised" | "interactive";

export interface OrbitSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: OrbitSurfaceVariant;
}

export const OrbitSurface = React.forwardRef<HTMLDivElement, OrbitSurfaceProps>(
  ({ children, variant = "default", style, onMouseEnter, onMouseLeave, ...rest }, ref) => {
    const [isHovered, setIsHovered] = useState(false);
    const prefersReducedMotion = usePrefersReducedMotion();

    let background: string;
    let border: string;
    let shadow: string = orbitTokens.shadow.none;

    switch (variant) {
      case "raised":
        background = orbitColors.bg.surfaceRaised;
        border = `1px solid ${orbitColors.border.default}`;
        shadow = orbitTokens.shadow.subtle;
        break;
      case "interactive":
        background = isHovered
          ? orbitColors.bg.surfaceInteractive
          : orbitColors.bg.surface;
        border = `1px solid ${isHovered ? orbitColors.border.strong : orbitColors.border.default}`;
        break;
      case "default":
      default:
        background = orbitColors.bg.surface;
        border = `1px solid ${orbitColors.border.subtle}`;
        break;
    }

    const transition = prefersReducedMotion
      ? "none"
      : `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}`;

    const surfaceStyle: React.CSSProperties = {
      background,
      border,
      borderRadius: orbitRadius.lg,
      boxShadow: shadow,
      boxSizing: "border-box",
      color: orbitColors.text.primary,
      fontFamily: orbitTypography.fontFamily,
      transition,
      ...style,
    };

    return (
      <div
        ref={ref}
        style={surfaceStyle}
        onMouseEnter={(e) => {
          if (variant === "interactive") setIsHovered(true);
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          if (variant === "interactive") setIsHovered(false);
          onMouseLeave?.(e);
        }}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
OrbitSurface.displayName = "OrbitSurface";

export type OrbitBadgeVariant = "neutral" | "success" | "warning" | "error" | "info" | "ai";

export interface OrbitBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: OrbitBadgeVariant;
  dot?: boolean;
}

export const OrbitBadge: React.FC<OrbitBadgeProps> = ({
  children,
  variant = "neutral",
  dot = false,
  style,
  ...rest
}) => {
  let background: string;
  let color: string;
  let border: string;
  let dotColor: string;

  switch (variant) {
    case "success":
      background = orbitColors.semantic.successSurface;
      color = orbitColors.semantic.success;
      border = `1px solid ${orbitColors.semantic.successBorder}`;
      dotColor = orbitColors.semantic.success;
      break;
    case "warning":
      background = orbitColors.semantic.warningSurface;
      color = orbitColors.semantic.warning;
      border = `1px solid ${orbitColors.semantic.warningBorder}`;
      dotColor = orbitColors.semantic.warning;
      break;
    case "error":
      background = orbitColors.semantic.errorSurface;
      color = orbitColors.semantic.error;
      border = `1px solid ${orbitColors.semantic.errorBorder}`;
      dotColor = orbitColors.semantic.error;
      break;
    case "info":
      background = orbitColors.semantic.infoSurface;
      color = orbitColors.semantic.info;
      border = `1px solid ${orbitColors.semantic.infoBorder}`;
      dotColor = orbitColors.semantic.info;
      break;
    case "ai":
      background = orbitColors.ai.surface;
      color = orbitColors.ai.accent;
      border = `1px solid ${orbitColors.ai.border}`;
      dotColor = orbitColors.ai.accent;
      break;
    case "neutral":
    default:
      background = orbitColors.bg.surfaceRaised;
      color = orbitColors.text.secondary;
      border = `1px solid ${orbitColors.border.subtle}`;
      dotColor = orbitColors.text.muted;
      break;
  }

  const badgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: orbitComponent.badge.gap,
    padding: `2px ${orbitSpacing[2]}px`,
    borderRadius: orbitRadius.pill,
    fontSize: orbitTypography.fontSize.xs,
    fontFamily: orbitTypography.fontFamily,
    fontWeight: orbitTypography.fontWeight.medium,
    lineHeight: 1.4,
    background,
    color,
    border,
    boxSizing: "border-box",
    whiteSpace: "nowrap",
    ...style,
  };

  return (
    <span style={badgeStyle} {...rest}>
      {dot && (
        <span
          aria-hidden="true"
          style={{
            width: orbitComponent.badge.dotSize,
            height: orbitComponent.badge.dotSize,
            borderRadius: orbitRadius.pill,
            backgroundColor: dotColor,
          }}
        />
      )}
      {children}
    </span>
  );
};

export interface OrbitStatusProps extends React.HTMLAttributes<HTMLDivElement> {
  tone: UserFeedbackTone | "ai";
  label: string;
  secondaryText?: string;
}

export const OrbitStatus: React.FC<OrbitStatusProps> = ({
  tone,
  label,
  secondaryText,
  style,
  ...rest
}) => {
  let indicatorColor: string;
  const statusText = label;

  switch (tone) {
    case "success":
      indicatorColor = orbitColors.semantic.success;
      break;
    case "warning":
      indicatorColor = orbitColors.semantic.warning;
      break;
    case "error":
      indicatorColor = orbitColors.semantic.error;
      break;
    case "info":
      indicatorColor = orbitColors.semantic.info;
      break;
    case "ai":
      indicatorColor = orbitColors.ai.accent;
      break;
  }

  return (
    <div
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: orbitSpacing[2],
        fontFamily: orbitTypography.fontFamily,
        fontSize: orbitTypography.fontSize.sm,
        color: orbitColors.text.primary,
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          width: orbitComponent.status.dotSize,
          height: orbitComponent.status.dotSize,
          borderRadius: orbitRadius.pill,
          backgroundColor: indicatorColor,
          flexShrink: 0,
        }}
      />
      <span>{statusText}</span>
      {secondaryText ? (
        <span style={{ color: orbitColors.text.muted, fontSize: orbitTypography.fontSize.xs }}>
          {secondaryText}
        </span>
      ) : null}
    </div>
  );
};

export interface OrbitInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  errorText?: string;
}

export const OrbitInput = React.forwardRef<HTMLInputElement, OrbitInputProps>(
  ({ label, helperText, errorText, disabled, style, onFocus, onBlur, id, ...rest }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const helperId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;

    const prefersReducedMotion = usePrefersReducedMotion();
    const { isFocusVisible, onFocus: handleFocusVisible, onBlur: handleBlurVisible } = useFocusVisible(disabled);

    const hasError = Boolean(errorText);
    const describedBy =
      [errorText ? errorId : null, helperText ? helperId : null].filter(Boolean).join(" ") || undefined;

    const borderColor = hasError
      ? orbitColors.semantic.error
      : isFocusVisible
        ? orbitColors.border.focus
        : orbitColors.border.default;

    const focusStyle: React.CSSProperties = isFocusVisible
      ? {
          outline: "none",
          border: `1px solid ${borderColor}`,
          boxShadow: hasError
            ? `0 0 0 1px ${orbitColors.semantic.error}`
            : `0 0 0 2px ${orbitColors.brand.subtle}`,
        }
      : {
          outline: "none",
          border: `1px solid ${borderColor}`,
        };

    const transition = prefersReducedMotion
      ? "none"
      : `border-color ${orbitTokens.motion.fast}, box-shadow ${orbitTokens.motion.fast}`;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: orbitSpacing[1], width: "100%" }}>
        {label ? (
          <label
            htmlFor={inputId}
            style={{
              fontSize: orbitTypography.fontSize.xs,
              fontWeight: orbitTypography.fontWeight.medium,
              color: disabled ? orbitColors.text.muted : orbitColors.text.secondary,
              fontFamily: orbitTypography.fontFamily,
            }}
          >
            {label}
          </label>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={hasError ? "true" : undefined}
          aria-describedby={describedBy}
          style={{
            height: orbitControlHeight.md,
            padding: `0 ${orbitSpacing[3]}px`,
            borderRadius: orbitRadius.md,
            background: disabled ? orbitColors.control.inputDisabledBg : orbitColors.bg.surfaceSubtle,
            color: disabled ? orbitColors.text.muted : orbitColors.text.primary,
            fontSize: orbitTypography.fontSize.md,
            fontFamily: orbitTypography.fontFamily,
            boxSizing: "border-box",
            width: "100%",
            transition,
            ...focusStyle,
            ...style,
          }}
          onFocus={(e) => {
            handleFocusVisible();
            onFocus?.(e);
          }}
          onBlur={(e) => {
            handleBlurVisible();
            onBlur?.(e);
          }}
          {...rest}
        />
        {errorText ? (
          <span
            id={errorId}
            role="alert"
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.semantic.error,
              fontFamily: orbitTypography.fontFamily,
            }}
          >
            {errorText}
          </span>
        ) : null}
        {helperText ? (
          <span
            id={helperId}
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.text.muted,
              fontFamily: orbitTypography.fontFamily,
            }}
          >
            {helperText}
          </span>
        ) : null}
      </div>
    );
  },
);
OrbitInput.displayName = "OrbitInput";

export interface OrbitSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  errorText?: string;
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
}

export const OrbitSelect = React.forwardRef<HTMLSelectElement, OrbitSelectProps>(
  ({ label, helperText, errorText, disabled, options, children, style, id, onFocus, onBlur, ...rest }, ref) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;
    const helperId = `${selectId}-helper`;
    const errorId = `${selectId}-error`;

    const prefersReducedMotion = usePrefersReducedMotion();
    const { isFocusVisible, onFocus: handleFocusVisible, onBlur: handleBlurVisible } = useFocusVisible(disabled);

    const hasError = Boolean(errorText);
    const describedBy =
      [errorText ? errorId : null, helperText ? helperId : null].filter(Boolean).join(" ") || undefined;

    const borderColor = hasError
      ? orbitColors.semantic.error
      : isFocusVisible
        ? orbitColors.border.focus
        : orbitColors.border.default;

    const focusStyle: React.CSSProperties = isFocusVisible
      ? {
          outline: "none",
          border: `1px solid ${borderColor}`,
          boxShadow: hasError
            ? `0 0 0 1px ${orbitColors.semantic.error}`
            : `0 0 0 2px ${orbitColors.brand.subtle}`,
        }
      : {
          outline: "none",
          border: `1px solid ${borderColor}`,
        };

    const transition = prefersReducedMotion
      ? "none"
      : `border-color ${orbitTokens.motion.fast}, box-shadow ${orbitTokens.motion.fast}`;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: orbitSpacing[1], width: "100%" }}>
        {label ? (
          <label
            htmlFor={selectId}
            style={{
              fontSize: orbitTypography.fontSize.xs,
              fontWeight: orbitTypography.fontWeight.medium,
              color: disabled ? orbitColors.text.muted : orbitColors.text.secondary,
              fontFamily: orbitTypography.fontFamily,
            }}
          >
            {label}
          </label>
        ) : null}
        <select
          ref={ref}
          id={selectId}
          disabled={disabled}
          aria-invalid={hasError ? "true" : undefined}
          aria-describedby={describedBy}
          style={{
            height: orbitControlHeight.md,
            padding: `0 ${orbitSpacing[3]}px`,
            borderRadius: orbitRadius.md,
            background: disabled ? orbitColors.control.inputDisabledBg : orbitColors.bg.surfaceSubtle,
            color: disabled ? orbitColors.text.muted : orbitColors.text.primary,
            fontSize: orbitTypography.fontSize.md,
            fontFamily: orbitTypography.fontFamily,
            boxSizing: "border-box",
            width: "100%",
            cursor: disabled ? "not-allowed" : "pointer",
            transition,
            ...focusStyle,
            ...style,
          }}
          onFocus={(e) => {
            handleFocusVisible();
            onFocus?.(e);
          }}
          onBlur={(e) => {
            handleBlurVisible();
            onBlur?.(e);
          }}
          {...rest}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        {errorText ? (
          <span
            id={errorId}
            role="alert"
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.semantic.error,
              fontFamily: orbitTypography.fontFamily,
            }}
          >
            {errorText}
          </span>
        ) : null}
        {helperText ? (
          <span
            id={helperId}
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.text.muted,
              fontFamily: orbitTypography.fontFamily,
            }}
          >
            {helperText}
          </span>
        ) : null}
      </div>
    );
  },
);
OrbitSelect.displayName = "OrbitSelect";

export interface OrbitToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export const OrbitToggle: React.FC<OrbitToggleProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}) => {
  const generatedId = React.useId();
  const toggleId = id ?? generatedId;
  const labelId = `${toggleId}-label`;

  const prefersReducedMotion = usePrefersReducedMotion();
  const { isFocusVisible, onFocus: handleFocusVisible, onBlur: handleBlurVisible } = useFocusVisible(disabled);

  // Compute effective accessible labelling
  const effectiveAriaLabelledBy = ariaLabelledBy ?? (label ? labelId : undefined);
  const effectiveAriaLabel = effectiveAriaLabelledBy ? undefined : ariaLabel;

  if (process.env.NODE_ENV !== "production") {
    if (!label && !ariaLabel && !ariaLabelledBy) {
      console.warn("OrbitToggle: Switch rendered without accessible name. Provide label, aria-label, or aria-labelledby.");
    }
  }

  const trackTransition = prefersReducedMotion
    ? "none"
    : `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}`;

  const thumbTransition = prefersReducedMotion
    ? "none"
    : `transform ${orbitTokens.motion.fast}`;

  const toggleContent = (
    <button
      id={toggleId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={effectiveAriaLabel}
      aria-labelledby={effectiveAriaLabelledBy}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      onFocus={handleFocusVisible}
      onBlur={handleBlurVisible}
      style={{
        width: orbitComponent.toggle.trackWidth,
        height: orbitComponent.toggle.trackHeight,
        borderRadius: orbitRadius.pill,
        background: disabled
          ? orbitColors.control.toggleDisabledBg
          : checked
            ? orbitColors.brand.primary
            : orbitColors.bg.surfaceInteractive,
        border: `1px solid ${isFocusVisible ? orbitColors.brand.primary : orbitColors.border.default}`,
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        padding: orbitComponent.toggle.trackPadding,
        boxSizing: "border-box",
        outline: isFocusVisible ? orbitTokens.focus.outline : "none",
        outlineOffset: orbitTokens.focus.outlineOffset,
        boxShadow: isFocusVisible ? orbitTokens.focus.focusRing : "none",
        transition: trackTransition,
      }}
    >
      <span
        style={{
          display: "block",
          width: orbitComponent.toggle.thumbSize,
          height: orbitComponent.toggle.thumbSize,
          borderRadius: orbitRadius.pill,
          background: disabled ? orbitColors.text.muted : orbitColors.control.onAccent,
          transform: checked
            ? `translateX(${orbitComponent.toggle.thumbTranslateX}px)`
            : "translateX(0px)",
          transition: thumbTransition,
        }}
      />
    </button>
  );

  if (!label) {
    return toggleContent;
  }

  return (
    <label
      htmlFor={toggleId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: orbitSpacing[2],
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
        fontFamily: orbitTypography.fontFamily,
      }}
    >
      {toggleContent}
      <span
        id={labelId}
        style={{
          fontSize: orbitTypography.fontSize.sm,
          color: disabled ? orbitColors.text.muted : orbitColors.text.primary,
        }}
      >
        {label}
      </span>
    </label>
  );
};

export interface OrbitSectionHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const OrbitSectionHeader: React.FC<OrbitSectionHeaderProps> = ({
  title,
  description,
  action,
}) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: orbitSpacing[3],
        marginBottom: orbitSpacing[2],
        fontFamily: orbitTypography.fontFamily,
      }}
    >
      <div>
        <h3
          style={{
            fontSize: orbitTypography.fontSize.base,
            fontWeight: orbitTypography.fontWeight.semibold,
            color: orbitColors.text.primary,
            margin: 0,
            lineHeight: orbitTypography.lineHeight.tight,
          }}
        >
          {title}
        </h3>
        {description ? (
          <p
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.text.secondary,
              margin: `${orbitSpacing[1]}px 0 0 0`,
              lineHeight: orbitTypography.lineHeight.normal,
            }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
};

export interface OrbitDisclosureProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export const OrbitDisclosure: React.FC<OrbitDisclosureProps> = ({
  title,
  children,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const prefersReducedMotion = usePrefersReducedMotion();
  const { isFocusVisible, onFocus: handleFocusVisible, onBlur: handleBlurVisible } = useFocusVisible();

  const chevronTransition = prefersReducedMotion
    ? "none"
    : `transform ${orbitTokens.motion.fast}`;

  return (
    <div
      style={{
        borderRadius: orbitRadius.md,
        border: `1px solid ${orbitColors.border.subtle}`,
        background: orbitColors.bg.surfaceSubtle,
        overflow: "hidden",
        fontFamily: orbitTypography.fontFamily,
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onFocus={handleFocusVisible}
        onBlur={handleBlurVisible}
        aria-expanded={isOpen}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `${orbitSpacing[2]}px ${orbitSpacing[3]}px`,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: orbitColors.text.secondary,
          fontSize: orbitTypography.fontSize.xs,
          fontWeight: orbitTypography.fontWeight.medium,
          textAlign: "left",
          outline: isFocusVisible ? orbitTokens.focus.outline : "none",
          outlineOffset: orbitTokens.focus.outlineOffset,
          boxShadow: isFocusVisible ? orbitTokens.focus.focusRing : "none",
        }}
      >
        <span>{title}</span>
        <span
          style={{
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            transition: chevronTransition,
            fontSize: orbitComponent.disclosure.chevronSize,
            color: orbitColors.text.muted,
          }}
        >
          ▶
        </span>
      </button>
      {isOpen ? (
        <div
          style={{
            padding: `${orbitSpacing[2]}px ${orbitSpacing[3]}px`,
            borderTop: `1px solid ${orbitColors.border.subtle}`,
            fontSize: orbitTypography.fontSize.xs,
            color: orbitColors.text.muted,
            lineHeight: orbitTypography.lineHeight.normal,
            fontFamily: orbitTypography.codeFamily,
            wordBreak: "break-all",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};

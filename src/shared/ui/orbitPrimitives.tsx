import React, { useState } from "react";
import { orbitTokens, orbitColors, orbitSpacing, orbitRadius, orbitTypography, orbitControlHeight } from "./orbitTokens";
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
    const [isFocused, setIsFocused] = useState(false);

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
      background = "rgba(255, 255, 255, 0.05)";
      color = orbitColors.text.muted;
      border = `1px solid ${orbitColors.border.subtle}`;
    } else {
      switch (variant) {
        case "primary":
          background = isHovered
            ? orbitColors.brand.hover
            : orbitColors.brand.primary;
          color = "#FFFFFF";
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
          background = isHovered ? "rgba(255, 255, 255, 0.06)" : "transparent";
          color = orbitColors.text.primary;
          border = "1px solid transparent";
          break;
        case "danger":
          background = isHovered
            ? orbitColors.semantic.errorHover
            : orbitColors.semantic.error;
          color = "#FFFFFF";
          border = `1px solid ${orbitColors.semantic.errorHover}`;
          break;
      }
    }

    const focusRing = isFocused && !disabled
      ? {
          outline: orbitTokens.focus.outline,
          outlineOffset: orbitTokens.focus.outlineOffset,
          boxShadow: orbitTokens.focus.focusRing,
        }
      : {
          outline: "none",
        };

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
      transition: `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}, color ${orbitTokens.motion.fast}`,
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
          setIsFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      >
        {isLoading ? (
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              border: "2px solid currentColor",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
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

    const surfaceStyle: React.CSSProperties = {
      background,
      border,
      borderRadius: orbitRadius.lg,
      boxShadow: shadow,
      boxSizing: "border-box",
      color: orbitColors.text.primary,
      fontFamily: orbitTypography.fontFamily,
      transition: `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}`,
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
    gap: 6,
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
            width: 6,
            height: 6,
            borderRadius: "50%",
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
          width: 8,
          height: 8,
          borderRadius: "50%",
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
    const [isFocused, setIsFocused] = useState(false);
    const inputId = id || (label ? `orbit-input-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

    const hasError = Boolean(errorText);

    const borderColor = hasError
      ? orbitColors.semantic.error
      : isFocused
        ? orbitColors.border.focus
        : orbitColors.border.default;

    const focusStyle: React.CSSProperties = isFocused
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
          style={{
            height: orbitControlHeight.md,
            padding: `0 ${orbitSpacing[3]}px`,
            borderRadius: orbitRadius.md,
            background: disabled ? "rgba(255, 255, 255, 0.03)" : orbitColors.bg.surfaceSubtle,
            color: disabled ? orbitColors.text.muted : orbitColors.text.primary,
            fontSize: orbitTypography.fontSize.md,
            fontFamily: orbitTypography.fontFamily,
            boxSizing: "border-box",
            width: "100%",
            transition: `border-color ${orbitTokens.motion.fast}, box-shadow ${orbitTokens.motion.fast}`,
            ...focusStyle,
            ...style,
          }}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {errorText ? (
          <span
            role="alert"
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.semantic.error,
              fontFamily: orbitTypography.fontFamily,
            }}
          >
            {errorText}
          </span>
        ) : helperText ? (
          <span
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
    const [isFocused, setIsFocused] = useState(false);
    const selectId = id || (label ? `orbit-select-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
    const hasError = Boolean(errorText);

    const borderColor = hasError
      ? orbitColors.semantic.error
      : isFocused
        ? orbitColors.border.focus
        : orbitColors.border.default;

    const focusStyle: React.CSSProperties = isFocused
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
          style={{
            height: orbitControlHeight.md,
            padding: `0 ${orbitSpacing[3]}px`,
            borderRadius: orbitRadius.md,
            background: disabled ? "rgba(255, 255, 255, 0.03)" : orbitColors.bg.surfaceSubtle,
            color: disabled ? orbitColors.text.muted : orbitColors.text.primary,
            fontSize: orbitTypography.fontSize.md,
            fontFamily: orbitTypography.fontFamily,
            boxSizing: "border-box",
            width: "100%",
            cursor: disabled ? "not-allowed" : "pointer",
            transition: `border-color ${orbitTokens.motion.fast}, box-shadow ${orbitTokens.motion.fast}`,
            ...focusStyle,
            ...style,
          }}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
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
            role="alert"
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.semantic.error,
              fontFamily: orbitTypography.fontFamily,
            }}
          >
            {errorText}
          </span>
        ) : helperText ? (
          <span
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
}

export const OrbitToggle: React.FC<OrbitToggleProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  id,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const toggleId = id || (label ? `orbit-toggle-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

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
      <button
        id={toggleId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={{
          width: 38,
          height: 22,
          borderRadius: orbitRadius.pill,
          background: disabled
            ? "rgba(255, 255, 255, 0.08)"
            : checked
              ? orbitColors.brand.primary
              : orbitColors.bg.surfaceInteractive,
          border: `1px solid ${isFocused ? orbitColors.brand.primary : orbitColors.border.default}`,
          position: "relative",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: 2,
          boxSizing: "border-box",
          outline: isFocused ? orbitTokens.focus.outline : "none",
          outlineOffset: orbitTokens.focus.outlineOffset,
          transition: `background ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}`,
        }}
      >
        <span
          style={{
            display: "block",
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: disabled ? orbitColors.text.muted : "#FFFFFF",
            transform: checked ? "translateX(16px)" : "translateX(0px)",
            transition: `transform ${orbitTokens.motion.fast}`,
          }}
        />
      </button>
      {label ? (
        <span
          style={{
            fontSize: orbitTypography.fontSize.sm,
            color: disabled ? orbitColors.text.muted : orbitColors.text.primary,
          }}
        >
          {label}
        </span>
      ) : null}
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
          outline: "none",
        }}
      >
        <span>{title}</span>
        <span
          style={{
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            transition: `transform ${orbitTokens.motion.fast}`,
            fontSize: 10,
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

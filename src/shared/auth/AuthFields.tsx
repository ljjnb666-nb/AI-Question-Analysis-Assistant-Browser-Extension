import React from "react";
import { orbitColors, orbitRadius, orbitSpacing, orbitTypography, orbitTokens } from "@/shared/ui/orbitTokens";
import { useFocusVisible } from "@/shared/ui/orbitFocus";
import { usePrefersReducedMotion } from "@/shared/ui/orbitMotion";

export interface AuthVerificationCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  digitLabel?: (index: number) => string;
  lang?: "zh" | "en";
}

const VerificationSlot: React.FC<{
  index: number;
  digit: string;
  ariaLabel: string;
  onChange: (val: string) => void;
  reducedMotion: boolean;
  inputRef: (node: HTMLInputElement | null) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}> = ({ index, digit, ariaLabel, onChange, reducedMotion, inputRef, onKeyDown }) => {
  const { isFocusVisible, onFocus, onBlur } = useFocusVisible();
  return (
    <input
      key={index}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      maxLength={6}
      aria-label={ariaLabel}
      value={digit.trim()}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        onFocus();
        event.currentTarget.select();
      }}
      onBlur={onBlur}
      style={{
        width: "100%",
        minWidth: 0,
        height: 40,
        borderRadius: orbitRadius.md,
        border: `1px solid ${isFocusVisible ? orbitColors.brand.primary : orbitColors.border.default}`,
        background: orbitColors.bg.surfaceSubtle,
        color: orbitColors.text.primary,
        fontSize: 16,
        fontWeight: orbitTypography.fontWeight.bold,
        textAlign: "center",
        outline: isFocusVisible ? orbitTokens.focus.outline : "none",
        outlineOffset: orbitTokens.focus.outlineOffset,
        boxSizing: "border-box",
        fontFamily: orbitTypography.fontFamily,
        transition: reducedMotion ? "none" : `border-color ${orbitTokens.motion.fast}, box-shadow ${orbitTokens.motion.fast}`,
      }}
    />
  );
};

export const AuthVerificationCodeInput: React.FC<AuthVerificationCodeInputProps> = ({
  value, onChange, ariaLabel = "验证码", digitLabel, lang,
}) => {
  const reducedMotion = usePrefersReducedMotion();
  const inputRefs = React.useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");
  const focusDigit = (index: number) =>
    inputRefs.current[Math.max(0, Math.min(index, 5))]?.focus();

  const getDigitAriaLabel = (index: number): string => {
    if (digitLabel) return digitLabel(index);
    if (lang === "en" || /^[a-zA-Z\\s]+$/.test(ariaLabel)) {
      return `Verification code digit ${index + 1}`;
    }
    return `验证码第 ${index + 1} 位`;
  };

  const handleValueChange = (index: number, raw: string) => {
    const cleaned = raw.replace(/\\D/g, "");
    const offset = Math.min(index, value.length);
    if (!cleaned) {
      onChange(value.slice(0, offset) + value.slice(offset + 1));
      focusDigit(offset);
      return;
    }
    const next = (value.slice(0, offset) + cleaned + value.slice(offset + cleaned.length)).slice(0, 6);
    onChange(next);
    focusDigit(Math.min(offset + cleaned.length, 5));
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index]?.trim() && index > 0) {
      event.preventDefault();
      onChange(value.slice(0, index - 1) + value.slice(index));
      focusDigit(index - 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusDigit(index - 1);
    } else if (event.key === "ArrowRight" && index < 5) {
      event.preventDefault();
      focusDigit(index + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusDigit(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusDigit(Math.min(value.length, 5));
    }
  };

  return (
    <div role="group" aria-label={ariaLabel}
      style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: orbitSpacing[2] }}>
      {digits.map((digit, index) => (
        <VerificationSlot
          key={index} index={index} digit={digit}
          ariaLabel={getDigitAriaLabel(index)}
          onChange={(raw) => handleValueChange(index, raw)}
          inputRef={(node) => { inputRefs.current[index] = node; }}
          onKeyDown={(event) => handleKeyDown(index, event)}
          reducedMotion={reducedMotion}
        />
      ))}
    </div>
  );
};

export interface AuthPasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisibility: () => void;
  placeholder: string;
  showLabel: string;
  hideLabel: string;
  id?: string;
  label?: string;
  ariaLabel?: string;
}

export const AuthPasswordField: React.FC<AuthPasswordFieldProps> = ({
  value,
  onChange,
  visible,
  onToggleVisibility,
  placeholder,
  showLabel,
  hideLabel,
  id,
  label,
  ariaLabel,
}) => {
  const reducedMotion = usePrefersReducedMotion();
  const inputFocus = useFocusVisible();
  const toggleFocus = useFocusVisible();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: orbitSpacing[1], width: "100%" }}>
      {label ? (
        <label
          htmlFor={id}
          style={{
            fontSize: orbitTypography.fontSize.xs,
            fontWeight: orbitTypography.fontWeight.medium,
            color: orbitColors.text.secondary,
            fontFamily: orbitTypography.fontFamily,
          }}
        >
          {label}
        </label>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          alignItems: "center",
          gap: orbitSpacing[2],
          width: "100%",
          paddingRight: orbitSpacing[2],
          borderRadius: orbitRadius.md,
          border: `1px solid ${inputFocus.isFocusVisible ? orbitColors.brand.primary : orbitColors.border.default}`,
          background: orbitColors.bg.surfaceSubtle,
          boxSizing: "border-box",
          outline: inputFocus.isFocusVisible ? orbitTokens.focus.outline : "none",
          outlineOffset: orbitTokens.focus.outlineOffset,
          transition: reducedMotion ? "none" : `border-color ${orbitTokens.motion.fast}, box-shadow ${orbitTokens.motion.fast}`,
        }}
      >
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={inputFocus.onFocus}
          onBlur={inputFocus.onBlur}
          placeholder={placeholder}
          aria-label={ariaLabel || label || placeholder}
          style={{
            width: "100%",
            height: 36,
            padding: `0 ${orbitSpacing[3]}px`,
            border: "none",
            background: "transparent",
            color: orbitColors.text.primary,
            fontSize: orbitTypography.fontSize.sm,
            outline: "none",
            boxSizing: "border-box",
            fontFamily: orbitTypography.fontFamily,
          }}
        />
        {value ? (
          <button
            type="button"
            onClick={onToggleVisibility}
            onFocus={toggleFocus.onFocus}
            onBlur={toggleFocus.onBlur}
            aria-label={visible ? hideLabel : showLabel}
            style={{
              border: "none",
              background: "transparent",
              color: orbitColors.brand.linkText,
              cursor: "pointer",
              fontSize: orbitTypography.fontSize.xs,
              fontWeight: orbitTypography.fontWeight.semibold,
              padding: `2px ${orbitSpacing[1]}px`,
              borderRadius: orbitRadius.sm,
              fontFamily: orbitTypography.fontFamily,
              outline: toggleFocus.isFocusVisible ? orbitTokens.focus.outline : "none",
              outlineOffset: orbitTokens.focus.outlineOffset,
            }}
          >
            {visible ? hideLabel : showLabel}
          </button>
        ) : (
          <span style={{ width: 28 }} />
        )}
      </div>
    </div>
  );
};



import React from "react";

const verificationSlotStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 40,
  borderRadius: 10,
  border: "1px solid rgba(76, 229, 255, 0.16)",
  background: "rgba(7, 17, 34, 0.84)",
  color: "#eefcff",
  fontSize: 16,
  fontWeight: 700,
  textAlign: "center",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: '"Bahnschrift", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
};

const passwordFieldShellStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: 8,
  width: "100%",
  paddingRight: 10,
  borderRadius: 12,
  border: "1px solid rgba(76, 229, 255, 0.12)",
  background: "rgba(7, 17, 34, 0.78)",
  boxSizing: "border-box",
};

const passwordInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "none",
  background: "transparent",
  color: "#eefcff",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: '"Bahnschrift", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
};

const passwordToggleStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#8ef3ff",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 650,
  padding: "0 2px",
  fontFamily: '"Bahnschrift", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
};

export const AuthVerificationCodeInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}> = ({ value, onChange, ariaLabel = "验证码" }) => {
  const digits = value.padEnd(6, " ").slice(0, 6).split("");

  const handleValueChange = (index: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, "");
    if (!cleaned) {
      const next = value.padEnd(6, " ").slice(0, 6).split("");
      next[index] = " ";
      onChange(next.join("").replace(/\s/g, ""));
      return;
    }

    const next = value.padEnd(6, " ").slice(0, 6).split("");
    for (let offset = 0; offset < cleaned.length && index + offset < 6; offset += 1) {
      next[index + offset] = cleaned[offset];
    }
    onChange(next.join("").replace(/\s/g, "").slice(0, 6));
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6 }}
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          inputMode="numeric"
          maxLength={6}
          aria-label={`${ariaLabel} 第 ${index + 1} 位`}
          value={digit.trim()}
          onChange={(event) => handleValueChange(index, event.target.value)}
          style={verificationSlotStyle}
        />
      ))}
    </div>
  );
};

export const AuthPasswordField: React.FC<{
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
}> = ({
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
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
    {label ? (
      <label
        htmlFor={id}
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "#94a3b8",
        }}
      >
        {label}
      </label>
    ) : null}
    <div style={passwordFieldShellStyle}>
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || label || placeholder}
        style={passwordInputStyle}
      />
      {value ? (
        <button
          type="button"
          onClick={onToggleVisibility}
          aria-label={visible ? hideLabel : showLabel}
          style={passwordToggleStyle}
        >
          {visible ? hideLabel : showLabel}
        </button>
      ) : (
        <span style={{ width: 28 }} />
      )}
    </div>
  </div>
);


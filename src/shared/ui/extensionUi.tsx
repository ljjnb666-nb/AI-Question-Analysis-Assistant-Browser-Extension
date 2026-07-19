import React from "react";

export const SHARED_FONT_FAMILY =
  '"Bahnschrift", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export const uiInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255, 255, 255, 0.08)",
  background: "rgba(15, 23, 42, 0.6)",
  color: "#f8fafc",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: SHARED_FONT_FAMILY,
  transition: "border-color 0.2s ease, box-shadow 0.2s ease",
};

export const sectionSurfaceStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255, 255, 255, 0.06)",
  background: "linear-gradient(145deg, rgba(16, 22, 40, 0.75), rgba(10, 14, 28, 0.85))",
  boxShadow:
    "0 8px 32px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
  backdropFilter: "blur(20px)",
};

export const primaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255, 255, 255, 0.1)",
  background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  backgroundColor: "transparent",
  color: "#ffffff",
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
  cursor: "pointer",
  boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)",
  letterSpacing: -0.1,
  fontFamily: SHARED_FONT_FAMILY,
  transition: "transform 0.2s ease, box-shadow 0.2s ease",
};

export const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255, 255, 255, 0.08)",
  background: "linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)",
  backgroundColor: "transparent",
  color: "#e2e8f0",
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
  cursor: "pointer",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
  letterSpacing: -0.1,
  fontFamily: SHARED_FONT_FAMILY,
  transition: "transform 0.2s ease, background 0.2s ease",
};

export const dangerButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255, 255, 255, 0.1)",
  background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
  backgroundColor: "transparent",
  color: "#ffffff",
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
  cursor: "pointer",
  boxShadow: "0 4px 12px rgba(239, 68, 68, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2)",
  letterSpacing: -0.1,
  fontFamily: SHARED_FONT_FAMILY,
  transition: "transform 0.2s ease, box-shadow 0.2s ease",
};

export const SectionCard: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <section
    className="settings-card"
    style={{ ...sectionSurfaceStyle, padding: 14, position: "relative", overflow: "hidden" }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(180deg, rgba(99, 102, 241, 0.05), rgba(99, 102, 241, 0) 34%)",
        pointerEvents: "none",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 1,
        borderRadius: 15,
        border: "1px solid rgba(255,255,255,0.02)",
        pointerEvents: "none",
      }}
    />
    <div style={{ fontSize: 13, fontWeight: 600, color: "#f8fafc", letterSpacing: -0.1 }}>
      {title}
    </div>
    <div
      style={{
        fontSize: 11,
        lineHeight: 1.55,
        color: "#94a3b8",
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
  const baseStyle = danger
    ? dangerButtonStyle
    : primary
      ? primaryButtonStyle
      : secondaryButtonStyle;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...baseStyle,
        background: disabled ? "rgba(66, 76, 94, 0.5)" : baseStyle.background,
        backgroundColor: disabled ? "rgba(66, 76, 94, 0.5)" : (baseStyle.backgroundColor || "transparent"),
        color: disabled ? "#93a0b1" : baseStyle.color,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "inset 0 1px 0 rgba(255,255,255,0.04)" : baseStyle.boxShadow,
      }}
    >
      {children}
    </button>
  );
};

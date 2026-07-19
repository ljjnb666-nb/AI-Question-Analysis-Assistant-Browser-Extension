import React from "react";

export const sidePanelCardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255, 255, 255, 0.06)",
  background: "linear-gradient(180deg, rgba(16, 24, 48, 0.8), rgba(10, 15, 30, 0.85))",
  boxShadow:
    "0 8px 32px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
  backdropFilter: "blur(20px)",
};

export const historyCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255, 255, 255, 0.06)",
  borderRadius: 16,
  background: "linear-gradient(180deg, rgba(16, 24, 48, 0.8), rgba(10, 15, 30, 0.85))",
  boxShadow:
    "0 8px 32px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
  backdropFilter: "blur(20px)",
};

export const sidePanelShellStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  overflow: "hidden",
  background:
    "radial-gradient(circle at 0% 0%, rgba(99, 102, 241, 0.12), transparent 30%), radial-gradient(circle at 100% 0%, rgba(139, 92, 246, 0.08), transparent 30%), linear-gradient(180deg, #070913 0%, #0f111a 60%, #070913 100%)",
  color: "#f8fafc",
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

export const sidePanelMutedTextStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.55,
  color: "#94a3b8",
};

export const panelChromeInsetStyle: React.CSSProperties = {
  position: "absolute",
  inset: 6,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.02)",
  pointerEvents: "none",
};

export const PanelChrome: React.FC<{
  glow: string;
  bottom?: number;
  height?: number;
  overlay?: string;
}> = ({
  glow,
  bottom = -10,
  height = 22,
  overlay = "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0) 28%)",
}) => (
  <>
    <div
      style={{
        position: "absolute",
        left: 18,
        right: 18,
        bottom,
        height,
        borderRadius: 999,
        background: `radial-gradient(circle, ${glow} 0%, rgba(0,0,0,0) 72%)`,
        filter: "blur(12px)",
        pointerEvents: "none",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: overlay,
        pointerEvents: "none",
      }}
    />
    <div style={panelChromeInsetStyle} />
  </>
);

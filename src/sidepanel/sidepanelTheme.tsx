import React from "react";
import { orbitTokens, orbitColors, orbitRadius, orbitTypography } from "../shared/ui/orbitTokens";

export const sidePanelCardStyle: React.CSSProperties = {
  borderRadius: orbitRadius.lg,
  border: `1px solid ${orbitColors.border.subtle}`,
  background: orbitColors.bg.surface,
  boxShadow: orbitTokens.shadow.none,
};

export const historyCardStyle: React.CSSProperties = {
  borderRadius: orbitRadius.lg,
  border: `1px solid ${orbitColors.border.subtle}`,
  background: orbitColors.bg.surface,
  boxShadow: orbitTokens.shadow.none,
};

export const sidePanelShellStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: "100vh",
  width: "100%",
  boxSizing: "border-box",
  overflow: "hidden",
  background: orbitColors.bg.canvas,
  color: orbitColors.text.primary,
  fontFamily: orbitTypography.fontFamily,
};

export const sidePanelMutedTextStyle: React.CSSProperties = {
  fontSize: orbitTypography.fontSize.xs,
  lineHeight: orbitTypography.lineHeight.relaxed,
  color: orbitColors.text.secondary,
};

export const panelChromeInsetStyle: React.CSSProperties = {
  position: "absolute",
  inset: 6,
  borderRadius: orbitRadius.md,
  border: `1px solid ${orbitColors.border.subtle}`,
  pointerEvents: "none",
};

export const PanelChrome: React.FC<{
  glow?: string;
  bottom?: number;
  height?: number;
  overlay?: string;
}> = () => <div style={panelChromeInsetStyle} />;

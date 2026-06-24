import type React from "react";

export { findNextFractionExpression, normalizeRenderableMathText, renderMathText } from "./mathText";
export * from "./displayQuestionText";
export * from "./displayAnswerUtils";

export const historyStemStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#cdd6f4",
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

export const historyOptionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  fontSize: 12,
  lineHeight: 1.45,
};

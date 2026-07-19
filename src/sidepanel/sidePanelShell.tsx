import React from "react";
import { UiButton } from "@/shared/ui/extensionUi";
import type { UILang } from "./displayUtils";
import { sidePanelShellStyle } from "./sidepanelTheme";

export type SidePanelTabId = "candidates" | "history" | "settings";

export const APP_SHELL_STYLE = sidePanelShellStyle;

export const PANEL_BODY_STYLE: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "0 10px 10px",
};

const HEADER_STYLE: React.CSSProperties = {
  padding: "14px 14px 12px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
  background: "linear-gradient(180deg, rgba(16, 22, 42, 0.9), rgba(10, 14, 28, 0.85))",
  backdropFilter: "blur(20px)",
};

const tabButtonStyle: React.CSSProperties = {
  padding: "10px 8px 11px",
  border: "none",
  cursor: "pointer",
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 600,
  transition: "background-color 0.2s ease, color 0.2s ease, transform 0.18s ease",
  letterSpacing: -0.1,
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  willChange: "transform",
};

const lockedCardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255, 255, 255, 0.06)",
  background: "linear-gradient(180deg, rgba(16, 24, 48, 0.8), rgba(10, 15, 30, 0.85))",
  padding: 16,
};

const getHeaderCopy = (lang: UILang, isAuthenticated: boolean, tab: SidePanelTabId) => {
  const isEn = lang === "en";

  if (!isAuthenticated) {
    return {
      appName: isEn ? "Quiz Solver" : "题目解析助手",
      title: isEn ? "Login Account" : "登录账号",
      description: isEn ? "Register or log in with email in Settings before using the workspace." : "先在设置里完成邮箱注册或登录，再使用工作台。",
    };
  }

  if (tab === "candidates") {
    return {
      appName: isEn ? "Quiz Solver" : "题目解析助手",
      title: isEn ? "Workspace" : "工作台",
      description: isEn ? "Detect, solve, fill, and review without switching pages." : "在不切页的情况下完成识别、解析、填答和复核。",
    };
  }

  if (tab === "history") {
    return {
      appName: isEn ? "Quiz Solver" : "题目解析助手",
      title: isEn ? "History" : "历史记录",
      description: isEn ? "Review past answers and export parse records." : "查看过去的答题结果，也可以导出记录。",
    };
  }

  return {
    appName: isEn ? "Quiz Solver" : "题目解析助手",
    title: isEn ? "Settings" : "设置",
    description: isEn ? "Manage provider, route, and interface language." : "管理服务商、路由和界面语言。",
  };
};

export const SidePanelHeader: React.FC<{
  isAuthenticated: boolean;
  lang: UILang;
  onTabChange: (tab: SidePanelTabId) => void;
  tab: SidePanelTabId;
  userEmail: string;
}> = ({ isAuthenticated, lang, onTabChange, tab, userEmail }) => {
  const isEn = lang === "en";
  const copy = getHeaderCopy(lang, isAuthenticated, tab);
  const tabs: Array<{ id: SidePanelTabId; label: string }> = [
    { id: "candidates", label: isEn ? "Candidates" : "候选题" },
    { id: "history", label: isEn ? "History" : "历史" },
    { id: "settings", label: isEn ? "Settings" : "设置" },
  ];

  return (
    <header
      style={{
        ...HEADER_STYLE,
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(135deg, rgba(16, 22, 42, 0.95) 0%, rgba(10, 14, 28, 0.9) 58%, rgba(20, 12, 40, 0.85) 100%)",
      }}
    >
      <div className="sp-glow-a" style={{ position: "absolute", width: 180, height: 180, right: -40, top: -70, borderRadius: 999, background: "radial-gradient(circle, rgba(99,102,241,0.16) 0%, rgba(99,102,241,0) 70%)", pointerEvents: "none" }} />
      <div className="sp-glow-b" style={{ position: "absolute", width: 160, height: 160, left: -52, bottom: -80, borderRadius: 999, background: "radial-gradient(circle, rgba(139,92,246,0.12) 0%, rgba(139,92,246,0) 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.03), transparent 28%)", pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div className="sp-header-copy" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#818cf8", letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700 }}>{copy.appName}</div>
          <div style={{ fontSize: 21, fontWeight: 700, color: "#f8fafc", marginTop: 5, letterSpacing: -0.2, textShadow: "0 0 18px rgba(99,102,241,0.2)" }}>{copy.title}</div>
          <div style={{ fontSize: 12, lineHeight: 1.55, color: "#94a3b8", marginTop: 5, maxWidth: 300 }}>{copy.description}</div>
          {!isAuthenticated && userEmail ? <div style={{ fontSize: 11, marginTop: 6, color: "#818cf8" }}>{userEmail}</div> : null}
        </div>
      </div>

      {isAuthenticated ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: 12, padding: 4, borderRadius: 14, backgroundColor: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255, 255, 255, 0.06)", boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.04)" }}>
          {tabs.map((item) => (
            <button
              className="sp-tab"
              key={item.id}
              onClick={() => onTabChange(item.id)}
              style={{
                ...tabButtonStyle,
                background: tab === item.id ? "linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))" : "transparent",
                color: tab === item.id ? "#ffffff" : "#94a3b8",
                boxShadow: tab === item.id ? "inset 0 1px 0 rgba(255,255,255,0.08)" : "none",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
};

export const SidePanelLockedState: React.FC<{
  lang: UILang;
  onOpenSettings: () => void;
}> = ({ lang, onOpenSettings }) => {
  const isEn = lang === "en";

  return (
    <div style={{ padding: "18px 8px" }}>
      <div style={lockedCardStyle}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>{isEn ? "Workspace Locked" : "工作台未解锁"}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginTop: 8 }}>
          {isEn ? "Open Settings, register or log in with your email account, then return here to start detection and solving." : "请先打开设置页，完成邮箱注册或登录，之后再返回这里开始识题、解析和自动答题。"}
        </div>
        <div style={{ marginTop: 12 }}>
          <UiButton primary onClick={onOpenSettings}>
            {isEn ? "Open Settings" : "前往设置"}
          </UiButton>
        </div>
      </div>
    </div>
  );
};

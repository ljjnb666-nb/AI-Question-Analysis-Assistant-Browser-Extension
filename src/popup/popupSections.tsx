import React from "react";
import { AuthPasswordField, AuthVerificationCodeInput } from "@/shared/auth/AuthFields";
import type { PopupLang } from "./popupCopy";

export const popupCardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255, 255, 255, 0.06)",
  background: "linear-gradient(180deg, rgba(16, 24, 48, 0.8), rgba(10, 15, 30, 0.85))",
  boxShadow:
    "0 4px 20px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
  backdropFilter: "blur(20px)",
};

type PopupCopy = {
  appName: string;
  connected: (providerName: string) => string;
  demoMode: string;
  loading: string;
  provider: string;
  version: string;
  panel: string;
  ready: string;
  actions: string;
  actionsDesc: string;
  manualTitle: string;
  manualSubtitle: string;
  detectTitle: string;
  detectSubtitle: string;
  fullPageTitle: string;
  fullPageSubtitle: string;
  solveTitle: string;
  solveSubtitle: string;
  workspaceTitle: string;
  workspaceDesc: string;
  openPanel: string;
  shortcuts: string;
  capture: string;
  autoDetect: string;
  autoSolve: string;
  startManual: string;
  manualError: string;
  startDetect: string;
  detectError: string;
  startFullPage: string;
  fullPageError: string;
  startSolve: string;
  solveError: string;
  locked: string;
  registerAccount: string;
  loginAccount: string;
  registerHint: string;
  loginHint: string;
  registerPage: string;
  loginPage: string;
  registerDesc: string;
  loginDesc: string;
  backendHint: string;
  finishSetup: string;
  readyToWork: string;
  setupHint: string;
  pending: string;
  workspaceLocked: string;
  continuePrompt: string;
  tagline: string;
};

type AuthText = {
  registerTab: string;
  loginTab: string;
  emailPlaceholder: string;
  passwordPlaceholder: string;
  sendCode: string;
  sendingCode: string;
  completeRegistration: string;
  registering: string;
  login: string;
  loggingIn: string;
  showPassword: string;
  hidePassword: string;
};

export const PopupHeroCard: React.FC<{
  copy: PopupCopy;
  hasApiKey: boolean;
  isAuthenticated: boolean;
  isRuntimeConfigured: boolean;
  loaded: boolean;
  providerName: string;
  view: "register" | "login";
}> = ({ copy, hasApiKey, isAuthenticated, isRuntimeConfigured, loaded, providerName, view }) => (
  <div
    className="popup-hero"
    style={{
      ...popupCardStyle,
      padding: "13px 13px 11px",
      position: "relative",
      overflow: "hidden",
      background:
        "linear-gradient(135deg, rgba(16, 22, 42, 0.95) 0%, rgba(10, 14, 28, 0.9) 56%, rgba(20, 12, 40, 0.85) 100%)",
    }}
  >
    <div
      className="popup-glow-a"
      style={{
        position: "absolute",
        width: 136,
        height: 136,
        borderRadius: 999,
        background: "radial-gradient(circle, rgba(99,102,241,0.2) 0%, rgba(99,102,241,0) 70%)",
        top: -36,
        right: -18,
        pointerEvents: "none",
      }}
    />
    <div
      className="popup-glow-b"
      style={{
        position: "absolute",
        width: 142,
        height: 142,
        borderRadius: 999,
        background: "radial-gradient(circle, rgba(139,92,246,0.14) 0%, rgba(139,92,246,0) 70%)",
        bottom: -52,
        left: -26,
        pointerEvents: "none",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 30%)",
        pointerEvents: "none",
      }}
    />
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            color: "#818cf8",
            letterSpacing: 1.1,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          {copy.appName}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#f8fafc",
            lineHeight: 1.02,
            marginTop: 4,
            letterSpacing: -0.3,
            textShadow: "0 0 18px rgba(99,102,241,0.2)",
          }}
        >
          {!isAuthenticated
            ? view === "register"
              ? copy.registerAccount
              : copy.loginAccount
            : isRuntimeConfigured
              ? copy.readyToWork
              : copy.finishSetup}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5, lineHeight: 1.45, maxWidth: 220 }}>
          {!isAuthenticated
            ? view === "register"
              ? copy.registerHint
              : copy.loginHint
            : isRuntimeConfigured
              ? copy.tagline
              : copy.setupHint}
        </div>
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: "6px 10px",
          borderRadius: 999,
          backgroundColor: isRuntimeConfigured ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)",
          border: `1px solid ${isRuntimeConfigured ? "rgba(16, 185, 129, 0.2)" : "rgba(245, 158, 11, 0.18)"}`,
          color: isRuntimeConfigured ? "#34d399" : "#fbbf24",
          whiteSpace: "nowrap",
        }}
      >
        {!isAuthenticated
          ? copy.locked
          : loaded
            ? hasApiKey
              ? copy.connected(providerName)
              : copy.demoMode
            : copy.loading}
      </div>
    </div>

    {isAuthenticated ? (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: 10 }}>
        <MetricCard label={copy.provider} value={isRuntimeConfigured ? providerName : copy.pending} />
        <MetricCard label={copy.version} value="v0.2.0" />
        <MetricCard label={copy.panel} value={isRuntimeConfigured ? copy.ready : copy.pending} />
      </div>
    ) : null}
  </div>
);

export const PopupAuthCard: React.FC<{
  auth: {
    authBusy: "send-code" | "register" | "login" | "logout" | null;
    codeCooldown: number;
    codeSent: boolean;
    email: string;
    feedback: string;
    handleLogin: () => Promise<void>;
    handleRegister: () => Promise<void>;
    handleSendCode: () => Promise<void>;
    password: string;
    setEmail: (value: string) => void;
    setPassword: (value: string) => void;
    setVerificationCode: (value: string) => void;
    showPassword: boolean;
    switchView: (view: "register" | "login") => void;
    togglePasswordVisibility: () => void;
    verificationCode: string;
    view: "register" | "login";
  };
  authText: AuthText;
  copy: PopupCopy;
  gateInputStyle: React.CSSProperties;
  primaryGateButtonStyle: React.CSSProperties;
  secondaryGateButtonStyle: React.CSSProperties;
}> = ({ auth, authText, copy, gateInputStyle, primaryGateButtonStyle, secondaryGateButtonStyle }) => (
  <div className="popup-section" style={{ ...popupCardStyle, padding: 10 }}>
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 650, color: "#e9fbff", letterSpacing: 0.2 }}>
        {auth.view === "register" ? copy.registerPage : copy.loginPage}
      </div>
      <div style={{ fontSize: 10, color: "#7ea4c3", marginTop: 3, lineHeight: 1.4 }}>
        {auth.view === "register" ? copy.registerDesc : copy.loginDesc}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
      <button
        onClick={() => auth.switchView("register")}
        style={{
          ...(auth.view === "register" ? primaryGateButtonStyle : secondaryGateButtonStyle),
          width: "100%",
        }}
      >
        {authText.registerTab}
      </button>
      <button
        onClick={() => auth.switchView("login")}
        style={{
          ...(auth.view === "login" ? primaryGateButtonStyle : secondaryGateButtonStyle),
          width: "100%",
        }}
      >
        {authText.loginTab}
      </button>
    </div>
    <div style={{ display: "grid", gap: 8 }}>
      {auth.view === "register" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
            <input
              type="email"
              value={auth.email}
              onChange={(event) => auth.setEmail(event.target.value)}
              placeholder={authText.emailPlaceholder}
              style={gateInputStyle}
            />
            <button
              className="popup-action"
              onClick={() => void auth.handleSendCode()}
              disabled={!!auth.authBusy || auth.codeCooldown > 0}
              style={{ ...secondaryGateButtonStyle, opacity: auth.authBusy ? 0.7 : 1, width: 104, minWidth: 104 }}
            >
              {auth.authBusy === "send-code"
                ? authText.sendingCode
                : auth.codeCooldown > 0
                  ? `${auth.codeCooldown}s`
                  : authText.sendCode}
            </button>
          </div>
          <AuthPasswordField
            value={auth.password}
            onChange={auth.setPassword}
            visible={auth.showPassword}
            onToggleVisibility={auth.togglePasswordVisibility}
            placeholder={authText.passwordPlaceholder}
            showLabel={authText.showPassword}
            hideLabel={authText.hidePassword}
          />
          {auth.codeSent ? (
            <>
              <AuthVerificationCodeInput
                value={auth.verificationCode}
                onChange={auth.setVerificationCode}
              />
              <button
                className="popup-action"
                onClick={() => void auth.handleRegister()}
                disabled={!!auth.authBusy}
                style={{ ...primaryGateButtonStyle, opacity: auth.authBusy ? 0.7 : 1 }}
              >
                {auth.authBusy === "register" ? authText.registering : authText.completeRegistration}
              </button>
            </>
          ) : null}
        </>
      ) : (
        <>
          <input
            type="email"
            value={auth.email}
            onChange={(event) => auth.setEmail(event.target.value)}
            placeholder={authText.emailPlaceholder}
            style={gateInputStyle}
          />
          <AuthPasswordField
            value={auth.password}
            onChange={auth.setPassword}
            visible={auth.showPassword}
            onToggleVisibility={auth.togglePasswordVisibility}
            placeholder={authText.passwordPlaceholder}
            showLabel={authText.showPassword}
            hideLabel={authText.hidePassword}
          />
          <button
            className="popup-action"
            onClick={() => void auth.handleLogin()}
            disabled={!!auth.authBusy}
            style={{ ...primaryGateButtonStyle, opacity: auth.authBusy ? 0.7 : 1 }}
          >
            {auth.authBusy === "login" ? authText.loggingIn : authText.login}
          </button>
        </>
      )}
    </div>
    <div style={{ fontSize: 10, color: "#8ea8c6", marginTop: 8, lineHeight: 1.45 }}>
      {auth.feedback || copy.backendHint}
    </div>
  </div>
);

export const PopupActionsCard: React.FC<{
  activeFeature: "manual" | "auto" | "fullpage" | "solve" | null;
  copy: PopupCopy;
  onRunAction: (
    feature: "manual" | "auto" | "fullpage" | "solve",
    startText: string,
    errorText: string,
    messageType:
      | "START_MANUAL_CAPTURE"
      | "START_AUTO_DETECT"
      | "START_FULL_PAGE_DETECT"
      | "START_AUTO_SOLVE_ALL",
    openPanel?: boolean,
  ) => void;
}> = ({ activeFeature, copy, onRunAction }) => (
  <div className="popup-section" style={{ ...popupCardStyle, padding: 10 }}>
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 650, color: "#e9fbff", letterSpacing: 0.2 }}>
        {copy.actions}
      </div>
      <div style={{ fontSize: 10, color: "#7ea4c3", marginTop: 3, lineHeight: 1.4 }}>
        {copy.actionsDesc}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
      <FeatureButton
        className="popup-action"
        title={copy.manualTitle}
        subtitle={copy.manualSubtitle}
        active={activeFeature === "manual"}
        onClick={() => onRunAction("manual", copy.startManual, copy.manualError, "START_MANUAL_CAPTURE")}
      />
      <FeatureButton
        className="popup-action"
        title={copy.detectTitle}
        subtitle={copy.detectSubtitle}
        active={activeFeature === "auto"}
        onClick={() => onRunAction("auto", copy.startDetect, copy.detectError, "START_AUTO_DETECT", true)}
      />
      <FeatureButton
        className="popup-action"
        title={copy.fullPageTitle}
        subtitle={copy.fullPageSubtitle}
        active={activeFeature === "fullpage"}
        onClick={() =>
          onRunAction("fullpage", copy.startFullPage, copy.fullPageError, "START_FULL_PAGE_DETECT", true)
        }
      />
      <FeatureButton
        className="popup-action"
        title={copy.solveTitle}
        subtitle={copy.solveSubtitle}
        active={activeFeature === "solve"}
        onClick={() => onRunAction("solve", copy.startSolve, copy.solveError, "START_AUTO_SOLVE_ALL", true)}
      />
    </div>
  </div>
);

export const PopupWorkspaceCard: React.FC<{
  copy: PopupCopy;
  isAuthenticated: boolean;
  feedback: string;
  onOpenSidePanel: () => void;
  secondaryActionStyle: React.CSSProperties;
  userEmail: string;
}> = ({ copy, isAuthenticated, feedback, onOpenSidePanel, secondaryActionStyle, userEmail }) => (
  <div className="popup-section" style={{ ...popupCardStyle, padding: "10px 11px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "start", gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 650, color: "#e9fbff", letterSpacing: 0.2 }}>
          {copy.workspaceTitle}
        </div>
        <div style={{ fontSize: 10, color: "#90a8c4", marginTop: 3, lineHeight: 1.45 }}>
          {isAuthenticated ? `${copy.workspaceDesc}${userEmail ? ` (${userEmail})` : ""}` : copy.workspaceLocked}
        </div>
      </div>
      {isAuthenticated ? (
        <button className="popup-open-panel" onClick={onOpenSidePanel} style={secondaryActionStyle}>
          {copy.openPanel}
        </button>
      ) : null}
    </div>
    <div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
      {isAuthenticated ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 10, color: "#90a8c4" }}>
          <span style={{ color: "#a8bdd3" }}>{copy.shortcuts}</span>
          <KeyPill>Alt+Q</KeyPill>
          <span>{copy.capture}</span>
          <KeyPill>Alt+W</KeyPill>
          <span>{copy.autoDetect}</span>
          <span style={{ opacity: 0.5 }}>/</span>
          <span>{copy.autoSolve}</span>
        </div>
      ) : (
        <div style={{ fontSize: 10, color: "#90a8c4", lineHeight: 1.45 }}>
          {feedback || copy.continuePrompt}
        </div>
      )}
    </div>
  </div>
);

export const PopupStatusCard: React.FC<{ status: string }> = ({ status }) =>
  status ? (
    <div
      className="popup-section"
      style={{
        ...popupCardStyle,
        padding: "10px 12px",
        color: "#fca5a5",
        borderColor: "rgba(239, 68, 68, 0.2)",
        background: "linear-gradient(180deg, rgba(69, 26, 26, 0.8), rgba(45, 15, 15, 0.75))",
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      {status}
    </div>
  ) : null;

const MetricCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    className="popup-metric"
    style={{
      borderRadius: 12,
      padding: "8px 9px 8px",
      height: 68,
      backgroundColor: "rgba(15, 23, 42, 0.6)",
      border: "1px solid rgba(255, 255, 255, 0.06)",
      backdropFilter: "blur(10px)",
      transition: "transform 0.18s ease",
      willChange: "transform",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      boxSizing: "border-box",
    }}
  >
    <div
      style={{
        fontSize: 9,
        color: "#94a3b8",
        height: 12,
        marginBottom: 5,
        fontWeight: 600,
        lineHeight: 1.1,
        display: "flex",
        alignItems: "center",
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: 12,
        fontWeight: 650,
        color: "#f8fafc",
        lineHeight: 1.15,
        height: 28,
        display: "flex",
        alignItems: "flex-end",
        letterSpacing: -0.2,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "block",
          width: "100%",
        }}
      >
        {value}
      </span>
    </div>
  </div>
);

const FeatureButton: React.FC<{
  className?: string;
  title: string;
  subtitle: string;
  active?: boolean;
  onClick: () => void;
}> = ({ className, title, subtitle, active, onClick }) => (
  <button
    className={className}
    onClick={onClick}
    style={{
      width: "100%",
      minHeight: 76,
      padding: "11px 11px 10px",
      borderRadius: 12,
      border: `1px solid ${active ? "rgba(99, 102, 241, 0.4)" : "rgba(255, 255, 255, 0.06)"}`,
      background: active
        ? "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(139, 92, 246, 0.18))"
        : "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
      color: active ? "#ffffff" : "#f1f5f9",
      cursor: "pointer",
      textAlign: "left",
      fontFamily: "inherit",
      transition: "transform 0.18s ease, border-color 0.18s ease, background 0.18s ease",
      willChange: "transform",
    }}
  >
    <div style={{ fontSize: 13, fontWeight: 650, letterSpacing: -0.1, lineHeight: 1.15 }}>{title}</div>
    <div style={{ fontSize: 10, marginTop: 4, color: active ? "#a5b4fc" : "#94a3b8", lineHeight: 1.35 }}>
      {subtitle}
    </div>
  </button>
);

const KeyPill: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code
    style={{
      padding: "4px 8px",
      borderRadius: 8,
      backgroundColor: "rgba(15, 23, 42, 0.6)",
      border: "1px solid rgba(255, 255, 255, 0.06)",
      color: "#a5b4fc",
      fontSize: 10,
      fontWeight: 600,
    }}
  >
    {children}
  </code>
);

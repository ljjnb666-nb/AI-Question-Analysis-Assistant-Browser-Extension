import React, { useState } from "react";
import {
  OrbitButton,
  OrbitSurface,
  OrbitBadge,
  OrbitStatus,
  OrbitInput,
  type OrbitBadgeVariant,
} from "@/shared/ui/orbitPrimitives";
import { orbitColors, orbitSpacing, orbitRadius, orbitTypography } from "@/shared/ui/orbitTokens";
import { AuthPasswordField, AuthVerificationCodeInput } from "@/shared/auth/AuthFields";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import type { PopupCopy, PopupLang } from "./popupCopy";
import type { PopupViewState } from "./popupViewState";
import { derivePopupActionReadiness } from "./popupActionReadiness";
import { getRecoveryPlan, type PopupRecoveryPlan } from "./popupRecovery";

export interface PopupHeaderProps {
  appName: string;
  viewState: PopupViewState;
  lang: PopupLang;
  copy: PopupCopy;
  onOpenSettings: () => void;
  onToggleLang: () => void;
  onLogout?: () => void;
  isAuthenticated: boolean;
}

export const PopupHeader: React.FC<PopupHeaderProps> = ({
  appName,
  viewState,
  lang,
  copy,
  onOpenSettings,
  onToggleLang,
  onLogout,
  isAuthenticated,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  // Map viewState to badge variant and label
  let badgeVariant: OrbitBadgeVariant;
  let badgeLabel: string;

  switch (viewState) {
    case "checking_session":
    case "checking_page":
      badgeVariant = "info";
      badgeLabel = copy.checking;
      break;
    case "signed_out":
      badgeVariant = "neutral";
      badgeLabel = copy.signedOut;
      break;
    case "service_unavailable":
      badgeVariant = "error";
      badgeLabel = copy.serviceUnavailable;
      break;
    case "page_unavailable":
      badgeVariant = "warning";
      badgeLabel = copy.pageUnavailable;
      break;
    case "running":
      badgeVariant = "ai";
      badgeLabel = copy.running;
      break;
    case "review_required":
      badgeVariant = "warning";
      badgeLabel = copy.reviewRequired;
      break;
    case "recoverable_error":
      badgeVariant = "error";
      badgeLabel = copy.recoverableError;
      break;
    case "provider_setup_required":
      badgeVariant = "warning";
      badgeLabel = copy.providerSetupRequired;
      break;
    case "ready":
    default:
      badgeVariant = "success";
      badgeLabel = copy.ready;
      break;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: orbitSpacing[2],
        borderBottom: `1px solid ${orbitColors.border.subtle}`,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: orbitSpacing[2] }}>
        <span
          style={{
            fontSize: orbitTypography.fontSize.sm,
            fontWeight: orbitTypography.fontWeight.semibold,
            color: orbitColors.text.primary,
            letterSpacing: -0.2,
          }}
        >
          {appName}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: orbitSpacing[2] }}>
        <OrbitBadge variant={badgeVariant} dot>
          {badgeLabel}
        </OrbitBadge>

        <button
          type="button"
          aria-label={lang === "zh" ? "产品菜单" : "Product Menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            background: "transparent",
            border: `1px solid ${menuOpen ? orbitColors.border.strong : "transparent"}`,
            borderRadius: orbitRadius.sm,
            color: orbitColors.text.secondary,
            padding: `2px ${orbitSpacing[2]}px`,
            cursor: "pointer",
            fontSize: orbitTypography.fontSize.sm,
            lineHeight: 1,
          }}
        >
          ⋯
        </button>
      </div>

      {menuOpen ? (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: orbitSpacing[1],
            background: orbitColors.bg.surfaceRaised,
            border: `1px solid ${orbitColors.border.default}`,
            borderRadius: orbitRadius.md,
            padding: orbitSpacing[1],
            display: "flex",
            flexDirection: "column",
            gap: 2,
            zIndex: 100,
            minWidth: 140,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onOpenSettings();
            }}
            style={menuItemStyle}
          >
            {copy.menuSettings}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onToggleLang();
            }}
            style={menuItemStyle}
          >
            {copy.menuSwitchLang}
          </button>
          {isAuthenticated && onLogout ? (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
              style={{ ...menuItemStyle, color: orbitColors.semantic.error }}
            >
              {copy.menuLogout}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const menuItemStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  textAlign: "left",
  padding: `${orbitSpacing[2]}px ${orbitSpacing[3]}px`,
  color: orbitColors.text.primary,
  fontSize: orbitTypography.fontSize.xs,
  borderRadius: orbitRadius.sm,
  cursor: "pointer",
  fontFamily: orbitTypography.fontFamily,
};

export interface PopupContextLineProps {
  isPageInjectable: boolean | null;
  hasApiKey: boolean;
  providerName: string;
  copy: PopupCopy;
}

export const PopupContextLine: React.FC<PopupContextLineProps> = ({
  isPageInjectable,
  hasApiKey,
  providerName,
  copy,
}) => {
  const pageText =
    isPageInjectable === null
      ? copy.pageChecking
      : isPageInjectable
        ? copy.pageInjectable
        : copy.pageNotInjectable;
  const providerText = hasApiKey ? copy.connected(providerName) : copy.demoMode;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: orbitTypography.fontSize.xs,
        color: orbitColors.text.secondary,
        padding: `${orbitSpacing[1]}px 0`,
      }}
    >
      <span>{pageText}</span>
      <span>·</span>
      <span>{providerText}</span>
    </div>
  );
};

export interface PopupPrimaryCommandProps {
  copy: PopupCopy;
  lang: PopupLang;
  isRunning: boolean;
  activeFeature: string | null;
  onSolve: () => void;
  isAuthenticated: boolean;
  isPageInjectable: boolean | null;
  hasApiKey: boolean;
}

export const PopupPrimaryCommand: React.FC<PopupPrimaryCommandProps> = ({
  copy,
  lang,
  isRunning,
  activeFeature,
  onSolve,
  isAuthenticated,
  isPageInjectable,
  hasApiKey,
}) => {
  const readiness = derivePopupActionReadiness("solve_fill", {
    isAuthenticated,
    isPageInjectable,
    hasApiKey,
    isRunning,
    lang,
  });

  const isSolving = isRunning && activeFeature === "solve";
  const disabled = !readiness.enabled;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: orbitSpacing[2],
        padding: `${orbitSpacing[2]}px 0`,
      }}
    >
      <OrbitButton
        variant="primary"
        size="lg"
        isLoading={isSolving}
        disabled={disabled}
        onClick={onSolve}
        aria-label={copy.solveTitle}
        style={{
          width: "100%",
          height: 48,
          fontSize: orbitTypography.fontSize.base,
          fontWeight: orbitTypography.fontWeight.semibold,
        }}
      >
        {copy.solveTitle}
      </OrbitButton>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: orbitTypography.fontSize.xs,
          lineHeight: 1.4,
          padding: `0 ${orbitSpacing[1]}px`,
        }}
      >
        <span style={{ color: orbitColors.text.secondary }}>
          {copy.trustCopy}
        </span>
        {disabled && readiness.reason ? (
          <span style={{ color: orbitColors.semantic.warning, fontSize: orbitTypography.fontSize.xs }}>
            {readiness.reason}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export interface PopupSecondaryCommandsProps {
  copy: PopupCopy;
  lang: PopupLang;
  isRunning: boolean;
  activeFeature: string | null;
  onDetect: () => void;
  onManualCapture: () => void;
  onFullPageScan: () => void;
  isAuthenticated: boolean;
  isPageInjectable: boolean | null;
  hasApiKey: boolean;
}

export const PopupSecondaryCommands: React.FC<PopupSecondaryCommandsProps> = ({
  copy,
  lang,
  isRunning,
  activeFeature,
  onDetect,
  onManualCapture,
  onFullPageScan,
  isAuthenticated,
  isPageInjectable,
  hasApiKey,
}) => {
  const detectReadiness = derivePopupActionReadiness("detect_current", {
    isAuthenticated,
    isPageInjectable,
    hasApiKey,
    isRunning,
    lang,
  });

  const manualReadiness = derivePopupActionReadiness("manual_capture", {
    isAuthenticated,
    isPageInjectable,
    hasApiKey,
    isRunning,
    lang,
  });

  const fullPageReadiness = derivePopupActionReadiness("scan_full_page", {
    isAuthenticated,
    isPageInjectable,
    hasApiKey,
    isRunning,
    lang,
  });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: orbitSpacing[2],
        padding: `${orbitSpacing[1]}px 0`,
      }}
    >
      <button
        type="button"
        disabled={!detectReadiness.enabled}
        onClick={onDetect}
        title={detectReadiness.reason || copy.detectTitle}
        aria-label={`${copy.detectTitle} ${copy.detectSubtitle}`}
        style={secondaryCommandButtonStyle(!detectReadiness.enabled, activeFeature === "auto")}
      >
        <span style={secondaryCommandTitleStyle}>{copy.detectTitle}</span>
        <span style={secondaryCommandSubtitleStyle}>{copy.detectSubtitle}</span>
      </button>

      <button
        type="button"
        disabled={!manualReadiness.enabled}
        onClick={onManualCapture}
        title={manualReadiness.reason || copy.manualTitle}
        aria-label={`${copy.manualTitle} ${copy.manualSubtitle}`}
        style={secondaryCommandButtonStyle(!manualReadiness.enabled, activeFeature === "manual")}
      >
        <span style={secondaryCommandTitleStyle}>{copy.manualTitle}</span>
        <span style={secondaryCommandSubtitleStyle}>{copy.manualSubtitle}</span>
      </button>

      <button
        type="button"
        disabled={!fullPageReadiness.enabled}
        onClick={onFullPageScan}
        title={fullPageReadiness.reason || copy.fullPageTitle}
        aria-label={`${copy.fullPageTitle} ${copy.fullPageSubtitle}`}
        style={secondaryCommandButtonStyle(!fullPageReadiness.enabled, activeFeature === "fullpage")}
      >
        <span style={secondaryCommandTitleStyle}>{copy.fullPageTitle}</span>
        <span style={secondaryCommandSubtitleStyle}>{copy.fullPageSubtitle}</span>
      </button>
    </div>
  );
};

function secondaryCommandButtonStyle(disabled: boolean, active: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: `${orbitSpacing[2]}px ${orbitSpacing[1]}px`,
    borderRadius: orbitRadius.md,
    background: active ? orbitColors.brand.subtle : orbitColors.bg.surfaceRaised,
    border: `1px solid ${active ? orbitColors.brand.border : orbitColors.border.default}`,
    color: disabled ? orbitColors.control.disabledText : orbitColors.text.primary,
    cursor: disabled ? "not-allowed" : "pointer",
    textAlign: "center",
    fontFamily: orbitTypography.fontFamily,
    boxSizing: "border-box",
    minHeight: 52,
  };
}

const secondaryCommandTitleStyle: React.CSSProperties = {
  fontSize: orbitTypography.fontSize.xs,
  fontWeight: orbitTypography.fontWeight.medium,
  lineHeight: 1.2,
};

const secondaryCommandSubtitleStyle: React.CSSProperties = {
  fontSize: 10,
  color: orbitColors.text.secondary,
  lineHeight: 1.1,
};

export interface PopupRecoverySectionProps {
  viewState: PopupViewState;
  recoveryReason?: string | null;
  lang: PopupLang;
  onOpenSettings: () => void;
  onOpenWorkspace: () => void;
  onRefreshPage: () => void;
  onReDetect: () => void;
  onRetryValidation: () => void;
  onLogout: () => void;
}

export const PopupRecoverySection: React.FC<PopupRecoverySectionProps> = ({
  viewState,
  recoveryReason,
  lang,
  onOpenSettings,
  onOpenWorkspace,
  onRefreshPage,
  onReDetect,
  onRetryValidation,
  onLogout,
}) => {
  const plan: PopupRecoveryPlan | null = getRecoveryPlan(recoveryReason || viewState, lang);
  if (!plan) return null;

  const handleAction = (kind: string) => {
    switch (kind) {
      case "open_settings":
        onOpenSettings();
        break;
      case "open_workspace":
        onOpenWorkspace();
        break;
      case "refresh_page":
        onRefreshPage();
        break;
      case "re_detect":
        onReDetect();
        break;
      case "retry":
        onRetryValidation();
        break;
      case "logout":
        onLogout();
        break;
    }
  };

  return (
    <OrbitSurface
      variant="default"
      style={{
        padding: orbitSpacing[3],
        marginTop: orbitSpacing[2],
        marginBottom: orbitSpacing[2],
        border: `1px solid ${orbitColors.border.default}`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: orbitSpacing[2] }}>
        <div>
          <div
            style={{
              fontSize: orbitTypography.fontSize.xs,
              fontWeight: orbitTypography.fontWeight.semibold,
              color:
                viewState === "recoverable_error"
                  ? orbitColors.semantic.error
                  : orbitColors.semantic.warning,
            }}
          >
            {plan.title}
          </div>
          <div
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.text.secondary,
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            {plan.explanation}
          </div>
        </div>

        <div style={{ display: "flex", gap: orbitSpacing[2] }}>
          <OrbitButton
            variant="secondary"
            size="sm"
            onClick={() => handleAction(plan.primaryActionKind)}
          >
            {plan.primaryActionLabel}
          </OrbitButton>
          {plan.secondaryActionKind && plan.secondaryActionLabel ? (
            <OrbitButton
              variant="ghost"
              size="sm"
              onClick={() => handleAction(plan.secondaryActionKind!)}
            >
              {plan.secondaryActionLabel}
            </OrbitButton>
          ) : null}
        </div>
      </div>
    </OrbitSurface>
  );
};

export interface PopupFooterProps {
  copy: PopupCopy;
  onOpenWorkspace: () => void;
  isAuthenticated: boolean;
}

export const PopupFooter: React.FC<PopupFooterProps> = ({
  copy,
  onOpenWorkspace,
  isAuthenticated,
}) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: orbitSpacing[2],
        borderTop: `1px solid ${orbitColors.border.subtle}`,
        marginTop: orbitSpacing[2],
      }}
    >
      <OrbitButton
        variant="secondary"
        size="sm"
        disabled={!isAuthenticated}
        onClick={onOpenWorkspace}
        style={{
          flex: 1,
          justifyContent: "center",
          height: 32,
        }}
      >
        {copy.openPanel}
      </OrbitButton>

      <span
        style={{
          marginLeft: orbitSpacing[2],
          fontSize: orbitTypography.fontSize.xs,
          color: orbitColors.text.secondary,
          fontFamily: orbitTypography.codeFamily,
        }}
      >
        {copy.shortcutKey}
      </span>
    </div>
  );
};

export interface PopupAuthSectionProps {
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
    sessionRejected: boolean;
    setEmail: (value: string) => void;
    setPassword: (value: string) => void;
    setVerificationCode: (value: string) => void;
    showPassword: boolean;
    switchView: (view: "register" | "login") => void;
    togglePasswordVisibility: () => void;
    verificationCode: string;
    view: "register" | "login";
  };
  copy: PopupCopy;
}

export const PopupAuthSection: React.FC<PopupAuthSectionProps> = ({ auth, copy }) => {
  const isRegister = auth.view === "register";

  const canRegister =
    auth.email.trim() !== "" &&
    auth.password.trim() !== "" &&
    auth.codeSent &&
    auth.verificationCode.trim() !== "";

  const isSendCodeDisabled =
    !!auth.authBusy || auth.codeCooldown > 0 || auth.email.trim() === "";

  return (
    <OrbitSurface
      variant="default"
      style={{
        padding: orbitSpacing[3],
        marginTop: orbitSpacing[2],
        marginBottom: orbitSpacing[2],
        display: "flex",
        flexDirection: "column",
        gap: orbitSpacing[3],
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span
          style={{
            fontSize: orbitTypography.fontSize.sm,
            fontWeight: orbitTypography.fontWeight.semibold,
            color: orbitColors.text.primary,
          }}
        >
          {isRegister ? copy.authTitleRegister : copy.authTitleLogin}
        </span>
        <span style={{ fontSize: orbitTypography.fontSize.xs, color: orbitColors.text.secondary }}>
          {isRegister ? copy.registerHint : copy.loginHint}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: orbitSpacing[1],
          background: orbitColors.bg.surfaceRaised,
          padding: 2,
          borderRadius: orbitRadius.md,
          border: `1px solid ${orbitColors.border.subtle}`,
        }}
      >
        <button
          type="button"
          aria-pressed={isRegister}
          onClick={() => auth.switchView("register")}
          style={{
            background: isRegister ? orbitColors.bg.surfaceInteractive : "transparent",
            color: isRegister ? orbitColors.text.primary : orbitColors.text.secondary,
            border: isRegister ? `1px solid ${orbitColors.border.default}` : "1px solid transparent",
            borderRadius: orbitRadius.sm,
            padding: `${orbitSpacing[1]}px 0`,
            fontSize: orbitTypography.fontSize.xs,
            fontWeight: orbitTypography.fontWeight.medium,
            cursor: "pointer",
            fontFamily: orbitTypography.fontFamily,
          }}
        >
          {copy.register}
        </button>
        <button
          type="button"
          aria-pressed={!isRegister}
          onClick={() => auth.switchView("login")}
          style={{
            background: !isRegister ? orbitColors.bg.surfaceInteractive : "transparent",
            color: !isRegister ? orbitColors.text.primary : orbitColors.text.secondary,
            border: !isRegister ? `1px solid ${orbitColors.border.default}` : "1px solid transparent",
            borderRadius: orbitRadius.sm,
            padding: `${orbitSpacing[1]}px 0`,
            fontSize: orbitTypography.fontSize.xs,
            fontWeight: orbitTypography.fontWeight.medium,
            cursor: "pointer",
            fontFamily: orbitTypography.fontFamily,
          }}
        >
          {copy.login}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: orbitSpacing[2] }}>
        {isRegister ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: orbitSpacing[2], alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <OrbitInput
                label={copy.emailLabel}
                type="email"
                value={auth.email}
                onChange={(e) => auth.setEmail(e.target.value)}
                placeholder={copy.emailPlaceholder}
                autoComplete="email"
              />
            </div>
            <OrbitButton
              variant="secondary"
              size="md"
              disabled={isSendCodeDisabled}
              onClick={() => void auth.handleSendCode()}
              style={{ minWidth: 90 }}
            >
              {auth.authBusy === "send-code"
                ? copy.sendingCode
                : auth.codeCooldown > 0
                  ? `${auth.codeCooldown}s`
                  : copy.sendCode}
            </OrbitButton>
          </div>
        ) : (
          <OrbitInput
            label={copy.emailLabel}
            type="email"
            value={auth.email}
            onChange={(e) => auth.setEmail(e.target.value)}
            placeholder={copy.emailPlaceholder}
            autoComplete="email"
          />
        )}

        <AuthPasswordField
          id="popup-auth-password"
          label={copy.passwordLabel}
          value={auth.password}
          onChange={auth.setPassword}
          visible={auth.showPassword}
          onToggleVisibility={auth.togglePasswordVisibility}
          placeholder={copy.passwordPlaceholder}
          showLabel={copy.showPassword}
          hideLabel={copy.hidePassword}
        />

        {isRegister && auth.codeSent ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label
              style={{
                fontSize: orbitTypography.fontSize.xs,
                fontWeight: orbitTypography.fontWeight.medium,
                color: orbitColors.text.secondary,
              }}
            >
              {copy.verificationCodeLabel}
            </label>
            <AuthVerificationCodeInput
              value={auth.verificationCode}
              onChange={auth.setVerificationCode}
              ariaLabel={copy.verificationCodeLabel}
              lang={copy.appName === "Quiz Solver" ? "en" : "zh"}
            />
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: orbitSpacing[2] }}>
        <OrbitButton
          variant="primary"
          size="md"
          isLoading={auth.authBusy === "login" || auth.authBusy === "register"}
          disabled={isRegister ? (!canRegister || !!auth.authBusy) : !!auth.authBusy}
          onClick={() => void (isRegister ? auth.handleRegister() : auth.handleLogin())}
          style={{ width: "100%" }}
        >
          {isRegister
            ? auth.authBusy === "register"
              ? copy.registering
              : copy.completeRegistration
            : auth.authBusy === "login"
              ? copy.loggingIn
              : copy.loginSubmit}
        </OrbitButton>

        <button
          type="button"
          onClick={() => auth.switchView(isRegister ? "login" : "register")}
          style={{
            background: "transparent",
            border: "none",
            color: orbitColors.brand.primary,
            fontSize: orbitTypography.fontSize.xs,
            cursor: "pointer",
            textAlign: "center",
            padding: orbitSpacing[1],
            fontFamily: orbitTypography.fontFamily,
          }}
        >
          {isRegister ? copy.goToLogin : copy.goToRegister}
        </button>
      </div>

      {auth.feedback || auth.sessionRejected ? (
        <div style={{ fontSize: orbitTypography.fontSize.xs, color: orbitColors.semantic.warning }}>
          {auth.feedback || copy.sessionExpired}
        </div>
      ) : null}
    </OrbitSurface>
  );
};

export interface PopupSessionGateProps {
  copy: PopupCopy;
  isSessionPending: boolean;
  isServerUnavailable: boolean;
  onRetry: () => void;
  onLogout: () => void;
}

export const PopupSessionGateSection: React.FC<PopupSessionGateProps> = ({
  copy,
  isSessionPending,
  isServerUnavailable,
  onRetry,
  onLogout,
}) => {
  return (
    <OrbitSurface
      variant="default"
      style={{
        padding: orbitSpacing[4],
        marginTop: orbitSpacing[2],
        marginBottom: orbitSpacing[2],
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: orbitSpacing[3],
      }}
    >
      {isSessionPending ? (
        <OrbitStatus tone="info" label={copy.validatingSession} />
      ) : isServerUnavailable ? (
        <div style={{ display: "flex", flexDirection: "column", gap: orbitSpacing[2], width: "100%" }}>
          <OrbitStatus tone="error" label={copy.sessionUnavailable} secondaryText={copy.sessionUnavailableHint} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: orbitSpacing[2], marginTop: orbitSpacing[1] }}>
            <OrbitButton variant="primary" size="sm" onClick={onRetry}>
              {copy.retrySession}
            </OrbitButton>
            <OrbitButton variant="secondary" size="sm" onClick={onLogout}>
              {copy.logout}
            </OrbitButton>
          </div>
        </div>
      ) : null}
    </OrbitSurface>
  );
};

export interface PopupFeedbackBannerProps {
  feedback: UserFeedback | null;
}

export const PopupFeedbackBanner: React.FC<PopupFeedbackBannerProps> = ({ feedback }) => {
  if (!feedback) return null;

  return (
    <div
      role={feedback.tone === "error" ? "alert" : "status"}
      style={{
        padding: `${orbitSpacing[2]}px ${orbitSpacing[3]}px`,
        borderRadius: orbitRadius.md,
        fontSize: orbitTypography.fontSize.xs,
        lineHeight: 1.4,
        marginTop: orbitSpacing[2],
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: orbitSpacing[2],
        background:
          feedback.tone === "error"
            ? orbitColors.semantic.errorSurface
            : feedback.tone === "warning"
              ? orbitColors.semantic.warningSurface
              : feedback.tone === "success"
                ? orbitColors.semantic.successSurface
                : orbitColors.semantic.infoSurface,
        border: `1px solid ${
          feedback.tone === "error"
            ? orbitColors.semantic.errorBorder
            : feedback.tone === "warning"
              ? orbitColors.semantic.warningBorder
              : feedback.tone === "success"
                ? orbitColors.semantic.successBorder
                : orbitColors.semantic.infoBorder
        }`,
        color:
          feedback.tone === "error"
            ? orbitColors.semantic.error
            : feedback.tone === "warning"
              ? orbitColors.semantic.warning
              : feedback.tone === "success"
                ? orbitColors.semantic.success
                : orbitColors.semantic.info,
      }}
    >
      <span>{feedback.message}</span>
    </div>
  );
};

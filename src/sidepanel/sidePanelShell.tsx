import React, { useEffect, useRef, useState } from "react";
import {
  OrbitBadge,
  type OrbitBadgeVariant,
  OrbitButton,
  OrbitSurface,
} from "@/shared/ui/orbitPrimitives";
import {
  orbitColors,
  orbitRadius,
  orbitSpacing,
  orbitTokens,
  orbitTypography,
} from "@/shared/ui/orbitTokens";
import { useFocusVisible } from "@/shared/ui/orbitFocus";
import { usePrefersReducedMotion } from "@/shared/ui/orbitMotion";
import type { UILang } from "./displayUtils";
import { sidePanelShellStyle } from "./sidepanelTheme";
import { SIDEPANEL_COPY } from "./sidePanelCopy";
import type {
  SidePanelWorkspaceStatus,
  WorkspaceActivity,
} from "./sidePanelWorkspaceState";

export type SidePanelTabId = "candidates" | "history" | "settings";

export type SidePanelAuthStatus =
  | "loading"
  | "validating"
  | "authenticated"
  | "unauthenticated"
  | "server_unavailable";

export const APP_SHELL_STYLE = sidePanelShellStyle;

export const PANEL_BODY_STYLE: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  width: "100%",
  boxSizing: "border-box",
  background: orbitColors.bg.canvas,
};

function getStatusBadgeProps(status: SidePanelWorkspaceStatus, lang: UILang): {
  label: string;
  variant: OrbitBadgeVariant;
} {
  const copy = SIDEPANEL_COPY[lang].status;
  switch (status) {
    case "syncing_runtime":
      return { label: SIDEPANEL_COPY[lang].runtime.syncing, variant: "info" };
    case "runtime_unavailable":
      return { label: SIDEPANEL_COPY[lang].runtime.unavailable, variant: "warning" };
    case "checking_session":
      return { label: copy.checking_session, variant: "info" };
    case "service_unavailable":
      return { label: copy.service_unavailable, variant: "error" };
    case "signed_out":
      return { label: copy.signed_out, variant: "neutral" };
    case "review_required":
      return { label: copy.review_required, variant: "warning" };
    case "solving":
      return { label: copy.solving, variant: "ai" };
    case "scanning":
      return { label: copy.scanning, variant: "info" };
    case "detecting":
      return { label: copy.detecting, variant: "info" };
    case "ready":
    default:
      return { label: copy.ready, variant: "success" };
  }
}

export const SidePanelHeader: React.FC<{
  authStatus: SidePanelAuthStatus;
  isAuthenticated: boolean;
  lang: UILang;
  onTabChange: (tab: SidePanelTabId) => void;
  tab: SidePanelTabId;
  userEmail: string;
  workspaceStatus?: SidePanelWorkspaceStatus;
  providerName?: string;
  onToggleLanguage?: () => void;
  onLogout?: () => void;
  onRetryValidation?: () => void;
}> = ({
  authStatus: _authStatus,
  isAuthenticated,
  lang,
  onTabChange,
  tab,
  userEmail,
  workspaceStatus = "ready",
  providerName,
  onToggleLanguage,
  onLogout,
}) => {
  const copy = SIDEPANEL_COPY[lang];
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const { isFocusVisible: isMenuFocusVisible, onFocus: onMenuFocus, onBlur: onMenuBlur } =
    useFocusVisible();

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(e.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const tabs: Array<{ id: SidePanelTabId; label: string }> = [
    { id: "candidates", label: copy.tabs.candidates },
    { id: "history", label: copy.tabs.history },
    { id: "settings", label: copy.tabs.settings },
  ];

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let targetIndex = -1;
    if (e.key === "ArrowRight") {
      targetIndex = (index + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      targetIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      targetIndex = 0;
    } else if (e.key === "End") {
      targetIndex = tabs.length - 1;
    }
    if (targetIndex >= 0) {
      e.preventDefault();
      const nextTab = tabs[targetIndex];
      onTabChange(nextTab.id);
      const tabButtons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      tabButtons?.[targetIndex]?.focus();
    }
  };

  const statusBadge = getStatusBadgeProps(workspaceStatus, lang);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: orbitColors.bg.surface,
        borderBottom: `1px solid ${orbitColors.border.subtle}`,
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      {/* Compact App Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `${orbitSpacing[3]}px ${orbitSpacing[3]}px`,
          gap: orbitSpacing[2],
          boxSizing: "border-box",
          minHeight: 56,
        }}
      >
        {/* Left: Product title & Context Line */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
            <span
              style={{
                fontSize: orbitTypography.fontSize.base,
                fontWeight: orbitTypography.fontWeight.semibold,
                color: orbitColors.text.primary,
                lineHeight: 1.25,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {copy.appName}
            </span>
            {isAuthenticated ? (
              <>
                <span style={{ fontSize: 11, color: orbitColors.text.muted }}>·</span>
                <span
                  style={{
                    fontSize: 11,
                    color: orbitColors.text.secondary,
                    fontWeight: orbitTypography.fontWeight.medium,
                    whiteSpace: "nowrap",
                  }}
                >
                  {lang === "en" ? "Workspace" : "工作台"}
                </span>
              </>
            ) : null}
          </div>
          <span
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.text.secondary,
              marginTop: 2,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {isAuthenticated
              ? copy.contextLine(providerName)
              : _authStatus === "loading" || _authStatus === "validating"
                ? (lang === "en" ? "Verifying Session..." : "正在验证登录状态")
                : _authStatus === "server_unavailable"
                  ? (lang === "en" ? "Cannot Verify Session" : "无法验证登录状态")
                  : (lang === "en" ? "Login Account" : "登录账号")}
          </span>
        </div>

        {/* Right: Global Status Badge & Product Menu */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: orbitSpacing[2],
            flexShrink: 0,
            position: "relative",
          }}
        >
          <OrbitBadge variant={statusBadge.variant} dot={true}>
            {statusBadge.label}
          </OrbitBadge>

          <button
            ref={menuButtonRef}
            type="button"
            aria-label={copy.menu.buttonAria}
            aria-controls="sidepanel-product-popover"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((prev) => !prev)}
            onFocus={onMenuFocus}
            onBlur={onMenuBlur}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: orbitRadius.md,
              border: `1px solid ${isMenuOpen ? orbitColors.border.strong : orbitColors.border.subtle}`,
              background: isMenuOpen ? orbitColors.bg.surfaceInteractive : orbitColors.bg.surfaceRaised,
              color: orbitColors.text.primary,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: "bold",
              lineHeight: 1,
              outline: isMenuFocusVisible ? orbitTokens.focus.outline : "none",
              outlineOffset: orbitTokens.focus.outlineOffset,
              boxShadow: isMenuFocusVisible ? orbitTokens.focus.focusRing : "none",
              transition: prefersReducedMotion ? "none" : `background ${orbitTokens.motion.fast}`,
            }}
          >
            ⋯
          </button>

          {/* Product Popover */}
          {isMenuOpen && (
            <div
              id="sidepanel-product-popover"
              ref={menuRef}
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 4px)",
                minWidth: 170,
                background: orbitColors.bg.surfaceRaised,
                border: `1px solid ${orbitColors.border.default}`,
                borderRadius: orbitRadius.md,
                boxShadow: orbitTokens.shadow.elevation,
                padding: orbitSpacing[1],
                zIndex: 100,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {isAuthenticated && userEmail ? (
                <div
                  style={{
                    padding: `${orbitSpacing[1]}px ${orbitSpacing[2]}px`,
                    fontSize: orbitTypography.fontSize.xs,
                    color: orbitColors.text.secondary,
                    borderBottom: `1px solid ${orbitColors.border.subtle}`,
                    marginBottom: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={userEmail}
                >
                  <div style={{ fontSize: 10, color: orbitColors.text.secondary }}>
                    {copy.menu.accountHeader}
                  </div>
                  <div style={{ color: orbitColors.text.secondary }}>{userEmail}</div>
                </div>
              ) : null}

              {onToggleLanguage ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onToggleLanguage();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    padding: `${orbitSpacing[2]}px ${orbitSpacing[2]}px`,
                    borderRadius: orbitRadius.sm,
                    background: "transparent",
                    border: "none",
                    color: orbitColors.text.primary,
                    fontSize: orbitTypography.fontSize.xs,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {copy.menu.switchLang}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onTabChange("settings");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  padding: `${orbitSpacing[2]}px ${orbitSpacing[2]}px`,
                  borderRadius: orbitRadius.sm,
                  background: "transparent",
                  border: "none",
                  color: orbitColors.text.primary,
                  fontSize: orbitTypography.fontSize.xs,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {copy.menu.settings}
              </button>

              {isAuthenticated && onLogout ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onLogout();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    padding: `${orbitSpacing[2]}px ${orbitSpacing[2]}px`,
                    borderRadius: orbitRadius.sm,
                    background: "transparent",
                    border: "none",
                    color: orbitColors.semantic.error,
                    fontSize: orbitTypography.fontSize.xs,
                    cursor: "pointer",
                    textAlign: "left",
                    borderTop: `1px solid ${orbitColors.border.subtle}`,
                    marginTop: 2,
                  }}
                >
                  {copy.menu.signOut}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Flat Tabs Navigation */}
      {isAuthenticated ? (
        <div
          role="tablist"
          ref={tabListRef}
          aria-label={copy.tabs.ariaLabel}
          style={{
            display: "flex",
            alignItems: "stretch",
            padding: `0 ${orbitSpacing[3]}px`,
            borderTop: `1px solid ${orbitColors.border.subtle}`,
            background: orbitColors.bg.canvas,
            boxSizing: "border-box",
            width: "100%",
          }}
        >
          {tabs.map((item, index) => {
            const isActive = tab === item.id;
            return (
              <TabButton
                key={item.id}
                id={`sidepanel-tab-${item.id}`}
                controls={`sidepanel-tabpanel-${item.id}`}
                isActive={isActive}
                label={item.label}
                onClick={() => onTabChange(item.id)}
                onKeyDown={(e) => handleTabKeyDown(e, index)}
              />
            );
          })}
        </div>
      ) : null}
    </header>
  );
};

const TabButton: React.FC<{
  id: string;
  controls: string;
  isActive: boolean;
  label: string;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}> = ({ id, controls, isActive, label, onClick, onKeyDown }) => {
  const { isFocusVisible, onFocus, onBlur } = useFocusVisible();
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <button
      id={id}
      role="tab"
      type="button"
      aria-selected={isActive}
      aria-controls={controls}
      tabIndex={isActive ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `${orbitSpacing[2]}px ${orbitSpacing[3]}px`,
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${isActive ? orbitColors.brand.primary : "transparent"}`,
        color: isActive ? orbitColors.text.primary : orbitColors.text.secondary,
        fontFamily: orbitTypography.fontFamily,
        fontSize: orbitTypography.fontSize.sm,
        fontWeight: isActive
          ? orbitTypography.fontWeight.semibold
          : orbitTypography.fontWeight.medium,
        cursor: "pointer",
        position: "relative",
        boxSizing: "border-box",
        outline: isFocusVisible ? orbitTokens.focus.outline : "none",
        outlineOffset: orbitTokens.focus.outlineOffset,
        boxShadow: isFocusVisible ? orbitTokens.focus.focusRing : "none",
        transition: prefersReducedMotion
          ? "none"
          : `color ${orbitTokens.motion.fast}, border-color ${orbitTokens.motion.fast}`,
      }}
    >
      {label}
    </button>
  );
};

export const WorkspaceTabPanel: React.FC<{
  id: string;
  tabId: SidePanelTabId;
  children: React.ReactNode;
}> = ({ id, tabId, children }) => {
  const { isFocusVisible, onFocus, onBlur } = useFocusVisible();
  return (
    <div
      role="tabpanel"
      id={id}
      aria-labelledby={`sidepanel-tab-${tabId}`}
      tabIndex={0}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          onFocus(event);
        }
      }}
      onBlur={(event) => {
        if (event.target === event.currentTarget) {
          onBlur(event);
        }
      }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        width: "100%",
        boxSizing: "border-box",
        outline: isFocusVisible ? orbitTokens.focus.outline : "none",
        outlineOffset: orbitTokens.focus.outlineOffset,
        boxShadow: isFocusVisible ? orbitTokens.focus.focusRing : "none",
      }}
    >
      {children}
    </div>
  );
};

export const SidePanelActivityStrip: React.FC<{
  activity: WorkspaceActivity;
  lang: UILang;
}> = ({ activity }) => {
  const prefersReducedMotion = usePrefersReducedMotion();

  let dotColor: string = orbitColors.semantic.info;
  if (activity.tone === "ai") dotColor = orbitColors.ai.accent;
  else if (activity.tone === "error") dotColor = orbitColors.semantic.error;
  else if (activity.tone === "warning") dotColor = orbitColors.semantic.warning;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="workspace-activity-strip"
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        gap: orbitSpacing[1],
        padding: `${orbitSpacing[2]}px ${orbitSpacing[3]}px`,
        background: orbitColors.bg.surfaceRaised,
        borderTop: `1px solid ${orbitColors.border.default}`,
        boxSizing: "border-box",
        width: "100%",
        boxShadow: orbitTokens.shadow.activityElevation,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: orbitSpacing[2],
          width: "100%",
        }}
      >
        {/* Left: Dot & Message */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: orbitSpacing[2],
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: orbitRadius.pill,
              backgroundColor: dotColor,
              flexShrink: 0,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: orbitSpacing[2],
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            <span
              style={{
                fontSize: orbitTypography.fontSize.xs,
                fontWeight: orbitTypography.fontWeight.semibold,
                color: orbitColors.text.primary,
                whiteSpace: "nowrap",
              }}
            >
              {activity.label}
            </span>
            {activity.secondary ? (
              <span
                style={{
                  fontSize: orbitTypography.fontSize.xs,
                  color: orbitColors.text.secondary,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {activity.secondary}
              </span>
            ) : null}
          </div>
        </div>

        {/* Right: Action Button */}
        {activity.action ? (
          <div style={{ flexShrink: 0 }}>
            <OrbitButton
              size="sm"
              variant={activity.kind === "review" ? "secondary" : "danger"}
              onClick={activity.action.onAction}
            >
              {activity.action.label}
            </OrbitButton>
          </div>
        ) : null}
      </div>

      {/* Progress Bar (when progress is numerical) */}
      {activity.progress != null ? (
        <div
          role="progressbar"
          aria-valuenow={Math.round(activity.progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            width: "100%",
            height: 3,
            borderRadius: 2,
            background: orbitColors.bg.surfaceInteractive,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.max(0, Math.min(100, activity.progress))}%`,
              background: dotColor,
              transition: prefersReducedMotion
                ? "none"
                : `width ${orbitTokens.motion.normal}`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
};

export const SidePanelLockedState: React.FC<{
  authStatus: SidePanelAuthStatus;
  lang: UILang;
  onOpenSettings: () => void;
  onRetryValidation?: () => void;
}> = ({ authStatus, lang, onOpenSettings, onRetryValidation }) => {
  const copy = SIDEPANEL_COPY[lang].locked;

  if (authStatus === "loading" || authStatus === "validating") {
    return (
      <div style={{ padding: `${orbitSpacing[4]}px ${orbitSpacing[3]}px` }}>
        <OrbitSurface
          variant="raised"
          style={{
            padding: orbitSpacing[4],
            display: "flex",
            flexDirection: "column",
            gap: orbitSpacing[2],
          }}
        >
          <div
            style={{
              fontSize: orbitTypography.fontSize.md,
              fontWeight: orbitTypography.fontWeight.semibold,
              color: orbitColors.text.primary,
            }}
          >
            {copy.checkingTitle}
          </div>
          <div
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.text.secondary,
              lineHeight: orbitTypography.lineHeight.normal,
            }}
          >
            {copy.checkingDesc}
          </div>
        </OrbitSurface>
      </div>
    );
  }

  if (authStatus === "server_unavailable") {
    return (
      <div style={{ padding: `${orbitSpacing[4]}px ${orbitSpacing[3]}px` }}>
        <OrbitSurface
          variant="raised"
          style={{
            padding: orbitSpacing[4],
            display: "flex",
            flexDirection: "column",
            gap: orbitSpacing[3],
          }}
        >
          <div>
            <div
              style={{
                fontSize: orbitTypography.fontSize.md,
                fontWeight: orbitTypography.fontWeight.semibold,
                color: orbitColors.text.primary,
              }}
            >
              {copy.unavailableTitle}
            </div>
            <div
              style={{
                fontSize: orbitTypography.fontSize.xs,
                color: orbitColors.text.secondary,
                lineHeight: orbitTypography.lineHeight.normal,
                marginTop: orbitSpacing[1],
              }}
            >
              {copy.unavailableDesc}
            </div>
          </div>
          <div style={{ display: "flex", gap: orbitSpacing[2] }}>
            {onRetryValidation ? (
              <OrbitButton variant="primary" size="sm" onClick={onRetryValidation}>
                {copy.retry}
              </OrbitButton>
            ) : null}
            <OrbitButton variant="secondary" size="sm" onClick={onOpenSettings}>
              {copy.openSettings}
            </OrbitButton>
          </div>
        </OrbitSurface>
      </div>
    );
  }

  return (
    <div style={{ padding: `${orbitSpacing[4]}px ${orbitSpacing[3]}px` }}>
      <OrbitSurface
        variant="raised"
        style={{
          padding: orbitSpacing[4],
          display: "flex",
          flexDirection: "column",
          gap: orbitSpacing[3],
        }}
      >
        <div>
          <div
            style={{
              fontSize: orbitTypography.fontSize.md,
              fontWeight: orbitTypography.fontWeight.semibold,
              color: orbitColors.text.primary,
            }}
          >
            {copy.signedOutTitle}
          </div>
          <div
            style={{
              fontSize: orbitTypography.fontSize.xs,
              color: orbitColors.text.secondary,
              lineHeight: orbitTypography.lineHeight.normal,
              marginTop: orbitSpacing[1],
            }}
          >
            {copy.signedOutDesc}
          </div>
        </div>
        <div>
          <OrbitButton variant="primary" size="sm" onClick={onOpenSettings}>
            {copy.signInOrSettings}
          </OrbitButton>
        </div>
      </OrbitSurface>
    </div>
  );
};

import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  isInjectablePageUrl,
  sendToActiveTab,
  sendToTabWithBootstrap,
} from "@/shared/utils/messaging";
import type { ExtMessage } from "@/shared/types";
import { getProvider, getProviderShortName } from "@/shared/ai/providers";
import { isProviderRuntimeConfigured } from "@/shared/ai/parseResultAuthority";
import { logEvent } from "@/shared/utils/analytics";
import { loadSettings } from "@/shared/utils/storage";
import { getAuthText } from "@/shared/auth/authText";
import { useAuthController } from "@/shared/auth/useAuthController";
import {
  clearProtectedWorkOwner,
  markProtectedWorkOwner,
  terminateRecordedProtectedWork,
  type ProtectedWorkKind,
} from "@/shared/auth/protectedWorkOwner";
import { createPopupAuthority } from "./popupAuthority";
import {
  SHARED_FONT_FAMILY,
  primaryButtonStyle,
  secondaryButtonStyle,
  uiInputStyle,
} from "@/shared/ui/extensionUi";
import { POPUP_COPY, type PopupLang } from "./popupCopy";
import {
  PopupActionsCard,
  PopupAuthCard,
  PopupHeroCard,
  PopupSessionGateCard,
  PopupStatusCard,
  PopupWorkspaceCard,
} from "./popupSections";

type ActiveFeature = "manual" | "auto" | "fullpage" | "solve" | null;

gsap.registerPlugin(useGSAP);

const shellStyle: React.CSSProperties = {
  padding: "10px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  background:
    "radial-gradient(circle at 0% 0%, rgba(99, 102, 241, 0.14), transparent 30%), radial-gradient(circle at 100% 0%, rgba(139, 92, 246, 0.1), transparent 30%), linear-gradient(180deg, #070913 0%, #0f111a 60%, #070913 100%)",
  color: "#f8fafc",
  fontFamily: SHARED_FONT_FAMILY,
};

export const PopupApp: React.FC = () => {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [providerId, setProviderId] = useState("anthropic");
  const [providerName, setProviderName] = useState("Claude");
  const [lang, setLang] = useState<PopupLang>("zh");
  const [loaded, setLoaded] = useState(false);
  const [activeFeature, setActiveFeature] = useState<ActiveFeature>(null);
  const copy = POPUP_COPY[lang];
  const authText = getAuthText(lang, "popup");
  const auth = useAuthController({ lang, variant: "popup" });
  const { isAuthenticated, isSessionPending, isServerUnavailable } = auth;
  // Handler-level authority reads the coordinator's CURRENT state directly,
  // not an effect-lagged ref or a render snapshot (AUTH-UI-INV-09).
  const authority = createPopupAuthority(auth.session);
  const isAuthenticatedNow = authority.isAuthenticatedNow;

  // AUTH-UI-INV-11 + INV-15 (popup side): when this surface observes the
  // session leave `authenticated`, any long-running protected work recorded
  // in the cross-surface owner store — Popup- or Side-Panel-started — is
  // terminated at its recorded owner tab.
  const sessionRef = useRef(auth.session);
  useEffect(() => {
    sessionRef.current = auth.session;
  }, [auth.session]);
  useEffect(() => {
    let wasAuthenticated: boolean | null = null;
    const applySessionState = () => {
      const nowAuthenticated = sessionRef.current.getState().status === "authenticated";
      if (wasAuthenticated === true && !nowAuthenticated) {
        void terminateRecordedProtectedWork((tabId, message) =>
          sendToTabWithBootstrap(tabId, message as ExtMessage),
        );
      }
      wasAuthenticated = nowAuthenticated;
    };
    applySessionState();
    const unsubscribe = sessionRef.current.subscribe(applySessionState);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void loadSettings().then((settings) => {
      if (disposed) return;
      const key = settings.apiKey ?? "";
      const nextProviderId = settings.providerId ?? "anthropic";
      const nextLang = settings.language ?? "zh";
      setApiKey(key);
      setProviderId(nextProviderId);
      setProviderName(getProviderShortName(nextProviderId));
      setLang(nextLang);
      setLoaded(true);
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    logEvent("popup_opened");
  }, []);

  // UI-00A: the shared provider-contract check replaces the local
  // `key present or ollama` copy so every surface agrees on "configured".
  const hasApiKey = isProviderRuntimeConfigured(getProvider(providerId), { apiKey });
  const isRuntimeConfigured = isAuthenticated && hasApiKey;

  useGSAP(
    () => {
      gsap.fromTo(
        ".popup-hero",
        { y: 14, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.6,
          ease: "power2.out",
          clearProps: "transform,opacity,visibility",
        },
      );
      gsap.fromTo(
        ".popup-section",
        { y: 14, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.45,
          stagger: 0.08,
          ease: "power2.out",
          delay: 0.08,
          clearProps: "transform,opacity,visibility",
        },
      );
      gsap.fromTo(
        ".popup-metric",
        { y: 10, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.38,
          stagger: 0.05,
          ease: "power2.out",
          delay: 0.12,
          clearProps: "transform,opacity,visibility",
        },
      );
      gsap.fromTo(
        ".popup-action",
        { x: -10, autoAlpha: 0 },
        {
          x: 0,
          autoAlpha: 1,
          duration: 0.48,
          stagger: 0.06,
          ease: "power2.out",
          delay: 0.16,
          clearProps: "transform,opacity,visibility",
        },
      );

      const hoverTargets = gsap.utils.toArray<HTMLElement>(
        ".popup-hero, .popup-section, .popup-action, .popup-metric, .popup-open-panel",
      );
      const cleanups = hoverTargets.map((element) => {
        const isAction = element.classList.contains("popup-action");
        const isMetric = element.classList.contains("popup-metric");
        const isHero = element.classList.contains("popup-hero");
        const onEnter = () => {
          gsap.to(element, {
            y: isMetric ? 0 : isAction ? -2 : -3,
            scale: isMetric ? 1.015 : 1,
            boxShadow: isHero
              ? "0 16px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12)"
              : isAction
                ? "0 12px 24px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.08)"
                : "0 16px 32px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
            duration: 0.2,
            ease: "power2.out",
          });
        };
        const onLeave = () => {
          gsap.to(element, {
            y: 0,
            scale: 1,
            boxShadow: isMetric
              ? "none"
              : isAction
                ? "none"
                : "0 4px 20px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
            duration: 0.2,
            ease: "power2.out",
          });
        };
        element.addEventListener("mouseenter", onEnter);
        element.addEventListener("mouseleave", onLeave);
        return () => {
          element.removeEventListener("mouseenter", onEnter);
          element.removeEventListener("mouseleave", onLeave);
        };
      });

      return () => {
        cleanups.forEach((cleanup) => cleanup());
      };
    },
    { scope: scopeRef },
  );

  const openSidePanelDirect = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.error("[Popup] sidePanel.open failed:", error);
    }
  };

  const runAction = async (
    feature: Exclude<ActiveFeature, null>,
    startText: string,
    errorText: string,
    messageType:
      | "START_MANUAL_CAPTURE"
      | "START_AUTO_DETECT"
      | "START_FULL_PAGE_DETECT"
      | "START_AUTO_SOLVE_ALL",
    openPanel = false,
  ) => {
    // Handler-level fail closed: the button being visible is not authority.
    // Only a server-validated session may dispatch protected runtime actions.
    if (!isAuthenticatedNow()) {
      setStatus(
        lang === "en"
          ? "Sign in with a verified session before using this action."
          : "请先通过登录验证后再使用该功能。",
      );
      setActiveFeature(null);
      return;
    }
    // UI-00A minimal P0 gate: Auto Solve drives real page mutations, so it
    // must not start without a configured provider. Detection / manual
    // capture stay available — they produce no provider answers.
    if (messageType === "START_AUTO_SOLVE_ALL" && !hasApiKey) {
      setStatus(
        lang === "en"
          ? "Configure an AI provider in Settings before starting Auto Solve."
          : "请先在设置中配置 AI 服务，再启动自动答题。",
      );
      setActiveFeature(null);
      return;
    }
    // AUTH-UI-INV-15: long-running protected work records its cross-surface
    // owner BEFORE dispatch, with the exact target tab, so an auth loss on
    // any surface can find and terminate the real owner. Hoisted so the
    // failure path can clear a half-built record.
    const longRunningKind: ProtectedWorkKind | null =
      messageType === "START_AUTO_SOLVE_ALL"
        ? "autoSolve"
        : messageType === "START_FULL_PAGE_DETECT"
          ? "fullPage"
          : null;
    let ownerTabId: number | undefined;
    try {
      setActiveFeature(feature);
      setStatus(startText);
      if (openPanel) await openSidePanelDirect();
      // Last-responsible-moment recheck: opening the panel awaited, so the
      // session may have lapsed since the entry gate (AUTH-UI-INV-12).
      if (!isAuthenticatedNow()) {
        setStatus(
          lang === "en"
            ? "Sign-in verification ended. The action was not started."
            : "登录验证已失效，该操作未开始。",
        );
        setActiveFeature(null);
        return;
      }
      if (longRunningKind) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !isInjectablePageUrl(tab.url)) {
          setStatus(errorText);
          setActiveFeature(null);
          return;
        }
        ownerTabId = tab.id;
        await markProtectedWorkOwner(longRunningKind, ownerTabId);
        if (!isAuthenticatedNow()) {
          await clearProtectedWorkOwner(longRunningKind, ownerTabId);
          setStatus(
            lang === "en"
              ? "Sign-in verification ended. The action was not started."
              : "登录验证已失效，该操作未开始。",
          );
          setActiveFeature(null);
          return;
        }
        // Dispatch to the exact recorded owner tab (guard re-checks at every
        // await boundary inside the messaging chain).
        await sendToTabWithBootstrap(ownerTabId, { type: messageType }, isAuthenticatedNow);
      } else {
        await sendToActiveTab({ type: messageType }, isAuthenticatedNow);
      }
      window.close();
    } catch {
      // A failed dispatch must not leave an owner record behind.
      if (ownerTabId != null && longRunningKind) {
        void clearProtectedWorkOwner(longRunningKind, ownerTabId);
      }
      setStatus(errorText);
      setActiveFeature(null);
    }
  };

  const handleOpenSidePanel = async () => {
    if (!isAuthenticatedNow()) {
      setStatus(
        lang === "en"
          ? "Sign in with a verified session before opening the workspace."
          : "请先通过登录验证后再打开工作台。",
      );
      return;
    }
    await openSidePanelDirect();
    window.close();
  };

  // The retry gate is only for indeterminate states (pending validation or
  // unreachable server). A server-REJECTED session converges to the auth form
  // with a generic "sign in again" hint.
  const sessionGateVisible = isSessionPending || isServerUnavailable;

  return (
    <div ref={scopeRef} style={shellStyle}>
      <PopupHeroCard
        copy={copy}
        hasApiKey={hasApiKey}
        isAuthenticated={isAuthenticated}
        isRuntimeConfigured={isRuntimeConfigured}
        loaded={loaded}
        providerName={providerName}
        sessionStatus={auth.status}
        validatingSessionText={authText.validatingSession}
        view={auth.view}
      />

      {isAuthenticated ? (
        <PopupActionsCard activeFeature={activeFeature} copy={copy} onRunAction={(...args) => void runAction(...args)} />
      ) : sessionGateVisible ? (
        <PopupSessionGateCard
          authText={authText}
          isBusy={isSessionPending}
          isServerUnavailable={isServerUnavailable}
          onRetry={() => void auth.retryValidation()}
          onLogout={() => void auth.handleLogout()}
        />
      ) : (
        <PopupAuthCard
          auth={auth}
          authText={authText}
          copy={copy}
          gateInputStyle={gateInputStyle}
          primaryGateButtonStyle={primaryGateButtonStyle}
          secondaryGateButtonStyle={secondaryGateButtonStyle}
        />
      )}

      <PopupWorkspaceCard
        copy={copy}
        feedback={auth.feedback}
        isAuthenticated={isAuthenticated}
        onOpenSidePanel={() => void handleOpenSidePanel()}
        secondaryActionStyle={secondaryActionStyle}
        userEmail={auth.userEmail}
      />

      <PopupStatusCard status={status} />
    </div>
  );
};

const secondaryActionStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  padding: "9px 12px",
  fontSize: 11,
};

const primaryGateButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  width: "100%",
  textAlign: "center",
};

const secondaryGateButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  width: "100%",
  textAlign: "center",
};

const gateInputStyle: React.CSSProperties = {
  ...uiInputStyle,
  fontSize: 12,
};

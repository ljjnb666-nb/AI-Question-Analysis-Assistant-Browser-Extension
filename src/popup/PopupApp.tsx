import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { sendToActiveTab } from "@/shared/utils/messaging";
import { getProviderShortName } from "@/shared/ai/providers";
import { logEvent } from "@/shared/utils/analytics";
import { loadSettings } from "@/shared/utils/storage";
import { getAuthText } from "@/shared/auth/authText";
import { useAuthController } from "@/shared/auth/useAuthController";
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
  const { isAuthenticated } = auth;
  const authRef = useRef(auth);

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

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
      authRef.current.setIdentity({
        userId: settings.userId ?? "",
        userEmail: settings.userEmail ?? "",
      });
      setLoaded(true);
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    logEvent("popup_opened");
  }, []);

  const hasApiKey = apiKey.length > 0 || providerId === "ollama";
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
                : "0 16px 32px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255,255,255,0.1)",
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
    try {
      setActiveFeature(feature);
      setStatus(startText);
      if (openPanel) await openSidePanelDirect();
      await sendToActiveTab({ type: messageType });
      window.close();
    } catch {
      setStatus(errorText);
      setActiveFeature(null);
    }
  };

  const handleOpenSidePanel = async () => {
    await openSidePanelDirect();
    window.close();
  };

  return (
    <div ref={scopeRef} style={shellStyle}>
      <PopupHeroCard
        copy={copy}
        hasApiKey={hasApiKey}
        isAuthenticated={isAuthenticated}
        isRuntimeConfigured={isRuntimeConfigured}
        loaded={loaded}
        providerName={providerName}
        view={auth.view}
      />

      {!isAuthenticated ? (
        <PopupAuthCard
          auth={auth}
          authText={authText}
          copy={copy}
          gateInputStyle={gateInputStyle}
          primaryGateButtonStyle={primaryGateButtonStyle}
          secondaryGateButtonStyle={secondaryGateButtonStyle}
        />
      ) : (
        <PopupActionsCard activeFeature={activeFeature} copy={copy} onRunAction={(...args) => void runAction(...args)} />
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

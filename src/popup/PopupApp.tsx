import React, { useEffect, useRef, useState } from "react";
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
import { useAuthController } from "@/shared/auth/useAuthController";
import {
  clearProtectedWorkOwner,
  markProtectedWorkOwner,
  terminateRecordedProtectedWork,
  type ProtectedWorkKind,
} from "@/shared/auth/protectedWorkOwner";
import { userFeedback, type UserFeedback } from "@/shared/ui/userFeedback";
import { orbitColors, orbitSpacing, orbitTypography } from "@/shared/ui/orbitTokens";
import { createPopupAuthority } from "./popupAuthority";
import { POPUP_COPY, type PopupLang } from "./popupCopy";
import { derivePopupViewState } from "./popupViewState";
import {
  PopupAuthSection,
  PopupContextLine,
  PopupFeedbackBanner,
  PopupFooter,
  PopupHeader,
  PopupPrimaryCommand,
  PopupRecoverySection,
  PopupSecondaryCommands,
  PopupSessionGateSection,
} from "./popupSections";

type ActiveFeature = "manual" | "auto" | "fullpage" | "solve" | null;

const shellStyle: React.CSSProperties = {
  padding: `${orbitSpacing[3]}px`,
  display: "flex",
  flexDirection: "column",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  background: orbitColors.bg.canvas,
  color: orbitColors.text.primary,
  fontFamily: orbitTypography.fontFamily,
};

export const PopupApp: React.FC = () => {
  const [feedback, setFeedback] = useState<UserFeedback | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [providerId, setProviderId] = useState("anthropic");
  const [providerName, setProviderName] = useState("Claude");
  const [lang, setLang] = useState<PopupLang>("zh");
  const [_loaded, setLoaded] = useState(false);
  const [activeFeature, setActiveFeature] = useState<ActiveFeature>(null);
  const [isPageInjectable, setIsPageInjectable] = useState(true);
  const [reviewReason, setReviewReason] = useState<string | null>(null);

  const copy = POPUP_COPY[lang];
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

  // Check active tab injectable capability
  useEffect(() => {
    try {
      if (typeof chrome !== "undefined" && chrome.tabs?.query) {
        void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          if (tab?.url) {
            setIsPageInjectable(isInjectablePageUrl(tab.url));
          }
        });
      }
    } catch {
      // Tab query unavailable in test mock without tabs
    }
  }, []);

  // UI-00A: shared provider-contract check
  const hasApiKey = isProviderRuntimeConfigured(getProvider(providerId), { apiKey });

  const viewState = derivePopupViewState({
    authStatus: auth.status,
    isAuthenticated,
    isSessionPending,
    isServerUnavailable,
    isPageInjectable,
    hasApiKey,
    activeFeature,
    reviewReason,
  });

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
      setFeedback(
        userFeedback("warning", copy.authRequiredWarning, {
          code: "AUTH_REQUIRED",
        }),
      );
      setActiveFeature(null);
      return;
    }

    // UI-00A minimal P0 gate: Auto Solve drives real page mutations, so it
    // must not start without a configured provider. Detection / manual
    // capture stay available — they produce no provider answers.
    if (messageType === "START_AUTO_SOLVE_ALL" && !hasApiKey) {
      setFeedback(
        userFeedback("warning", copy.providerMissingWarning, {
          code: "PROVIDER_REQUIRED",
        }),
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
      setFeedback(userFeedback("info", startText));
      if (openPanel) await openSidePanelDirect();

      // Last-responsible-moment recheck: opening the panel awaited, so the
      // session may have lapsed since the entry gate (AUTH-UI-INV-12).
      if (!isAuthenticatedNow()) {
        setFeedback(
          userFeedback("warning", copy.sessionExpiredNotice, {
            code: "AUTHORITY_LOST",
          }),
        );
        setActiveFeature(null);
        return;
      }

      if (longRunningKind) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !isInjectablePageUrl(tab.url)) {
          setFeedback(userFeedback("error", errorText, { code: "PAGE_INJECTION_FAILED" }));
          setActiveFeature(null);
          return;
        }
        ownerTabId = tab.id;
        await markProtectedWorkOwner(longRunningKind, ownerTabId);

        if (!isAuthenticatedNow()) {
          await clearProtectedWorkOwner(longRunningKind, ownerTabId);
          setFeedback(
            userFeedback("warning", copy.sessionExpiredNotice, {
              code: "AUTHORITY_LOST",
            }),
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

      if (typeof window !== "undefined" && window.close) {
        window.close();
      }
    } catch (err) {
      // A failed dispatch must not leave an owner record behind.
      if (ownerTabId != null && longRunningKind) {
        void clearProtectedWorkOwner(longRunningKind, ownerTabId);
      }
      const rawMsg = err instanceof Error ? err.message : String(err || "");
      if (rawMsg.includes("STALE") || rawMsg.includes("AUTHORITY_LOST")) {
        setReviewReason(rawMsg);
        setFeedback(userFeedback("warning", copy.safetyCheckWarning, { code: rawMsg }));
      } else {
        setFeedback(
          userFeedback("error", errorText, {
            code: "DISPATCH_FAILED",
            technicalDetail: rawMsg,
          }),
        );
      }
      setActiveFeature(null);
    }
  };

  const handleOpenSidePanel = async () => {
    if (!isAuthenticatedNow()) {
      setFeedback(
        userFeedback("warning", copy.authRequiredWarning, {
          code: "AUTH_REQUIRED",
        }),
      );
      return;
    }
    await openSidePanelDirect();
    if (typeof window !== "undefined" && window.close) {
      window.close();
    }
  };

  const handleRefreshPage = () => {
    try {
      if (typeof chrome !== "undefined" && chrome.tabs?.reload) {
        void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          if (tab?.id) void chrome.tabs.reload(tab.id);
        });
      }
    } catch {
      // Ignore in test
    }
  };

  const handleReDetect = () => {
    setReviewReason(null);
    void runAction("auto", copy.startDetect, copy.detectError, "START_AUTO_DETECT", true);
  };

  const toggleLang = () => {
    setLang((prev) => (prev === "zh" ? "en" : "zh"));
  };

  const sessionGateVisible = isSessionPending || isServerUnavailable;

  return (
    <div style={shellStyle}>
      <PopupHeader
        appName={copy.appName}
        viewState={viewState}
        lang={lang}
        copy={copy}
        onOpenSettings={() => void handleOpenSidePanel()}
        onToggleLang={toggleLang}
        onLogout={() => void auth.handleLogout()}
        isAuthenticated={isAuthenticated}
      />

      {isAuthenticated ? (
        <>
          <PopupContextLine
            isPageInjectable={isPageInjectable}
            hasApiKey={hasApiKey}
            providerName={providerName}
            copy={copy}
          />

          <PopupPrimaryCommand
            copy={copy}
            lang={lang}
            isRunning={activeFeature !== null}
            activeFeature={activeFeature}
            onSolve={() =>
              void runAction(
                "solve",
                copy.startSolve,
                copy.solveError,
                "START_AUTO_SOLVE_ALL",
                true,
              )
            }
            isAuthenticated={isAuthenticated}
            isPageInjectable={isPageInjectable}
            hasApiKey={hasApiKey}
          />

          <PopupSecondaryCommands
            copy={copy}
            lang={lang}
            isRunning={activeFeature !== null}
            activeFeature={activeFeature}
            onDetect={() =>
              void runAction(
                "auto",
                copy.startDetect,
                copy.detectError,
                "START_AUTO_DETECT",
                true,
              )
            }
            onManualCapture={() =>
              void runAction(
                "manual",
                copy.startManual,
                copy.manualError,
                "START_MANUAL_CAPTURE",
                false,
              )
            }
            onFullPageScan={() =>
              void runAction(
                "fullpage",
                copy.startFullPage,
                copy.fullPageError,
                "START_FULL_PAGE_DETECT",
                true,
              )
            }
            isAuthenticated={isAuthenticated}
            isPageInjectable={isPageInjectable}
            hasApiKey={hasApiKey}
          />

          {viewState === "provider_setup_required" ||
          viewState === "review_required" ||
          viewState === "page_unavailable" ||
          viewState === "recoverable_error" ? (
            <PopupRecoverySection
              viewState={viewState}
              lang={lang}
              onOpenSettings={() => void handleOpenSidePanel()}
              onOpenWorkspace={() => void handleOpenSidePanel()}
              onRefreshPage={handleRefreshPage}
              onReDetect={handleReDetect}
              onRetryValidation={() => void auth.retryValidation()}
              onLogout={() => void auth.handleLogout()}
            />
          ) : null}

          <PopupFooter
            copy={copy}
            onOpenWorkspace={() => void handleOpenSidePanel()}
            isAuthenticated={isAuthenticated}
          />
        </>
      ) : sessionGateVisible ? (
        <PopupSessionGateSection
          copy={copy}
          isSessionPending={isSessionPending}
          isServerUnavailable={isServerUnavailable}
          onRetry={() => void auth.retryValidation()}
          onLogout={() => void auth.handleLogout()}
        />
      ) : (
        <PopupAuthSection auth={auth} copy={copy} />
      )}

      <PopupFeedbackBanner feedback={feedback} />
    </div>
  );
};
